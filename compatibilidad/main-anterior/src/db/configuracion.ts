/**
 * @file configuracion.ts
 * @description Lectura/escritura de la tabla `configuracion` (clave/valor).
 * Guarda preferencias que deben sobrevivir al cierre de la app, como la IP
 * del teléfono Phoenix Mobile o el puerto del servidor HTTP.
 *
 * @since 0.2.0
 */
import Database from "better-sqlite3";

/** Claves conocidas (evita errores de tipeo al llamar a las funciones). */
export const CLAVES = {
  MOVIL_IP: "movil.ip",
  SERVIDOR_HABILITADO: "servidor.habilitado",
  SERVIDOR_PUERTO: "servidor.puerto",
  SERVIDOR_ACCESO_RED: "servidor.acceso_red",
} as const;

/**
 * Lee un valor de configuración.
 * @param db Conexión SQLite.
 * @param clave Clave a buscar (usar `CLAVES.*`).
 * @param porDefecto Valor que se devuelve si la clave no existe.
 * @returns El valor guardado como texto, o `porDefecto`.
 */
export function leerConfig(db: Database.Database, clave: string, porDefecto: string | null = null): string | null {
  const fila = db.prepare("SELECT valor FROM configuracion WHERE clave = ?").get(clave) as
    | { valor: string | null }
    | undefined;
  return fila?.valor ?? porDefecto;
}

/**
 * Guarda (inserta o reemplaza) un valor de configuración.
 * @param db Conexión SQLite.
 * @param clave Clave a guardar (usar `CLAVES.*`).
 * @param valor Valor; se convierte a texto. `null` borra el valor.
 */
export function guardarConfig(db: Database.Database, clave: string, valor: string | number | boolean | null): void {
  db.prepare(
    `INSERT INTO configuracion (clave, valor, actualizado_en)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = CURRENT_TIMESTAMP`
  ).run(clave, valor === null ? null : String(valor));
}

/**
 * Lee un valor booleano (`"1"`/`"true"` → `true`).
 * @param db Conexión SQLite.
 * @param clave Clave a leer.
 * @param porDefecto Valor si no existe.
 */
export function leerConfigBool(db: Database.Database, clave: string, porDefecto: boolean): boolean {
  const v = leerConfig(db, clave);
  if (v === null) return porDefecto;
  return v === "1" || v.toLowerCase() === "true";
}

/**
 * Lee un valor numérico entero.
 * @param db Conexión SQLite.
 * @param clave Clave a leer.
 * @param porDefecto Valor si no existe o no es número válido.
 */
export function leerConfigNumero(db: Database.Database, clave: string, porDefecto: number): number {
  const v = Number.parseInt(leerConfig(db, clave) ?? "", 10);
  return Number.isFinite(v) ? v : porDefecto;
}
