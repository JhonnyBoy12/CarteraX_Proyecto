/**
 * @file configuracion.ts
 * @description Lectura/escritura de la tabla `configuracion` (clave/valor).
 * Guarda preferencias que deben sobrevivir al cierre de la app (RF-27).
 */
import Database from "better-sqlite3";

/** Claves conocidas (evita errores de tipeo). */
export const CLAVES = {
  MOVIL_IP: "movil.ip",
  /** Token del vínculo con Phoenix Mobile 0.4+ (código de 6 dígitos). */
  MOVIL_TOKEN: "movil.token",
  /** Identificador estable del teléfono, para reencontrarlo si cambia de IP. */
  MOVIL_EQUIPO: "movil.equipo",
  MOVIL_NOMBRE: "movil.nombre",
  META_MENSUAL: "app.meta_mensual",
  DIAS_SIN_GESTION: "app.dias_sin_gestion",
  INACTIVIDAD_MINUTOS: "app.inactividad_minutos",
  MAX_TELEFONOS_COLA: "app.max_telefonos_cola",
} as const;

/** Lee un valor de configuración (o `porDefecto` si no existe). */
export function leerConfig(db: Database.Database, clave: string, porDefecto: string | null = null): string | null {
  const fila = db.prepare("SELECT valor FROM configuracion WHERE clave = ?").get(clave) as
    | { valor: string | null }
    | undefined;
  return fila?.valor ?? porDefecto;
}

/** Guarda (inserta o reemplaza) un valor. `null` borra el valor. */
export function guardarConfig(db: Database.Database, clave: string, valor: string | number | boolean | null): void {
  db.prepare(
    `INSERT INTO configuracion (clave, valor, actualizado_en)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = CURRENT_TIMESTAMP`
  ).run(clave, valor === null ? null : String(valor));
}

/** Lee un valor numérico (o `porDefecto` si no existe o no es número). */
export function leerConfigNumero(db: Database.Database, clave: string, porDefecto: number): number {
  const v = Number(leerConfig(db, clave) ?? "");
  return leerConfig(db, clave) !== null && Number.isFinite(v) ? v : porDefecto;
}
