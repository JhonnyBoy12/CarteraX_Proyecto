/**
 * @file fechas.ts
 * @description Utilidades de fecha compartidas por los servicios.
 *
 * Convención de la base:
 *  - Marcas de tiempo (`fecha`, `ultima_gestion`, `generado_en`) en UTC con
 *    `CURRENT_TIMESTAMP` → 'AAAA-MM-DD HH:MM:SS'.
 *  - Fechas de calendario (`fecha_compromiso`, `proxima_gestion`) en hora
 *    local → 'AAAA-MM-DD'.
 *
 * @since 0.3.0
 */

const DIA_MS = 86_400_000;

/** Fecha local de hoy (o de `d`) como 'AAAA-MM-DD'. */
export function fechaLocal(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Fecha y hora local (o de `d`) como 'AAAA-MM-DDTHH:MM' (recordatorios). */
export function fechaHoraLocal(d = new Date()): string {
  return `${fechaLocal(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Valida 'AAAA-MM-DDTHH:MM' (hora local) y que la fecha exista. */
export function esFechaHoraValida(texto: unknown): texto is string {
  if (typeof texto !== "string" || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(texto)) return false;
  return esFechaValida(texto.slice(0, 10));
}

/** Suma días a una fecha 'AAAA-MM-DD'. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return fechaLocal(new Date(a, m - 1, d + dias));
}

/** Convierte una marca UTC de SQLite a `Date`. */
export function desdeUtcSqlite(texto: string): Date {
  return new Date(texto.includes("T") ? texto : texto.replace(" ", "T") + "Z");
}

/** Días completos transcurridos desde una marca UTC de SQLite (o `null`). */
export function diasDesde(texto: string | null): number | null {
  if (!texto) return null;
  const t = desdeUtcSqlite(texto).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DIA_MS));
}

/** Valida 'AAAA-MM-DD' y que sea una fecha real. */
export function esFechaValida(texto: unknown): texto is string {
  if (typeof texto !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split("-").map(Number);
  const f = new Date(a, m - 1, d);
  return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d;
}
