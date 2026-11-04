/**
 * @file servicioConfiguracion.ts
 * @description Preferencias locales del ejecutivo (RF-27): meta mensual,
 * umbral de alertas e inactividad de sesión.
 * @since 0.3.0
 */
import Database from "better-sqlite3";

import { CLAVES, guardarConfig, leerConfigNumero } from "../db/configuracion";

export const CONFIG_POR_DEFECTO: Phoenix.ConfigApp = {
  metaMensual: 0,
  diasSinGestion: 7,
  inactividadMinutos: 30,
};

export function leerConfigApp(db: Database.Database): Phoenix.ConfigApp {
  return {
    metaMensual: leerConfigNumero(db, CLAVES.META_MENSUAL, CONFIG_POR_DEFECTO.metaMensual),
    diasSinGestion: leerConfigNumero(db, CLAVES.DIAS_SIN_GESTION, CONFIG_POR_DEFECTO.diasSinGestion),
    inactividadMinutos: leerConfigNumero(db, CLAVES.INACTIVIDAD_MINUTOS, CONFIG_POR_DEFECTO.inactividadMinutos),
  };
}

/** Valida y guarda. Devuelve la configuración resultante. */
export function guardarConfigApp(db: Database.Database, cambios: Partial<Phoenix.ConfigApp>): Phoenix.ConfigApp {
  const entero = (v: unknown, min: number, max: number, campo: string): number => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${campo}: ingresa un valor entre ${min} y ${max}.`);
    return n;
  };
  if (cambios.metaMensual !== undefined) {
    guardarConfig(db, CLAVES.META_MENSUAL, entero(cambios.metaMensual, 0, 1e13, "Meta mensual"));
  }
  if (cambios.diasSinGestion !== undefined) {
    guardarConfig(db, CLAVES.DIAS_SIN_GESTION, entero(cambios.diasSinGestion, 1, 90, "Días sin gestión"));
  }
  if (cambios.inactividadMinutos !== undefined) {
    guardarConfig(db, CLAVES.INACTIVIDAD_MINUTOS, entero(cambios.inactividadMinutos, 5, 480, "Cierre por inactividad"));
  }
  return leerConfigApp(db);
}
