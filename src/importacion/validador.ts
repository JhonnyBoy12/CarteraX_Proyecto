/**
 * @file validador.ts
 * @description Revisión de datos ANTES de importar: qué filas no se
 * cargarán, cuáles se cargarán con un dato descartado o dudoso, y qué hacer
 * con cada caso. No escribe nada.
 *
 * Las reglas reflejan exactamente lo que hace `importador.ts` con cada fila
 * (no lo cambian): una fila sin RUT se omite, una deuda ilegible entra como
 * $0, un teléfono de menos de 8 dígitos se descarta, etc.
 *
 * @since 0.3.1
 */
import { limpiarFechaYYYYMMDD, limpiarNumero, limpiarTexto, separarRut, textoTelefono } from "./normalizador";

/** Máximo de filas de ejemplo que se envían por observación. */
const MAX_FILAS = 200;

interface Regla {
  nivel: Phoenix.NivelObservacion;
  titulo: string;
  efecto: string;
  accion: string;
}

/** Catálogo de observaciones, en el orden en que se muestran. */
const REGLAS: Record<string, Regla> = {
  sin_rut: {
    nivel: "rechazo",
    titulo: "Filas sin RUT",
    efecto: "No se cargan: el RUT identifica al cliente.",
    accion: "Completa el RUT en el archivo y vuelve a importarlo. Si son filas de totales o vacías, puedes ignorarlas.",
  },
  rut_ilegible: {
    nivel: "rechazo",
    titulo: "RUT ilegible",
    efecto: "No se cargan: el RUT no tiene números.",
    accion: "Corrige el RUT (formato 12.345.678-9 o 12345678 con el DV en su columna) y vuelve a importar.",
  },
  fila_repetida: {
    nivel: "aviso",
    titulo: "Filas repetidas sin número de operación",
    efecto: "Se cargan como operaciones distintas: la deuda del cliente se suma dos veces.",
    accion: "Elimina la fila duplicada del archivo antes de importar, o agrega el número de operación.",
  },
  dv_incorrecto: {
    nivel: "aviso",
    titulo: "Dígito verificador no coincide",
    efecto: "Se cargan igual, con el RUT tal como viene.",
    accion: "Verifica el RUT con el banco antes de gestionar: puede ser un error de digitación.",
  },
  deuda_ilegible: {
    nivel: "aviso",
    titulo: "Deuda vacía o ilegible",
    efecto: "Se cargan con deuda $0 y quedan al final de la prioridad.",
    accion: "Escribe la deuda como número (1500000 o 1.500.000) y vuelve a importar el archivo corregido.",
  },
  deuda_negativa: {
    nivel: "aviso",
    titulo: "Deuda negativa",
    efecto: "Se cargan con el monto negativo, que resta al total de la cartera.",
    accion: "Confirma si es un saldo a favor; si no, corrige el signo en el archivo.",
  },
  telefono_descartado: {
    nivel: "aviso",
    titulo: "Teléfonos incompletos",
    efecto: "Ese número se descarta (tiene menos de 8 dígitos); el resto de la fila se carga.",
    accion: "Completa el número con su código (9 dígitos en Chile) o agrégalo después desde la ficha del cliente.",
  },
  sin_telefono: {
    nivel: "aviso",
    titulo: "Clientes sin teléfono válido",
    efecto: "Se cargan, pero no podrán entrar a la cola de llamadas.",
    accion: "Busca un teléfono de contacto o gestiónalos por correo o carta.",
  },
  correo_invalido: {
    nivel: "aviso",
    titulo: "Correos con formato inválido",
    efecto: "Se guardan tal cual, pero no sirven para enviar notificaciones.",
    accion: "Corrige el correo (nombre@dominio.cl) en el archivo o en la ficha del cliente.",
  },
  fecha_ilegible: {
    nivel: "aviso",
    titulo: "Fecha de vencimiento ilegible",
    efecto: "Se cargan sin fecha: no se calculan los días de mora.",
    accion: "Usa el formato dd-mm-aaaa o aaaammdd en la columna de vencimiento.",
  },
  sin_nombre: {
    nivel: "aviso",
    titulo: "Clientes sin nombre",
    efecto: "Se cargan identificados sólo por su RUT.",
    accion: "Completa el nombre en el archivo; si el cliente ya existía, conserva el nombre anterior.",
  },
};

/** Dígito verificador (módulo 11) de un RUT chileno. */
export function calcularDv(cuerpo: string): string {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texto = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * Revisa las filas ya mapeadas a campos internos (`mapearFilas`).
 * @param filas Filas con claves internas (rut, dv, monto_deuda, fono1, …).
 * @param campos Campos internos presentes en la hoja (para no exigir columnas que el archivo no trae).
 * @param maxFilas Filas de ejemplo por observación (la descarga pide todas).
 */
export function validarFilas(filas: Record<string, unknown>[], campos: Set<string>, maxFilas = MAX_FILAS): Phoenix.ValidacionHoja {
  const grupos = new Map<string, Phoenix.FilaObservada[]>();
  const conteo = new Map<string, number>();
  const marcas: Record<number, string[]> = {};
  const rechazadas = new Set<number>();
  const conAviso = new Set<number>();
  const vistas = new Set<string>();

  filas.forEach((f, indice) => {
    const fila = indice + 2; // igual que el importador: el encabezado es la fila 1
    const rutCrudo = limpiarTexto(f.rut);
    const nombre = limpiarTexto(f.nombre_cliente);
    const anotar = (codigo: string, campo: string | null, valor: unknown) => {
      conteo.set(codigo, (conteo.get(codigo) ?? 0) + 1);
      const lista = grupos.get(codigo) ?? [];
      if (lista.length < maxFilas) lista.push({ fila, rut: rutCrudo, nombre, campo, valor: texto(valor) });
      grupos.set(codigo, lista);
      if (campo) (marcas[fila] ??= []).push(campo);
      (REGLAS[codigo].nivel === "rechazo" ? rechazadas : conAviso).add(fila);
    };

    if (!rutCrudo) return anotar("sin_rut", "rut", null);
    const dvColumna = limpiarTexto(f.dv);
    const separado = dvColumna ? { rut: rutCrudo.replace(/\D/g, ""), dv: dvColumna } : separarRut(rutCrudo);
    const cuerpo = separado.rut.replace(/\D/g, "");
    if (!cuerpo) return anotar("rut_ilegible", "rut", rutCrudo);

    if (separado.dv && calcularDv(cuerpo) !== separado.dv.toUpperCase()) {
      anotar("dv_incorrecto", dvColumna ? "dv" : "rut", `${cuerpo}-${separado.dv}`);
    }
    if (!limpiarTexto(f.numero_operacion)) {
      const clave = JSON.stringify(f);
      if (vistas.has(clave)) anotar("fila_repetida", null, `${cuerpo}-${separado.dv ?? ""}`);
      vistas.add(clave);
    }
    if (!nombre && campos.has("nombre_cliente")) anotar("sin_nombre", "nombre_cliente", null);

    if (campos.has("monto_deuda")) {
      const deuda = limpiarNumero(f.monto_deuda);
      if (deuda === null) anotar("deuda_ilegible", "monto_deuda", f.monto_deuda);
      else if (deuda < 0) anotar("deuda_negativa", "monto_deuda", f.monto_deuda);
    }

    const fonos = ["fono1", "fono2", "fono3", "fono4"].filter((c) => campos.has(c));
    let validos = 0;
    for (const c of fonos) {
      const crudo = limpiarTexto(f[c]);
      if (!crudo) continue;
      if (textoTelefono(f[c])) validos++;
      else anotar("telefono_descartado", c, crudo);
    }
    if (fonos.length && validos === 0) anotar("sin_telefono", fonos[0], null);

    for (const c of ["correo_1", "correo_2", "correo_3"]) {
      const correo = limpiarTexto(f[c]);
      if (correo && !CORREO.test(correo)) anotar("correo_invalido", c, correo);
    }

    const venc = limpiarTexto(f.fecha_1er_vencimiento);
    if (venc && !limpiarFechaYYYYMMDD(f.fecha_1er_vencimiento)) anotar("fecha_ilegible", "fecha_1er_vencimiento", venc);
  });

  for (const r of rechazadas) conAviso.delete(r);
  const observaciones: Phoenix.ObservacionImportacion[] = Object.entries(REGLAS)
    .filter(([codigo]) => conteo.has(codigo))
    .map(([codigo, r]) => ({ codigo, ...r, total: conteo.get(codigo)!, filas: grupos.get(codigo) ?? [] }));

  return {
    filasValidas: filas.length - rechazadas.size - conAviso.size,
    filasConAvisos: conAviso.size,
    filasRechazadas: rechazadas.size,
    observaciones,
    marcas,
  };
}
