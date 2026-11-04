/** Consultas de lectura sobre la base local. Todas las vistas de cartera se limitan a un período. */
import Database from "better-sqlite3";

export interface ClienteResumen {
  rut: string;
  nombre_cliente: string | null;
  monto_deuda: number | null;
  dias_mora: number | null;
  categoria_gestion: string | null;
}
export interface CategoriaConteo { categoria_gestion: string; total: number; }
export interface ImportacionHistorial {
  archivo_nombre: string; hoja_nombre: string; fecha: string;
  registros_cargados: number; registros_corregidos: number; registros_con_error: number;
}

export interface PuntoEvolucionCartera {
  periodo_id: string;
  periodo: string;
  fecha_inicio: string;
  total_clientes: number;
  deuda_total: number;
}

/** Períodos con cartera disponible, ordenados del más reciente al más antiguo. */
export function listarPeriodos(db: Database.Database): Phoenix.PeriodoCartera[] {
  return db.prepare(`
    SELECT p.id, p.nombre, p.fecha_inicio, p.fecha_fin,
           COUNT(DISTINCT cc.cliente_id) AS total_clientes
    FROM periodos p
    LEFT JOIN carteras ca ON ca.periodo_id = p.id
    LEFT JOIN cartera_clientes cc ON cc.cartera_id = ca.id
    GROUP BY p.id, p.nombre, p.fecha_inicio, p.fecha_fin
    HAVING COUNT(DISTINCT cc.cliente_id) > 0
    ORDER BY p.fecha_inicio DESC, p.id DESC
  `).all() as Phoenix.PeriodoCartera[];
}

/**
 * Evolución mensual de la cartera. Cuenta cada cliente una vez por período y
 * suma sus operaciones dentro de ese mismo período, evitando mezclar meses.
 */
export function evolucionCartera(db: Database.Database): PuntoEvolucionCartera[] {
  return db.prepare(`
    WITH cartera_periodo AS (
      SELECT ca.periodo_id, cc.cliente_id
      FROM carteras ca JOIN cartera_clientes cc ON cc.cartera_id = ca.id
      GROUP BY ca.periodo_id, cc.cliente_id
    ),
    operaciones_periodo AS (
      SELECT periodo_id, cliente_id, SUM(deuda_total) AS deuda_total
      FROM operaciones GROUP BY periodo_id, cliente_id
    ),
    resumen_periodo AS (
      SELECT cp.periodo_id, COUNT(*) AS total_clientes,
             COALESCE(SUM(op.deuda_total), 0) AS deuda_total
      FROM cartera_periodo cp
      LEFT JOIN operaciones_periodo op
        ON op.periodo_id = cp.periodo_id AND op.cliente_id = cp.cliente_id
      GROUP BY cp.periodo_id
    )
    SELECT p.id AS periodo_id, p.nombre AS periodo, p.fecha_inicio,
           rp.total_clientes, rp.deuda_total
    FROM resumen_periodo rp JOIN periodos p ON p.id = rp.periodo_id
    WHERE rp.total_clientes > 0
    ORDER BY p.fecha_inicio ASC, p.id ASC
  `).all() as PuntoEvolucionCartera[];
}

/** Resuelve el período solicitado o selecciona el período más reciente con clientes. */
function resolverPeriodo(db: Database.Database, periodoId?: string): string | null {
  if (periodoId) {
    const existe = db.prepare("SELECT id FROM periodos WHERE id = ?").get(periodoId) as { id: string } | undefined;
    if (!existe) throw new Error(`No existe el período ${periodoId}.`);
    return existe.id;
  }
  const fila = db.prepare(`
    SELECT p.id FROM periodos p
    JOIN carteras ca ON ca.periodo_id = p.id
    JOIN cartera_clientes cc ON cc.cartera_id = ca.id
    GROUP BY p.id ORDER BY p.fecha_inicio DESC, p.id DESC LIMIT 1
  `).get() as { id: string } | undefined;
  return fila?.id ?? null;
}

/** CTE común: agrega operaciones por cliente dentro del período y limita a la cartera del período. */
const BASE_CLIENTES = `
  WITH periodo AS (SELECT @periodoId AS periodo_id),
  operaciones_periodo AS (
    SELECT o.cliente_id, SUM(o.deuda_total) AS monto_deuda,
           MAX(o.dias_mora) AS dias_mora, MAX(o.tramo_mora) AS tramo_mora,
           AVG(o.pct_recuperacion) AS pct_recuperacion
    FROM operaciones o JOIN periodo p ON p.periodo_id = o.periodo_id
    GROUP BY o.cliente_id
  ),
  cartera_periodo AS (
    SELECT cc.cliente_id, MAX(cc.categoria_gestion) AS categoria_gestion,
           MAX(i.nombre_archivo) AS origen_archivo
    FROM cartera_clientes cc
    JOIN carteras ca ON ca.id = cc.cartera_id
    JOIN periodo p ON p.periodo_id = ca.periodo_id
    LEFT JOIN importaciones i ON i.cartera_id = ca.id
    GROUP BY cc.cliente_id
  ),
  resumen AS (
    SELECT c.id, c.rut, c.dv, c.nombre AS nombre_cliente,
           COALESCE(op.monto_deuda, 0) AS monto_deuda, op.dias_mora, op.tramo_mora,
           op.pct_recuperacion, cp.categoria_gestion,
           (SELECT d.comuna FROM direcciones d WHERE d.cliente_id = c.id ORDER BY d.created_at DESC LIMIT 1) AS comuna,
           cp.origen_archivo
    FROM cartera_periodo cp
    JOIN clientes c ON c.id = cp.cliente_id
    LEFT JOIN operaciones_periodo op ON op.cliente_id = c.id
  )`;

export function contarClientes(db: Database.Database, periodoId?: string): number {
  const periodo = resolverPeriodo(db, periodoId);
  if (!periodo) return 0;
  return (db.prepare(`${BASE_CLIENTES} SELECT COUNT(*) AS total FROM resumen`).get({ periodoId: periodo }) as { total: number }).total;
}

export function topClientesPorDeuda(db: Database.Database, limite = 10, periodoId?: string): ClienteResumen[] {
  const periodo = resolverPeriodo(db, periodoId);
  if (!periodo) return [];
  return db.prepare(`${BASE_CLIENTES}
    SELECT rut, nombre_cliente, monto_deuda, dias_mora, categoria_gestion FROM resumen
    ORDER BY monto_deuda DESC LIMIT @limite`).all({ periodoId: periodo, limite }) as ClienteResumen[];
}

export function distribucionCategorias(db: Database.Database, periodoId?: string): CategoriaConteo[] {
  const periodo = resolverPeriodo(db, periodoId);
  if (!periodo) return [];
  return db.prepare(`${BASE_CLIENTES}
    SELECT COALESCE(categoria_gestion, 'Sin categoría') AS categoria_gestion, COUNT(*) AS total
    FROM resumen GROUP BY categoria_gestion ORDER BY total DESC`).all({ periodoId: periodo }) as CategoriaConteo[];
}

export function historialImportaciones(db: Database.Database): ImportacionHistorial[] {
  return db.prepare(`
    SELECT i.nombre_archivo AS archivo_nombre, COALESCE(i.hoja_nombre, '') AS hoja_nombre,
           i.fecha_importacion AS fecha, i.registros_importados AS registros_cargados,
           i.registros_corregidos, i.registros_rechazados AS registros_con_error
    FROM importaciones i ORDER BY i.fecha_importacion DESC, i.id DESC
  `).all() as ImportacionHistorial[];
}

export function obtenerIndicadores(db: Database.Database, periodoId?: string): Phoenix.Indicadores {
  const periodo = resolverPeriodo(db, periodoId);
  if (!periodo) return { totalClientes: 0, deudaTotal: 0, moraPromedio: null, recuperacionPromedio: null, clientesConTelefono: 0, totalImportaciones: 0, llamadasHoy: 0 };
  const base = db.prepare(`${BASE_CLIENTES}
    SELECT COUNT(*) AS totalClientes, COALESCE(SUM(monto_deuda), 0) AS deudaTotal,
           AVG(dias_mora) AS moraPromedio, AVG(pct_recuperacion) AS recuperacionPromedio FROM resumen`).get({ periodoId: periodo }) as {
      totalClientes: number; deudaTotal: number; moraPromedio: number | null; recuperacionPromedio: number | null;
    };
  const telefonos = db.prepare(`${BASE_CLIENTES}
    SELECT COUNT(DISTINCT r.id) AS n FROM resumen r WHERE EXISTS (SELECT 1 FROM telefonos t WHERE t.cliente_id = r.id AND t.valido = 1)`).get({ periodoId: periodo }) as { n: number };
  const importaciones = db.prepare(`SELECT COUNT(*) AS n FROM importaciones i JOIN carteras ca ON ca.id = i.cartera_id WHERE ca.periodo_id = @periodoId`).get({ periodoId: periodo }) as { n: number };
  const llamadas = db.prepare(`SELECT COUNT(*) AS n FROM gestiones g JOIN carteras ca ON ca.id = g.cartera_id WHERE ca.periodo_id = @periodoId AND g.categoria = 'llamada' AND date(g.fecha, 'localtime') = date('now', 'localtime')`).get({ periodoId: periodo }) as { n: number };
  return { totalClientes: base.totalClientes, deudaTotal: base.deudaTotal,
    moraPromedio: base.moraPromedio === null ? null : Math.round(base.moraPromedio),
    recuperacionPromedio: base.recuperacionPromedio === null ? null : Math.round(base.recuperacionPromedio * 10) / 10,
    clientesConTelefono: telefonos.n, totalImportaciones: importaciones.n, llamadasHoy: llamadas.n };
}

export function distribucionTramos(db: Database.Database, periodoId?: string): Phoenix.TramoConteo[] {
  const periodo = resolverPeriodo(db, periodoId);
  if (!periodo) return [];
  return db.prepare(`${BASE_CLIENTES}
    SELECT COALESCE(tramo_mora, '(sin tramo)') AS tramo_mora, COUNT(*) AS total,
           COALESCE(SUM(monto_deuda), 0) AS deuda FROM resumen
    GROUP BY COALESCE(tramo_mora, '(sin tramo)') ORDER BY total DESC LIMIT 12`).all({ periodoId: periodo }) as Phoenix.TramoConteo[];
}

export function listarClientes(db: Database.Database, filtro: Phoenix.FiltroClientes = {}): Phoenix.PaginaClientes {
  const periodo = resolverPeriodo(db, filtro.periodoId);
  const porPagina = Math.min(Math.max(filtro.porPagina ?? 50, 1), 500);
  const pagina = Math.max(filtro.pagina ?? 1, 1);
  if (!periodo) return { total: 0, pagina, porPagina, filas: [] };
  const condiciones: string[] = [];
  const params: Record<string, unknown> = {};
  if (filtro.texto?.trim()) { condiciones.push("(rut LIKE @texto OR nombre_cliente LIKE @texto)"); params.texto = `%${filtro.texto.trim()}%`; }
  if (filtro.categoria) { condiciones.push("categoria_gestion = @categoria"); params.categoria = filtro.categoria; }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const total = (db.prepare(`${BASE_CLIENTES} SELECT COUNT(*) AS n FROM resumen ${where}`).get({ periodoId: periodo, ...params }) as { n: number }).n;
  const filas = db.prepare(`${BASE_CLIENTES}
    SELECT resumen.*,
      (SELECT GROUP_CONCAT(numero, '|') FROM telefonos t WHERE t.cliente_id = resumen.id AND t.valido = 1) AS tels,
      (SELECT GROUP_CONCAT(correo, '|') FROM correos m WHERE m.cliente_id = resumen.id AND m.valido = 1) AS mails
    FROM resumen ${where} ORDER BY monto_deuda DESC, id LIMIT @limite OFFSET @offset`)
    .all({ periodoId: periodo, ...params, limite: porPagina, offset: (pagina - 1) * porPagina }) as Array<Omit<Phoenix.ClienteDetalle, "telefonos" | "correos"> & { tels: string | null; mails: string | null }>;
  return { total, pagina, porPagina, filas: filas.map(({ tels, mails, ...resto }) => ({ ...resto, telefonos: tels ? tels.split("|") : [], correos: mails ? mails.split("|") : [] })) };
}

export function listarCategorias(db: Database.Database, periodoId?: string): string[] {
  const periodo = resolverPeriodo(db, periodoId);
  if (!periodo) return [];
  return (db.prepare(`${BASE_CLIENTES} SELECT DISTINCT categoria_gestion AS c FROM resumen WHERE categoria_gestion IS NOT NULL ORDER BY c`).all({ periodoId: periodo }) as Array<{ c: string }>).map((f) => f.c);
}

export function historialLlamadas(db: Database.Database, limite = 30): Phoenix.LlamadaRegistrada[] {
  return db.prepare(`SELECT g.id, g.fecha, g.cliente_id, c.rut, c.nombre AS nombre_cliente, g.texto_libre, g.resultado
    FROM gestiones g LEFT JOIN clientes c ON c.id = g.cliente_id WHERE g.categoria = 'llamada' ORDER BY g.id DESC LIMIT ?`).all(limite) as Phoenix.LlamadaRegistrada[];
}
