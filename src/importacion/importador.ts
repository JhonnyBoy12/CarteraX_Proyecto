/**
 * @file importador.ts
 * @description ETL de CarteraX. Reutiliza el lector, mapeo y normalización
 * del piloto ERS Phoenix, pero carga los datos en el modelo normalizado.
 */
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";

import { mapearFilas } from "./mapeoColumnas";
import { limpiarTexto, limpiarNumero, limpiarFechaYYYYMMDD, separarRut } from "./normalizador";
import { calcularDiasMora, calcularPctRecuperacion } from "./calculos";
import { clasificarGestion } from "./clasificador";
import { leerArchivoTabular } from "./lectorArchivos";

export interface ResultadoHoja {
  hoja: string;
  cargados: number;
  corregidos: number;
  conError: number;
}

export interface ResultadoImportacion {
  archivo: string;
  hojas: ResultadoHoja[];
  formato?: Phoenix.FormatoArchivo;
}

function periodoActual(): { id: string; nombre: string; inicio: string; fin: string } {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth() + 1;
  const id = `${anio}-${String(mes).padStart(2, "0")}`;
  const inicio = `${id}-01`;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const fin = `${id}-${String(ultimoDia).padStart(2, "0")}`;
  return { id, nombre: id, inicio, fin };
}

/**
 * El prototipo todavía no tiene login. Se crea un ejecutivo local para poder
 * probar cartera, importaciones y llamadas sin introducir un rol adicional.
 */
function asegurarContextoLocal(db: Database.Database): { usuarioId: string; periodoId: string; carteraId: string } {
  const usuarioId = "ejecutivo-local";
  const periodo = periodoActual();
  const carteraId = `cartera-${usuarioId}-${periodo.id}`;

  db.prepare(`INSERT OR IGNORE INTO usuarios (id, nombre, apellido, email, password_hash)
              VALUES (?, 'Ejecutivo', 'Local', 'ejecutivo.local@carterax.local', 'PENDIENTE_LOGIN')`)
    .run(usuarioId);

  db.prepare(`INSERT OR IGNORE INTO periodos (id, nombre, fecha_inicio, fecha_fin)
              VALUES (?, ?, ?, ?)`)
    .run(periodo.id, periodo.nombre, periodo.inicio, periodo.fin);

  db.prepare(`INSERT OR IGNORE INTO carteras (id, usuario_id, periodo_id, nombre)
              VALUES (?, ?, ?, ?)`)
    .run(carteraId, usuarioId, periodo.id, `Cartera ${periodo.nombre}`);

  return { usuarioId, periodoId: periodo.id, carteraId };
}

function textoTelefono(valor: unknown): string | null {
  const texto = limpiarTexto(valor);
  if (!texto) return null;
  const soloNumero = texto.replace(/\.0$/, "").replace(/[^0-9+]/g, "");
  return soloNumero.length >= 8 ? soloNumero : null;
}

/** Calcula una huella SHA-256 del contenido para detectar el mismo archivo aunque cambie de nombre. */
function calcularHashArchivo(rutaArchivo: string): string {
  return createHash("sha256").update(fs.readFileSync(rutaArchivo)).digest("hex");
}

export function importarArchivo(
  db: Database.Database,
  rutaArchivo: string,
  _usuarioId: string | null = null,
  nombreOriginal?: string
): ResultadoImportacion {
  const leido = leerArchivoTabular(rutaArchivo, nombreOriginal);
  const contexto = asegurarContextoLocal(db);
  const archivoHash = calcularHashArchivo(rutaArchivo);

  const importacionExistente = db.prepare(`
    SELECT nombre_archivo, fecha_importacion
    FROM importaciones
    WHERE cartera_id = ? AND archivo_hash = ?
    LIMIT 1
  `).get(contexto.carteraId, archivoHash) as { nombre_archivo: string; fecha_importacion: string } | undefined;

  if (importacionExistente) {
    throw new Error(
      `Este archivo ya fue importado anteriormente (${importacionExistente.nombre_archivo}, ${importacionExistente.fecha_importacion}).`
    );
  }
  const resultado: ResultadoImportacion = { archivo: leido.archivo, hojas: [], formato: leido.formato };

  const buscarCliente = db.prepare(`SELECT id FROM clientes WHERE rut = ? AND COALESCE(dv, '') = COALESCE(?, '') LIMIT 1`);
  const insertarCliente = db.prepare(`INSERT INTO clientes (id, rut, dv, nombre) VALUES (?, ?, ?, ?)`);
  const actualizarCliente = db.prepare(`UPDATE clientes SET nombre = CASE WHEN ? <> '' THEN ? ELSE nombre END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const insertarTelefono = db.prepare(`INSERT OR IGNORE INTO telefonos (id, cliente_id, numero, prioridad) VALUES (?, ?, ?, ?)`);
  const insertarCorreo = db.prepare(`INSERT OR IGNORE INTO correos (id, cliente_id, correo) VALUES (?, ?, ?)`);
  const insertarDireccion = db.prepare(`INSERT OR IGNORE INTO direcciones (id, cliente_id, direccion, comuna) VALUES (?, ?, ?, ?)`);
  const insertarVehiculo = db.prepare(`INSERT OR IGNORE INTO vehiculos (id, cliente_id, marca, modelo, patente) VALUES (?, ?, ?, ?, ?)`);
  const insertarCarteraCliente = db.prepare(`INSERT OR IGNORE INTO cartera_clientes (id, cartera_id, cliente_id, categoria_gestion, texto_gestion) VALUES (?, ?, ?, ?, ?)`);
  const actualizarGestion = db.prepare(`UPDATE cartera_clientes SET categoria_gestion = ?, texto_gestion = ?, updated_at = CURRENT_TIMESTAMP WHERE cartera_id = ? AND cliente_id = ?`);
  const insertarOperacion = db.prepare(`
    INSERT OR IGNORE INTO operaciones (
      id, cliente_id, periodo_id, numero_operacion, deuda_total, monto_contenido,
      monto_cuota, cuotas_pactadas, cuotas_pagadas, cuotas_morosas,
      fecha_otorgamiento, fecha_primer_vencimiento, fecha_ultimo_pago,
      dias_mora, tramo_mora, pct_recuperacion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertarImportacion = db.prepare(`
    INSERT INTO importaciones (
      id, cartera_id, nombre_archivo, archivo_hash, hoja_nombre, total_registros,
      registros_importados, registros_corregidos, registros_rechazados, estado
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertarError = db.prepare(`
    INSERT INTO errores_importacion (id, importacion_id, numero_fila, campo, valor_original, descripcion)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const tabla of leido.tablas) {
    if (tabla.filas.length === 0) continue;

    const filas = mapearFilas(tabla.filas);
    const importacionId = randomUUID();
    let cargados = 0;
    let corregidos = 0;
    let conError = 0;
    const errores: Array<{ fila: number; campo: string; valor: string | null; descripcion: string }> = [];

    const procesar = db.transaction(() => {
      filas.forEach((fila, indice) => {
        const numeroFila = indice + 2;
        try {
          const rutCrudo = limpiarTexto(fila.rut);
          if (!rutCrudo) {
            conError++;
            errores.push({ fila: numeroFila, campo: "RUT", valor: null, descripcion: "El RUT es obligatorio" });
            return;
          }

          const dvColumna = limpiarTexto(fila.dv);
          const separado = dvColumna ? { rut: rutCrudo.replace(/\D/g, ""), dv: dvColumna } : separarRut(rutCrudo);
          const rut = separado.rut.replace(/\D/g, "");
          if (!rut) throw new Error("RUT inválido");

          const nombre = limpiarTexto(fila.nombre_cliente) ?? "";
          let clienteId = (buscarCliente.get(rut, separado.dv) as { id: string } | undefined)?.id;
          if (!clienteId) {
            clienteId = randomUUID();
            insertarCliente.run(clienteId, rut, separado.dv, nombre);
          } else {
            actualizarCliente.run(nombre, nombre, clienteId);
          }

          const textoGestion = limpiarTexto(fila.texto_gestion);
          const categoriaGestion = clasificarGestion(textoGestion);
          insertarCarteraCliente.run(randomUUID(), contexto.carteraId, clienteId, categoriaGestion, textoGestion);
          actualizarGestion.run(categoriaGestion, textoGestion, contexto.carteraId, clienteId);

          ["fono1", "fono2", "fono3", "fono4"].forEach((campo, prioridad) => {
            const numero = textoTelefono(fila[campo]);
            if (numero) insertarTelefono.run(randomUUID(), clienteId, numero, prioridad + 1);
          });

          ["correo_1", "correo_2", "correo_3"].forEach((campo) => {
            const correo = limpiarTexto(fila[campo]);
            if (correo) insertarCorreo.run(randomUUID(), clienteId, correo.toLowerCase());
          });

          const direccion = limpiarTexto(fila.calle1);
          const comuna = limpiarTexto(fila.comuna);
          if (direccion) insertarDireccion.run(randomUUID(), clienteId, direccion, comuna);

          const marca = limpiarTexto(fila.marca);
          const modelo = limpiarTexto(fila.modelo);
          const patente = limpiarTexto(fila.patente)?.replace(/[\s-]+/g, "").toUpperCase() ?? null;
          if (marca || modelo || patente) insertarVehiculo.run(randomUUID(), clienteId, marca, modelo, patente);

          const fechaVenc = limpiarFechaYYYYMMDD(fila.fecha_1er_vencimiento);
          const cuotasPactadas = limpiarNumero(fila.cuotas_pactadas);
          const cuotasPagadas = limpiarNumero(fila.cuotas_pagadas);
          const operacionCruda = limpiarTexto(fila.numero_operacion);
          const numeroOperacion = operacionCruda || `SIN-OPERACION-${importacionId}-${numeroFila}`;

          insertarOperacion.run(
            randomUUID(), clienteId, contexto.periodoId, numeroOperacion,
            limpiarNumero(fila.monto_deuda) ?? 0,
            limpiarNumero(fila.monto_contenido),
            limpiarNumero(fila.monto_cuota),
            cuotasPactadas, cuotasPagadas, limpiarNumero(fila.cuotas_morosas),
            limpiarFechaYYYYMMDD(fila.fecha_otorgamiento), fechaVenc,
            limpiarFechaYYYYMMDD(fila.fecha_ultimo_pago),
            calcularDiasMora(fechaVenc), limpiarTexto(fila.tramo_mora),
            calcularPctRecuperacion(cuotasPagadas, cuotasPactadas)
          );

          if (!limpiarTexto(fila.categoria_gestion_previa)) corregidos++;
          cargados++;
        } catch (error) {
          conError++;
          errores.push({
            fila: numeroFila,
            campo: "FILA",
            valor: null,
            descripcion: (error as Error).message,
          });
        }
      });

      const estado = conError === 0 ? "COMPLETADA" : cargados > 0 ? "COMPLETADA_CON_ERRORES" : "FALLIDA";
      insertarImportacion.run(
        importacionId, contexto.carteraId, leido.archivo, archivoHash, tabla.nombre, filas.length,
        cargados, corregidos, conError, estado
      );
      for (const error of errores) {
        insertarError.run(randomUUID(), importacionId, error.fila, error.campo, error.valor, error.descripcion);
      }
    });

    procesar();
    resultado.hojas.push({ hoja: tabla.nombre, cargados, corregidos, conError });
  }

  return resultado;
}

export function importarExcel(
  db: Database.Database,
  rutaExcel: string,
  usuarioId: string | null = null
): ResultadoImportacion {
  return importarArchivo(db, rutaExcel, usuarioId);
}
