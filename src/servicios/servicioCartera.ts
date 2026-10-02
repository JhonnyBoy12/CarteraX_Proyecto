/**
 * @file servicioCartera.ts
 * @description Capa de servicios de cartera. Es el ÚNICO punto que usan
 * los dos "canales" de entrada del backend:
 *
 *   Ventana Electron ──IPC──┐
 *                            ├──▶ servicioCartera ──▶ importacion/ + db/
 *   Navegador / otro PC ─HTTP┘
 *
 * Así la lógica no se duplica y ambos canales responden lo mismo.
 *
 * @since 0.2.0
 */
import Database from "better-sqlite3";

import {
  contarClientes,
  topClientesPorDeuda,
  distribucionCategorias,
  historialImportaciones,
  obtenerIndicadores,
  distribucionTramos,
  listarClientes,
  listarCategorias,
} from "../db/consultas";
import { importarArchivo } from "../importacion/importador";
import { previsualizarArchivo } from "../importacion/previsualizador";

/**
 * Resumen del panel. Mantiene los 3 campos de la v0.1.0
 * (`totalClientes`, `topDeuda`, `categorias`) y agrega `indicadores` y `tramos`.
 *
 * @param db Conexión SQLite.
 * @param top Cantidad de clientes en el ranking de deuda (por defecto 5, como v0.1.0).
 */
export function obtenerResumen(db: Database.Database, top = 5): Phoenix.ResumenCartera {
  return {
    totalClientes: contarClientes(db),
    topDeuda: topClientesPorDeuda(db, top),
    categorias: distribucionCategorias(db),
    indicadores: obtenerIndicadores(db),
    tramos: distribucionTramos(db),
  };
}

/**
 * Historial de importaciones (una fila por hoja importada).
 * @param db Conexión SQLite.
 */
export function obtenerHistorial(db: Database.Database): Phoenix.ImportacionHistorial[] {
  return historialImportaciones(db);
}

/**
 * Búsqueda paginada de clientes con teléfonos y correos.
 * @param db Conexión SQLite.
 * @param filtro Texto (RUT/nombre), categoría, página y tamaño.
 */
export function buscarClientes(db: Database.Database, filtro: Phoenix.FiltroClientes): Phoenix.PaginaClientes {
  return listarClientes(db, filtro ?? {});
}

/**
 * Categorías de gestión disponibles para filtrar.
 * @param db Conexión SQLite.
 */
export function obtenerCategorias(db: Database.Database): string[] {
  return listarCategorias(db);
}

/**
 * Vista previa de un archivo (no escribe en la base).
 * @param ruta Ruta en disco.
 * @param nombreOriginal Nombre a mostrar (subidas HTTP).
 */
export function previsualizar(ruta: string, nombreOriginal?: string): Phoenix.PreviaArchivo {
  return previsualizarArchivo(ruta, nombreOriginal);
}

/**
 * Importa un archivo CSV o Excel a la base local.
 * @param db Conexión SQLite.
 * @param ruta Ruta en disco.
 * @param nombreOriginal Nombre a registrar como origen (subidas HTTP).
 * @param usuarioId Ejecutivo que importa (null hasta implementar login RF-01).
 */
export function importar(
  db: Database.Database,
  ruta: string,
  nombreOriginal?: string,
  usuarioId: string | null = null
): Phoenix.ResultadoImportacion {
  return importarArchivo(db, ruta, usuarioId, nombreOriginal);
}
