/**
 * @file conexion.ts
 * @description Apertura única (singleton) de la base SQLite local.
 *
 * Cambios v0.2.0:
 *  - Se activa `journal_mode = WAL` para permitir lecturas concurrentes
 *    (la ventana de Electron y el servidor HTTP leen a la vez).
 *  - Se agrega `rutaDbActual()` para que el servidor sepa qué base usa.
 *  - Lógica original intacta: el esquema se lee de `schema.sql` y se
 *    ejecuta con `CREATE ... IF NOT EXISTS` en cada arranque.
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

// Nota: el build copia schema.sql junto a este archivo (dist/db/schema.sql),
// por eso se resuelve con __dirname tanto en desarrollo como empaquetado.
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");

let instancia: Database.Database | null = null;
let rutaActual: string | null = null;

/**
 * Devuelve la conexión única a la base de datos local del usuario.
 * Si ya existe, la reutiliza (el parámetro se ignora en llamadas siguientes).
 *
 * @param rutaDb Ruta del archivo `.db`. En Electron se calcula en `main.ts`
 *               con `app.getPath('userData')`; en modo servidor independiente
 *               con la variable `PHOENIX_DB` o `./datos/phoenix_local.db`.
 * @returns Conexión `better-sqlite3` lista para usar.
 * @example
 * const db = obtenerConexion("C:/Users/yo/AppData/Roaming/ers-phoenix/phoenix_local.db");
 */
export function obtenerConexion(rutaDb: string): Database.Database {
  if (instancia) return instancia;

  fs.mkdirSync(path.dirname(rutaDb), { recursive: true });
  instancia = new Database(rutaDb);
  instancia.pragma("journal_mode = WAL");
  instancia.pragma("foreign_keys = ON");
  instancia.exec(SCHEMA_SQL);

  // Compatibilidad con bases creadas antes del control de archivos duplicados.
  const columnasImportaciones = instancia.prepare("PRAGMA table_info(importaciones)").all() as Array<{ name: string }>;
  const tieneArchivoHash = columnasImportaciones.some((columna) => columna.name === "archivo_hash");
  if (!tieneArchivoHash) {
    instancia.exec("ALTER TABLE importaciones ADD COLUMN archivo_hash TEXT");
  }
  instancia.exec("CREATE INDEX IF NOT EXISTS idx_importaciones_hash ON importaciones(cartera_id, archivo_hash)");

  // Migración liviana para bases creadas antes de la cola de llamadas.
  const columnasTelefonos = instancia.prepare("PRAGMA table_info(telefonos)").all() as Array<{ name: string }>;
  const nombresTelefonos = new Set(columnasTelefonos.map((columna) => columna.name));
  if (!nombresTelefonos.has("estado_llamada")) {
    instancia.exec("ALTER TABLE telefonos ADD COLUMN estado_llamada TEXT NOT NULL DEFAULT 'PENDIENTE'");
  }
  if (!nombresTelefonos.has("intentos_llamada")) {
    instancia.exec("ALTER TABLE telefonos ADD COLUMN intentos_llamada INTEGER NOT NULL DEFAULT 0");
  }
  if (!nombresTelefonos.has("ultima_llamada")) {
    instancia.exec("ALTER TABLE telefonos ADD COLUMN ultima_llamada TEXT");
  }

  rutaActual = rutaDb;
  return instancia;
}

/** Cierra la conexión (se llama al cerrar la última ventana). */
export function cerrarConexion(): void {
  if (instancia) {
    instancia.close();
    instancia = null;
    rutaActual = null;
  }
}

/**
 * Ruta del archivo de base de datos abierto actualmente.
 * @returns La ruta o `null` si aún no se abre ninguna conexión.
 */
export function rutaDbActual(): string | null {
  return rutaActual;
}
