/**
 * @file normalizador.ts
 * @description Limpieza de texto, números y fechas provenientes de Excel o
 * CSV (RF-10, RF-12).
 *
 * Cambios v0.2.0 (compatibles hacia atrás, misma firma en las 3 funciones):
 *  - `limpiarNumero`: si el valor viene como TEXTO (típico de CSV) ahora
 *    entiende formato chileno `"$ 1.234.567"`, `"1.234,5"` y también
 *    `"1,234.5"`. Antes `parseFloat("1.234.567")` devolvía `1.234`.
 *    Si el valor ya viene como número (Excel), el resultado es idéntico.
 *  - `limpiarFechaYYYYMMDD`: agrega `dd/mm/aaaa`, `dd-mm-aaaa`,
 *    `aaaa-mm-dd` y fechas seriales de Excel (ej. `45106`), que antes
 *    producían fechas inválidas. Los casos `20230629`, `0` y `Date`
 *    funcionan igual que antes.
 */

/** Textos que se consideran "vacío" aunque traigan algo escrito. */
const PLACEHOLDERS_VACIOS = new Set([
  "",
  "0",
  "SIN VALOR",
  "S/V",
  "N/A",
  "NA",
  "-",
  "NAN",
  "NONE",
  "UNDEFINED",
]);

/**
 * Limpia un texto: quita espacios extra y descarta placeholders sin
 * significado (`"S/V"`, `"N/A"`, `"0"`, `"-"`, …).
 *
 * @param valor Valor crudo de la celda.
 * @returns Texto limpio o `null` si está vacío / es un placeholder.
 * @example limpiarTexto("  Juan   Pérez ") // "Juan Pérez"
 * @example limpiarTexto("S/V")              // null
 */
export function limpiarTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(/\s+/g, " ");
  if (PLACEHOLDERS_VACIOS.has(texto.toUpperCase())) return null;
  return texto;
}

/**
 * Convierte un texto con formato numérico local a un `number`.
 * Reglas (prioridad al formato chileno):
 *  - Se quitan `$`, `CLP`, `%` y espacios.
 *  - Con `.` y `,` a la vez → el ÚLTIMO símbolo es el decimal.
 *  - Sólo `,` → una coma es decimal (`"12,5"`); varias son miles.
 *  - Sólo `.` → varios puntos son miles (`"1.234.567"`); un punto seguido
 *    de exactamente 3 dígitos también es miles (`"1.500"` = 1500);
 *    en otro caso es decimal (`"12.5"`).
 *
 * @param texto Texto ya convertido a string.
 * @returns Número o `NaN` si no es interpretable.
 * @since 0.2.0
 */
function textoANumero(texto: string): number {
  let t = texto.replace(/\s/g, "").replace(/^\$|CLP|\$|%/gi, "");
  if (t === "" || !/^[-+]?[\d.,]+$/.test(t)) return NaN;

  const tienePunto = t.includes(".");
  const tieneComa = t.includes(",");

  if (tienePunto && tieneComa) {
    const decimal = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
    const miles = decimal === "," ? "." : ",";
    t = t.split(miles).join("").replace(decimal, ".");
  } else if (tieneComa) {
    t = (t.match(/,/g)!.length > 1) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (tienePunto) {
    const puntos = t.match(/\./g)!.length;
    if (puntos > 1 || /^[-+]?[1-9]\d{0,2}\.\d{3}$/.test(t)) t = t.replace(/\./g, "");
  }
  return Number(t);
}

/**
 * Convierte a número; devuelve `null` si no es un número válido.
 *
 * @param valor Número (Excel) o texto (CSV) a convertir.
 * @returns Número finito o `null`.
 * @example limpiarNumero(1500)          // 1500   (Excel, igual que v0.1.0)
 * @example limpiarNumero("$ 1.234.567") // 1234567 (nuevo en v0.2.0)
 * @example limpiarNumero("12,5")        // 12.5    (nuevo en v0.2.0)
 */
export function limpiarNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const texto = String(valor).trim();
  // Primero se prueba el camino original (parseFloat) cuando el texto es un
  // número "limpio" sin separadores ambiguos, para no alterar resultados previos.
  if (/^[-+]?\d+(\.\d+)?$/.test(texto) && !/^[-+]?[1-9]\d{0,2}\.\d{3}$/.test(texto)) {
    const num = parseFloat(texto);
    return Number.isFinite(num) ? num : null;
  }
  const num = textoANumero(texto);
  return Number.isFinite(num) ? num : null;
}

/** Rango de años aceptado como fecha válida de cartera. */
const ANIO_MIN = 1900;
const ANIO_MAX = 2100;

/**
 * Arma `YYYY-MM-DD` validando que la fecha exista (ej. rechaza 31/02).
 * Se calcula en UTC para que el resultado no dependa de la zona horaria.
 * @since 0.2.0
 */
function armarFechaIso(anio: number, mes: number, dia: number): string | null {
  if (anio < ANIO_MIN || anio > ANIO_MAX) return null;
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null;
  return f.toISOString().slice(0, 10);
}

/**
 * Convierte un número de serie de Excel (días desde 1899-12-30) a ISO.
 * @since 0.2.0
 */
function serialExcelAIso(serial: number): string | null {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  const f = new Date(ms);
  return armarFechaIso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
}

/**
 * Normaliza una fecha a `'YYYY-MM-DD'`.
 *
 * Formatos soportados:
 *  - Entero/texto `20230629` (formato de los archivos reales) — v0.1.0
 *  - `0`, vacío o `"nan"` → `null` — v0.1.0
 *  - Objeto `Date` (celda con formato fecha en Excel) — v0.1.0
 *  - `29/06/2023`, `29-06-2023`, `29.06.2023` — **nuevo v0.2.0**
 *  - `2023-06-29` — **nuevo v0.2.0**
 *  - Serial de Excel `45106` — **nuevo v0.2.0**
 *
 * @param valor Valor crudo de la celda.
 * @returns Fecha ISO o `null` si no es interpretable.
 */
export function limpiarFechaYYYYMMDD(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  }

  const crudo = String(valor).trim();

  // dd/mm/aaaa, dd-mm-aaaa o dd.mm.aaaa (CSV chileno). Se evalúa antes del
  // split(".") original para no cortar "29.06.2023".
  const dmy = crudo.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:\s.*)?$/);
  if (dmy) return armarFechaIso(+dmy[3], +dmy[2], +dmy[1]);

  // aaaa-mm-dd (ISO, con o sin hora)
  const ymd = crudo.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return armarFechaIso(+ymd[1], +ymd[2], +ymd[3]);

  const texto = crudo.split(".")[0];
  if (texto === "0" || texto === "" || texto.toLowerCase() === "nan") return null;

  if (/^\d{8}$/.test(texto)) {
    return armarFechaIso(+texto.slice(0, 4), +texto.slice(4, 6), +texto.slice(6, 8));
  }

  // Serial de Excel (≈ años 1954–2119). Cubre celdas fecha leídas con raw:true.
  if (/^\d{5}$/.test(texto)) {
    const serial = Number(texto);
    if (serial >= 20000 && serial <= 80000) return serialExcelAIso(serial);
  }

  const intento = new Date(crudo);
  if (Number.isNaN(intento.getTime())) return null;
  const anio = intento.getFullYear();
  if (anio < ANIO_MIN || anio > ANIO_MAX) return null;
  return intento.toISOString().slice(0, 10);
}

/**
 * Separa un RUT chileno escrito con dígito verificador (`"12.345.678-9"`,
 * `"12345678-K"`) en cuerpo y DV. Si el RUT no trae guion se devuelve tal
 * cual (caso de los Excel reales, donde el DV viene en `DDAS_DRT_PPAL`).
 *
 * @param rut RUT ya limpiado con `limpiarTexto`.
 * @returns `{ rut, dv }`; `dv` es `null` si no venía incluido.
 * @since 0.2.0
 * @example separarRut("12.345.678-9") // { rut: "12345678", dv: "9" }
 * @example separarRut("12345678")     // { rut: "12345678", dv: null }
 */
export function separarRut(rut: string): { rut: string; dv: string | null } {
  const m = rut.replace(/\s/g, "").match(/^([\d.]+)-([\dkK])$/);
  if (!m) return { rut, dv: null };
  return { rut: m[1].replace(/\./g, ""), dv: m[2].toUpperCase() };
}
