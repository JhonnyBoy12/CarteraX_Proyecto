/**
 * @file consultas.ts
 * @description Consultas de lectura sobre la base local (panel, historial,
 * clientes y registro de llamadas).
 *
 * Cambios v0.2.0:
 *  - Las 4 funciones originales (`contarClientes`, `topClientesPorDeuda`,
 *    `distribucionCategorias`, `historialImportaciones`) NO cambian.
 *  - Nuevas: `obtenerIndicadores`, `distribucionTramos`, `listarClientes`,
 *    `listarCategorias`, `historialLlamadas`.
 */
import Database from "better-sqlite3";

/** Fila del top de deuda (compatible con `Phoenix.ClienteResumen`). */
export interface ClienteResumen {
  rut: string;
  nombre_cliente: string | null;
  monto_deuda: number | null;
  dias_mora: number | null;
  categoria_gestion: string | null;
}

/** Conteo de clientes por categoría de gestión. */
export interface CategoriaConteo {
  categoria_gestion: string;
  total: number;
}

/** Fila del historial de importaciones (una por hoja importada). */
export interface ImportacionHistorial {
  archivo_nombre: string;
  hoja_nombre: string;
  fecha: string;
  registros_cargados: number;
  registros_corregidos: number;
  registros_con_error: number;
}

// =====================================================================
// Funciones originales v0.1.0 (sin cambios de lógica)
// =====================================================================

/**
 * Cuenta el total de clientes cargados.
 * @param db Conexión SQLite.
 * @returns Número de filas en `clientes`.
 */
export function contarClientes(db: Database.Database): number {
  const fila = db.prepare("SELECT COUNT(*) AS total FROM clientes").get() as { total: number };
  return fila.total;
}

/**
 * Clientes con mayor monto de deuda.
 * @param db Conexión SQLite.
 * @param limite Cantidad máxima de filas (por defecto 10).
 */
export function topClientesPorDeuda(db: Database.Database, limite = 10): ClienteResumen[] {
  return db
    .prepare(
      `SELECT rut, nombre_cliente, monto_deuda, dias_mora, categoria_gestion
       FROM v_clientes_resumen
       ORDER BY monto_deuda DESC
       LIMIT ?`
    )
    .all(limite) as ClienteResumen[];
}

/**
 * Distribución de clientes por categoría de gestión (RF-34).
 * @param db Conexión SQLite.
 */
export function distribucionCategorias(db: Database.Database): CategoriaConteo[] {
  return db
    .prepare(
      `SELECT categoria_gestion, COUNT(*) AS total
       FROM v_clientes_resumen
       GROUP BY categoria_gestion
       ORDER BY total DESC`
    )
    .all() as CategoriaConteo[];
}

/**
 * Historial de importaciones, de la más reciente a la más antigua (RF-13).
 * @param db Conexión SQLite.
 */
export function historialImportaciones(db: Database.Database): ImportacionHistorial[] {
  return db
    .prepare(
      `SELECT nombre_archivo AS archivo_nombre, hoja_nombre, fecha_importacion AS fecha,
              registros_importados AS registros_cargados, registros_corregidos, registros_rechazados AS registros_con_error
       FROM importaciones
       ORDER BY id DESC`
    )
    .all() as ImportacionHistorial[];
}

// =====================================================================
// Nuevas consultas v0.2.0
// =====================================================================

/**
 * Indicadores clave (KPI) para las tarjetas del panel.
 * @param db Conexión SQLite.
 * @returns Totales de cartera, promedios de mora/recuperación y actividad.
 * @since 0.2.0
 */
export function obtenerIndicadores(db: Database.Database): Phoenix.Indicadores {
  const base = db
    .prepare(
      `SELECT COUNT(*) AS totalClientes,
              COALESCE(SUM(monto_deuda), 0) AS deudaTotal,
              AVG(dias_mora) AS moraPromedio,
              AVG(pct_recuperacion) AS recuperacionPromedio
       FROM v_clientes_resumen`
    )
    .get() as {
    totalClientes: number;
    deudaTotal: number;
    moraPromedio: number | null;
    recuperacionPromedio: number | null;
  };

  const conTelefono = db
    .prepare("SELECT COUNT(DISTINCT cliente_id) AS n FROM telefonos")
    .get() as { n: number };

  const importaciones = db
    .prepare("SELECT COUNT(DISTINCT nombre_archivo) AS n FROM importaciones")
    .get() as { n: number };

  const llamadasHoy = db
    .prepare(
      `SELECT COUNT(*) AS n FROM gestiones
       WHERE categoria = 'llamada' AND date(fecha, 'localtime') = date('now', 'localtime')`
    )
    .get() as { n: number };

  return {
    totalClientes: base.totalClientes,
    deudaTotal: base.deudaTotal,
    moraPromedio: base.moraPromedio === null ? null : Math.round(base.moraPromedio),
    recuperacionPromedio:
      base.recuperacionPromedio === null ? null : Math.round(base.recuperacionPromedio * 10) / 10,
    clientesConTelefono: conTelefono.n,
    totalImportaciones: importaciones.n,
    llamadasHoy: llamadasHoy.n,
  };
}

/**
 * Clientes y deuda agrupados por tramo de mora (para el gráfico de barras).
 * Los tramos vacíos se agrupan como "(sin tramo)".
 * @param db Conexión SQLite.
 * @since 0.2.0
 */
export function distribucionTramos(db: Database.Database): Phoenix.TramoConteo[] {
  return db
    .prepare(
      `SELECT COALESCE(tramo_mora, '(sin tramo)') AS tramo_mora,
              COUNT(*) AS total,
              COALESCE(SUM(monto_deuda), 0) AS deuda
       FROM v_clientes_resumen
       GROUP BY COALESCE(tramo_mora, '(sin tramo)')
       ORDER BY total DESC
       LIMIT 12`
    )
    .all() as Phoenix.TramoConteo[];
}

/**
 * Lista paginada de clientes con sus teléfonos y correos.
 * Busca por RUT o nombre (texto parcial, sin distinguir mayúsculas).
 *
 * @param db Conexión SQLite.
 * @param filtro Texto de búsqueda, categoría, página (desde 1) y tamaño.
 * @returns Página de resultados + total de coincidencias.
 * @since 0.2.0
 * @example
 * listarClientes(db, { texto: "12345", pagina: 1, porPagina: 50 });
 */
export function listarClientes(
  db: Database.Database,
  filtro: Phoenix.FiltroClientes = {}
): Phoenix.PaginaClientes {
  const porPagina = Math.min(Math.max(filtro.porPagina ?? 50, 1), 500);
  const pagina = Math.max(filtro.pagina ?? 1, 1);

  const condiciones: string[] = [];
  const params: Record<string, unknown> = {};

  if (filtro.texto && filtro.texto.trim()) {
    condiciones.push("(c.rut LIKE @texto OR c.nombre_cliente LIKE @texto)");
    params.texto = `%${filtro.texto.trim()}%`;
  }
  if (filtro.categoria) {
    condiciones.push("c.categoria_gestion = @categoria");
    params.categoria = filtro.categoria;
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM v_clientes_resumen c ${where}`).get(params) as { n: number }
  ).n;

  // GROUP_CONCAT con separador '|' para traer teléfonos/correos en una sola consulta.
  const filas = db
    .prepare(
      `SELECT c.id, c.rut, c.dv, c.nombre_cliente, c.monto_deuda, c.dias_mora,
              c.tramo_mora, c.pct_recuperacion, c.categoria_gestion, c.comuna,
              c.origen_archivo,
              (SELECT GROUP_CONCAT(numero, '|') FROM telefonos t WHERE t.cliente_id = c.id) AS tels,
              (SELECT GROUP_CONCAT(correo, '|') FROM correos m WHERE m.cliente_id = c.id) AS mails
       FROM v_clientes_resumen c
       ${where}
       ORDER BY c.monto_deuda DESC, c.id
       LIMIT @limite OFFSET @offset`
    )
    .all({ ...params, limite: porPagina, offset: (pagina - 1) * porPagina }) as Array<
    Omit<Phoenix.ClienteDetalle, "telefonos" | "correos"> & { tels: string | null; mails: string | null }
  >;

  return {
    total,
    pagina,
    porPagina,
    filas: filas.map(({ tels, mails, ...resto }) => ({
      ...resto,
      telefonos: tels ? tels.split("|") : [],
      correos: mails ? mails.split("|") : [],
    })),
  };
}

/**
 * Categorías de gestión existentes (para el filtro de la vista Clientes).
 * @param db Conexión SQLite.
 * @since 0.2.0
 */
export function listarCategorias(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT categoria_gestion AS c FROM v_clientes_resumen
         WHERE categoria_gestion IS NOT NULL ORDER BY c`
      )
      .all() as Array<{ c: string }>
  ).map((f) => f.c);
}

/**
 * Últimas llamadas registradas desde Phoenix Desktop (tabla `gestiones`,
 * categoría `'llamada'`), con RUT y nombre del cliente si corresponde.
 * @param db Conexión SQLite.
 * @param limite Máximo de filas (por defecto 30).
 * @since 0.2.0
 */
export function historialLlamadas(db: Database.Database, limite = 30): Phoenix.LlamadaRegistrada[] {
  return db
    .prepare(
      `SELECT g.id, g.fecha, g.cliente_id, c.rut, c.nombre AS nombre_cliente, g.texto_libre, g.resultado
       FROM gestiones g
       LEFT JOIN clientes c ON c.id = g.cliente_id
       WHERE g.categoria = 'llamada'
       ORDER BY g.id DESC
       LIMIT ?`
    )
    .all(limite) as Phoenix.LlamadaRegistrada[];
}
