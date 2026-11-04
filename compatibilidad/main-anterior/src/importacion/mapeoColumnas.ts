/**
 * @file mapeoColumnas.ts
 * @description Traducción de encabezados de Excel/CSV a campos internos (RF-09).
 *
 * Cambios v0.2.0:
 *  - Se conserva íntegro el diccionario original.
 *  - Se agregan alias frecuentes en CSV / planillas manuales (sección
 *    "ALIAS v0.2.0"), p. ej. `TELEFONO`, `EMAIL`, `NOMBRE CLIENTE`.
 *  - El encabezado ahora se normaliza también quitando tildes y el BOM
 *    UTF-8 (`\uFEFF`) que algunos CSV traen en la primera columna.
 *  - Nueva función pública `resolverColumna` (la usa la vista previa).
 */

/**
 * Diccionario de alias -> campo interno. Se agregan variantes a medida
 * que aparecen en nuevos archivos (cartera maestra, carteras individuales
 * de cada ejecutivo, distintos meses). Cubre RF-09.
 *
 * Las claves deben escribirse en MAYÚSCULAS y sin tildes.
 */
export const MAPEO_COLUMNAS: Record<string, string> = {
  RUT: "rut",
  DDAS_DRT_PPAL: "dv",
  NOMBRE: "nombre_cliente",
  "DEUDA TOTAL": "monto_deuda",
  DEUDA_TOTAL: "monto_deuda",
  COL_INI: "monto_deuda",
  DEUDA: "monto_deuda",
  OPERACION: "numero_operacion",
  "NRO OPERACION": "numero_operacion",
  NRO_OPERACION: "numero_operacion",
  "NUMERO OPERACION": "numero_operacion",
  "N° OPERACION": "numero_operacion",
  CUOTA: "monto_cuota",
  DDAS_MTO_CUOTA_MO: "monto_cuota",
  CICLO: "tramo_mora",
  CONTENIDO: "monto_contenido",
  NORMALIZADO: "categoria_gestion_previa",
  GESTION: "texto_gestion",
  TRAMO_MORA: "tramo_mora",
  DDAS_NROCUO_PACTADAS: "cuotas_pactadas",
  DDAS_NROCUO_PAGADAS: "cuotas_pagadas",
  DDAS_NROCUO_MOROSAS: "cuotas_morosas",
  DDAS_FEC_OTOR_CDTO: "fecha_otorgamiento",
  DDAS_FEC_1ER_VCTO: "fecha_1er_vencimiento",
  DDAS_FEC_ULT_PAGO: "fecha_ultimo_pago",
  MARCA: "marca",
  MODELO: "modelo",
  PATENTE: "patente",
  CALLE1: "calle1",
  NUMERO1: "numero1",
  COMUNA1: "comuna",
  RED: "red",
  COORDINADOR: "coordinador",
  CONCESIONARIO: "concesionario",
  ESTADO_JUICIO: "estado_juicio",
  ROL: "rol_causa",
  TRIBUNAL: "tribunal",
  CORREO_1: "correo_1",
  CORREO_2: "correo_2",
  CORREO_3: "correo_3",
  FONO1: "fono1",
  FONO2: "fono2",
  FONO3: "fono3",
  FONO4: "fono4",

  // ------------------------- ALIAS v0.2.0 -------------------------
  // Variantes habituales en CSV exportados o planillas armadas a mano.
  "RUT CLIENTE": "rut",
  RUT_CLIENTE: "rut",
  DV: "dv",
  "DIGITO VERIFICADOR": "dv",
  "NOMBRE CLIENTE": "nombre_cliente",
  NOMBRE_CLIENTE: "nombre_cliente",
  "MONTO DEUDA": "monto_deuda",
  MONTO_DEUDA: "monto_deuda",
  "TRAMO MORA": "tramo_mora",
  COMUNA: "comuna",
  DIRECCION: "calle1",
  TELEFONO: "fono1",
  TELEFONO1: "fono1",
  TELEFONO_1: "fono1",
  TELEFONO2: "fono2",
  TELEFONO_2: "fono2",
  CELULAR: "fono1",
  FONO: "fono1",
  FONO_1: "fono1",
  FONO_2: "fono2",
  FONO_3: "fono3",
  FONO_4: "fono4",
  EMAIL: "correo_1",
  CORREO: "correo_1",
  MAIL: "correo_1",
};

/**
 * Normaliza un encabezado crudo: quita BOM, tildes y espacios extra, y pasa
 * a mayúsculas.
 * @param col Encabezado tal como viene en el archivo.
 * @returns Encabezado normalizado, p. ej. `" Teléfono  1 "` → `"TELEFONO 1"`.
 */
function normalizarEncabezado(col: string): string {
  return String(col)
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Indica a qué campo interno corresponde un encabezado.
 * Prueba primero el encabezado normalizado y luego con `_` en vez de espacios.
 *
 * @param colOriginal Encabezado del archivo.
 * @returns Campo interno (ej. `"monto_deuda"`) o `null` si no se reconoce.
 * @since 0.2.0
 * @example resolverColumna("Deuda Total") // "monto_deuda"
 */
export function resolverColumna(colOriginal: string): string | null {
  const clave = normalizarEncabezado(colOriginal);
  return MAPEO_COLUMNAS[clave] ?? MAPEO_COLUMNAS[clave.replace(/ /g, "_")] ?? null;
}

/**
 * Recibe un array de filas (objetos clave/valor tal como vienen del Excel)
 * y devuelve un nuevo array con las claves renombradas a los campos internos.
 * Las columnas no reconocidas se conservan con su nombre original.
 *
 * @param filas Filas crudas (`XLSX.utils.sheet_to_json` o lector CSV).
 * @returns Filas con claves internas.
 */
export function mapearFilas(filas: Record<string, unknown>[]): Record<string, unknown>[] {
  return filas.map((fila) => {
    const nueva: Record<string, unknown> = {};
    for (const [colOriginal, valor] of Object.entries(fila)) {
      const candidato = resolverColumna(colOriginal);
      const destino = candidato ? casilleroLibre(nueva, candidato, valor) : colOriginal;
      nueva[destino] = valor;
    }
    return nueva;
  });
}

/** Casilleros disponibles para campos de contacto con varias columnas. */
const CASILLEROS: Record<string, string[]> = {
  fono: ["fono1", "fono2", "fono3", "fono4"],
  correo: ["correo_1", "correo_2", "correo_3"],
};

/**
 * Si dos columnas del archivo apuntan al mismo teléfono/correo (p. ej.
 * `TELEFONO` y `CELULAR` → `fono1`), mueve la segunda al siguiente
 * casillero libre (`fono2`, …) para no perder datos. Para cualquier otro
 * campo se mantiene el comportamiento original (la última columna gana).
 * @since 0.2.0
 */
function casilleroLibre(fila: Record<string, unknown>, campo: string, valor: unknown): string {
  const grupo = campo.startsWith("fono") ? CASILLEROS.fono : campo.startsWith("correo") ? CASILLEROS.correo : null;
  if (!grupo || fila[campo] === undefined || fila[campo] === null || valor === null) return campo;
  return grupo.find((c) => fila[c] === undefined || fila[c] === null) ?? campo;
}

/**
 * Asigna campos internos a una lista de encabezados aplicando la misma
 * regla de casilleros que `mapearFilas`: si dos columnas apuntan a `fono1`
 * (p. ej. `TELEFONO` y `CELULAR`), la segunda se muestra como `fono2`.
 * Lo usa la vista previa para mostrar el destino real de cada columna.
 *
 * @param encabezados Encabezados del archivo, en orden.
 * @returns Campo interno por encabezado (`null` = columna ignorada).
 * @since 0.2.0
 */
export function asignarCampos(encabezados: string[]): Array<string | null> {
  const usados: Record<string, unknown> = {};
  return encabezados.map((enc) => {
    const campo = resolverColumna(enc);
    if (!campo) return null;
    const destino = casilleroLibre(usados, campo, true);
    usados[destino] = true;
    return destino;
  });
}
