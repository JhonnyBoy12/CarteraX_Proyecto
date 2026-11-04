/**
 * @file gestorServidor.ts
 * @description Ciclo de vida del servidor HTTP cuando corre DENTRO de
 * Electron: lo inicia con la configuración guardada en la base, lo
 * reinicia cuando el usuario cambia puerto / acceso en red, y lo detiene
 * al cerrar la app.
 *
 * Valores por defecto: habilitado, puerto 3737, sólo localhost.
 *
 * @since 0.2.0
 */
import Database from "better-sqlite3";

import { CLAVES, guardarConfig, leerConfigBool, leerConfigNumero } from "../db/configuracion";
import { ControlServidor, iniciarServidor } from "./servidorHttp";

/** Puerto por defecto del backend HTTP. */
export const PUERTO_POR_DEFECTO = 3737;

let control: ControlServidor | null = null;
let ultimoError: string | undefined;

/**
 * Lee la configuración del servidor guardada en `configuracion`.
 * @param db Conexión SQLite.
 */
export function leerConfigServidor(db: Database.Database): Phoenix.ConfigServidor {
  return {
    habilitado: leerConfigBool(db, CLAVES.SERVIDOR_HABILITADO, true),
    puerto: leerConfigNumero(db, CLAVES.SERVIDOR_PUERTO, PUERTO_POR_DEFECTO),
    accesoRed: leerConfigBool(db, CLAVES.SERVIDOR_ACCESO_RED, false),
  };
}

/**
 * Estado actual del servidor embebido (aunque esté detenido).
 * @param db Conexión SQLite.
 */
export function estadoServidor(db: Database.Database): Phoenix.EstadoServidor {
  const config = leerConfigServidor(db);
  if (control) return { ...control.estado(), habilitado: config.habilitado };
  return { ...config, activo: false, urls: [], error: ultimoError, modo: "electron" };
}

/**
 * Inicia el servidor según la configuración guardada (si está habilitado).
 * Nunca lanza: si falla (p. ej. puerto ocupado) el error queda en el estado
 * y la app de escritorio sigue funcionando normalmente por IPC.
 *
 * @param db Conexión SQLite.
 */
export async function arrancarSegunConfig(db: Database.Database): Promise<Phoenix.EstadoServidor> {
  await detenerServidor();
  const config = leerConfigServidor(db);
  ultimoError = undefined;
  if (config.habilitado) {
    try {
      control = await iniciarServidor(db, {
        puerto: config.puerto,
        accesoRed: config.accesoRed,
        modo: "electron",
        token: process.env.PHOENIX_TOKEN,
      });
    } catch (e) {
      ultimoError = (e as Error).message;
      console.error("[servidor] No se pudo iniciar:", ultimoError);
    }
  }
  return estadoServidor(db);
}

/**
 * Guarda una nueva configuración y reinicia el servidor con ella.
 * @param db Conexión SQLite.
 * @param config Cambios parciales (habilitado, puerto, accesoRed).
 */
export async function configurarServidor(
  db: Database.Database,
  config: Partial<Phoenix.ConfigServidor>
): Promise<Phoenix.EstadoServidor> {
  if (config.habilitado !== undefined) guardarConfig(db, CLAVES.SERVIDOR_HABILITADO, config.habilitado ? 1 : 0);
  if (config.accesoRed !== undefined) guardarConfig(db, CLAVES.SERVIDOR_ACCESO_RED, config.accesoRed ? 1 : 0);
  if (config.puerto !== undefined) {
    const p = Math.trunc(Number(config.puerto));
    if (!(p >= 1024 && p <= 65535)) throw new Error("El puerto debe estar entre 1024 y 65535");
    guardarConfig(db, CLAVES.SERVIDOR_PUERTO, p);
  }
  return arrancarSegunConfig(db);
}

/** Detiene el servidor si está corriendo. */
export async function detenerServidor(): Promise<void> {
  if (control) {
    const c = control;
    control = null;
    await c.detener();
  }
}
