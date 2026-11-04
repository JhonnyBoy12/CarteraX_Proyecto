/**
 * @file conexion.ts
 * @description Apertura única (singleton) de la base SQLite local.
 *
 *  - `journal_mode = WAL` para lecturas fluidas mientras se escribe.
 *  - `foreign_keys = ON` (SQLite las trae apagadas por defecto).
 *  - El esquema se lee de `schema.sql` (el build lo copia a `dist/db/`) y
 *    luego se aplican las migraciones de `migraciones.ts`.
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

import { aplicarMigraciones } from "./migraciones";

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");

let instancia: Database.Database | null = null;
let rutaActual: string | null = null;

/**
 * Devuelve la conexión única a la base local. Si ya existe la reutiliza.
 * @param rutaDb Ruta del archivo `.db` (en Electron: carpeta userData).
 */
export function obtenerConexion(rutaDb: string): Database.Database {
  if (instancia) return instancia;

  fs.mkdirSync(path.dirname(rutaDb), { recursive: true });
  instancia = new Database(rutaDb);
  instancia.pragma("journal_mode = WAL");
  instancia.pragma("foreign_keys = ON");
  instancia.exec(SCHEMA_SQL);
  aplicarMigraciones(instancia);

  rutaActual = rutaDb;
  return instancia;
}

/** Cierra la conexión (al salir o antes de restaurar un respaldo). */
export function cerrarConexion(): void {
  if (instancia) {
    try {
      instancia.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* la base pudo cerrarse por otro motivo */
    }
    instancia.close();
    instancia = null;
    rutaActual = null;
  }
}

/** Ruta del archivo de base de datos abierto actualmente. */
export function rutaDbActual(): string | null {
  return rutaActual;
}
