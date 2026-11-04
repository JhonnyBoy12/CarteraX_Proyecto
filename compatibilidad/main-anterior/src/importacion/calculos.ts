/**
 * @file calculos.ts
 * @description Indicadores derivados por cliente (RF-32, RF-33).
 * v0.2.0: sólo se agregó documentación; la lógica no cambia.
 */

/**
 * Días de mora desde la fecha de 1er vencimiento hasta hoy. RF-33
 * @param fecha1erVencimientoIso Fecha `YYYY-MM-DD` (de `limpiarFechaYYYYMMDD`).
 * @returns Días (mínimo 0) o `null` si no hay fecha válida.
 * @example calcularDiasMora("2024-01-01") // días transcurridos hasta hoy
 */
export function calcularDiasMora(fecha1erVencimientoIso: string | null): number | null {
  if (!fecha1erVencimientoIso) return null;
  const venc = new Date(`${fecha1erVencimientoIso}T00:00:00`);
  if (Number.isNaN(venc.getTime())) return null;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const diffMs = hoy.getTime() - venc.getTime();
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(dias, 0);
}

/**
 * % de recuperación = cuotas pagadas / cuotas pactadas. RF-32
 * @param cuotasPagadas Cuotas pagadas (null = 0).
 * @param cuotasPactadas Cuotas totales; si es 0 o null el resultado es null.
 * @returns Porcentaje con 2 decimales, p. ej. `33.33`.
 */
export function calcularPctRecuperacion(
  cuotasPagadas: number | null,
  cuotasPactadas: number | null
): number | null {
  if (!cuotasPactadas) return null;
  const pct = ((cuotasPagadas ?? 0) / cuotasPactadas) * 100;
  return Math.round(pct * 100) / 100;
}
