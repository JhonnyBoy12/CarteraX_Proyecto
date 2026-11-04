/**
 * @file servicioReportes.ts
 * @description Reportes mensuales guardados (RF-24, RF-25).
 *
 * Un reporte es una FOTOGRAFÍA congelada del mes: KPIs, distribuciones,
 * alertas y el detalle de cada cliente, guardada como JSON en
 * `reportes_mensuales`. Aunque después cambie la cartera, el reporte
 * conserva cómo cerró el mes y se puede volver a ver o descargar.
 *
 * - El ejecutivo puede guardar un reporte cuando quiera (ej. corte semanal).
 * - Al iniciar sesión se genera automáticamente el "Cierre de mes" de los
 *   meses ya terminados que tengan cartera y aún no tengan reporte.
 *
 * @since 0.3.0
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import { obtenerDashboard } from "./servicioDashboard";
import { leerCartera } from "./servicioCartera";
import { Contexto, idCartera, idPeriodo, nombrePeriodo } from "./servicioPeriodos";

interface FilaReporte {
  id: string;
  periodo_id: string;
  titulo: string;
  automatico: number;
  notas: string | null;
  generado_en: string;
  deuda_total: number;
  recuperado: number;
  clientes: number;
}

function aResumen(f: FilaReporte): Phoenix.ReporteResumen {
  return {
    id: f.id,
    periodoId: f.periodo_id,
    periodoNombre: nombrePeriodo(f.periodo_id),
    titulo: f.titulo,
    automatico: f.automatico === 1,
    notas: f.notas,
    generadoEn: f.generado_en,
    deudaTotal: f.deuda_total,
    recuperado: f.recuperado,
    clientes: f.clientes,
  };
}

/**
 * Genera y guarda el reporte del mes del contexto.
 * @param opciones.titulo Título visible (por defecto "Reporte <mes>").
 */
export function generarReporte(
  db: Database.Database,
  ctx: Contexto,
  opciones: { titulo?: string | null; notas?: string | null; automatico?: boolean } = {}
): Phoenix.ReporteResumen {
  if (!idCartera(db, ctx)) throw new Error("No hay cartera en este mes para generar un reporte.");

  const dashboard = obtenerDashboard(db, ctx);
  const clientesDetalle: Phoenix.ClienteReporte[] = leerCartera(db, ctx)
    .sort((a, b) => b.deuda - a.deuda)
    .map((f) => ({
      rut: f.rut,
      dv: f.dv,
      nombre: f.nombre,
      deuda: f.deuda,
      diasMora: f.diasMora,
      tramo: f.tramo,
      estado: f.estado,
      recuperado: f.montoRecuperado,
      prioridad: f.prioridad,
      ultimaGestion: f.ultimaGestion,
      ultimoComentario: f.ultimoComentario,
      fechaCompromiso: f.fechaCompromiso,
      montoCompromiso: f.montoCompromiso,
      telefonos: f.telefonos.filter((t) => t.valido).map((t) => t.numero).join(" / "),
    }));

  const titulo = (opciones.titulo ?? "").trim().slice(0, 120) || `Reporte ${nombrePeriodo(ctx.periodoId)}`;
  const notas = (opciones.notas ?? "").trim().slice(0, 2000) || null;
  const id = randomUUID();

  db.prepare(
    `INSERT INTO reportes_mensuales (id, usuario_id, periodo_id, titulo, automatico, notas, deuda_total, recuperado, clientes, datos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    ctx.usuarioId,
    ctx.periodoId,
    titulo,
    opciones.automatico ? 1 : 0,
    notas,
    dashboard.kpis.deudaTotal,
    dashboard.kpis.recuperado,
    dashboard.kpis.clientes,
    JSON.stringify({ dashboard, clientesDetalle })
  );

  return obtenerResumen(db, ctx.usuarioId, id);
}

function obtenerResumen(db: Database.Database, usuarioId: string, id: string): Phoenix.ReporteResumen {
  const f = db
    .prepare(
      `SELECT id, periodo_id, titulo, automatico, notas, generado_en, deuda_total, recuperado, clientes
         FROM reportes_mensuales WHERE id = ? AND usuario_id = ?`
    )
    .get(id, usuarioId) as FilaReporte | undefined;
  if (!f) throw new Error("Reporte no encontrado.");
  return aResumen(f);
}

/** Reportes del ejecutivo, del más reciente al más antiguo. */
export function listarReportes(db: Database.Database, usuarioId: string): Phoenix.ReporteResumen[] {
  return (
    db
      .prepare(
        `SELECT id, periodo_id, titulo, automatico, notas, generado_en, deuda_total, recuperado, clientes
           FROM reportes_mensuales WHERE usuario_id = ?
          ORDER BY periodo_id DESC, generado_en DESC, rowid DESC`
      )
      .all(usuarioId) as FilaReporte[]
  ).map(aResumen);
}

/** Reporte completo (con dashboard y clientes). */
export function obtenerReporte(db: Database.Database, usuarioId: string, id: string): Phoenix.ReporteDetalle {
  const f = db
    .prepare(
      `SELECT id, periodo_id, titulo, automatico, notas, generado_en, deuda_total, recuperado, clientes, datos
         FROM reportes_mensuales WHERE id = ? AND usuario_id = ?`
    )
    .get(id, usuarioId) as (FilaReporte & { datos: string }) | undefined;
  if (!f) throw new Error("Reporte no encontrado.");
  const datos = JSON.parse(f.datos) as { dashboard: Phoenix.Dashboard; clientesDetalle: Phoenix.ClienteReporte[] };
  return { ...aResumen(f), dashboard: datos.dashboard, clientesDetalle: datos.clientesDetalle ?? [] };
}

export function eliminarReporte(db: Database.Database, usuarioId: string, id: string): void {
  const r = db.prepare("DELETE FROM reportes_mensuales WHERE id = ? AND usuario_id = ?").run(id, usuarioId);
  if (r.changes === 0) throw new Error("Reporte no encontrado.");
}

/**
 * Cierre automático: guarda el reporte de cada mes ya terminado que tenga
 * cartera con clientes y todavía no tenga ningún reporte.
 * @returns Reportes generados.
 */
export function generarCierresPendientes(db: Database.Database, usuarioId: string): Phoenix.ReporteResumen[] {
  const actual = idPeriodo();
  const pendientes = db
    .prepare(
      `SELECT ca.periodo_id FROM carteras ca
        WHERE ca.usuario_id = ? AND ca.periodo_id < ?
          AND EXISTS (SELECT 1 FROM cartera_clientes cc WHERE cc.cartera_id = ca.id)
          AND NOT EXISTS (SELECT 1 FROM reportes_mensuales r WHERE r.usuario_id = ca.usuario_id AND r.periodo_id = ca.periodo_id)
        ORDER BY ca.periodo_id`
    )
    .all(usuarioId, actual) as Array<{ periodo_id: string }>;

  return pendientes.map((p) =>
    generarReporte(
      db,
      { usuarioId, periodoId: p.periodo_id },
      { titulo: `Cierre ${nombrePeriodo(p.periodo_id)}`, automatico: true, notas: "Generado automáticamente al terminar el mes." }
    )
  );
}
