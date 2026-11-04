/**
 * @file servicioRecordatorios.ts
 * @description Recordatorios de vuelta de gestión (alarmas por estado).
 *
 * Al registrar una gestión que deja al cliente en un estado con regla
 * (`dominio/estados.ts` → `recordatorio`), se agenda cuándo volver a
 * gestionarlo: «No contesta» → volver a llamar mañana, «Notificado» →
 * confirmar en 3 días, «Compromiso» → verificar el pago el día comprometido…
 * El ejecutivo puede cambiar la hora o no agendar nada.
 *
 * La interfaz consulta cada minuto los recordatorios vencidos y los avisa una
 * sola vez (notificación de escritorio + aviso en la app). Cualquier gestión
 * nueva sobre el cliente da por cumplidos sus recordatorios pendientes.
 *
 * Las horas se guardan en hora LOCAL 'AAAA-MM-DDTHH:MM' (la app es de un
 * solo equipo), así se comparan como texto.
 *
 * @since 0.3.1
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import { estadoPorCodigo } from "../dominio/estados";
import { esFechaHoraValida, fechaHoraLocal, fechaLocal, sumarDias } from "./fechas";
import { Contexto, idCartera } from "./servicioPeriodos";

const MAX_MOTIVO = 200;

/**
 * Hora sugerida para volver a gestionar según el estado, o `null` si el
 * estado no tiene regla (ej. Pagado, No contactar).
 * @param fechaCompromiso Fecha del compromiso, para estados que cuentan desde ella.
 */
export function recordatorioSugerido(
  estado: Phoenix.CodigoEstado,
  fechaCompromiso: string | null = null,
  ahora = new Date()
): Phoenix.NuevoRecordatorio | null {
  const regla = estadoPorCodigo(estado).recordatorio;
  if (!regla) return null;
  if (regla.horas) {
    return { fechaHora: fechaHoraLocal(new Date(ahora.getTime() + regla.horas * 3_600_000)), motivo: regla.motivo };
  }
  const base = regla.desde === "compromiso" && fechaCompromiso ? fechaCompromiso : fechaLocal(ahora);
  let fechaHora = `${sumarDias(base, regla.dias ?? 0)}T${regla.hora ?? "10:00"}`;
  // Nunca en el pasado: si la hora de hoy ya pasó, dentro de una hora.
  if (fechaHora <= fechaHoraLocal(ahora)) fechaHora = fechaHoraLocal(new Date(ahora.getTime() + 3_600_000));
  return { fechaHora, motivo: regla.motivo };
}

/**
 * Da por cumplidos los recordatorios pendientes de un cliente y, si
 * corresponde, agenda uno nuevo. Se llama dentro de la transacción de
 * `registrarGestion`.
 */
export function reprogramarRecordatorio(
  db: Database.Database,
  ctx: Contexto,
  carteraId: string,
  clienteId: string,
  nuevo: Phoenix.NuevoRecordatorio | null,
  estadoOrigen: Phoenix.CodigoEstado | null
): void {
  db.prepare(
    `UPDATE recordatorios SET estado = 'HECHO', resuelto_en = CURRENT_TIMESTAMP
      WHERE cartera_id = ? AND cliente_id = ? AND estado = 'PENDIENTE'`
  ).run(carteraId, clienteId);
  if (!nuevo) return;
  db.prepare(
    `INSERT INTO recordatorios (id, usuario_id, cartera_id, cliente_id, fecha_hora, motivo, estado_origen)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), ctx.usuarioId, carteraId, clienteId, nuevo.fechaHora, limpiarMotivo(nuevo.motivo), estadoOrigen);
}

/** Valida el recordatorio que viene de la interfaz (lanza si no sirve). */
export function validarNuevoRecordatorio(r: Phoenix.NuevoRecordatorio): Phoenix.NuevoRecordatorio {
  if (!esFechaHoraValida(r?.fechaHora)) throw new Error("La fecha y hora del recordatorio no son válidas.");
  return { fechaHora: r.fechaHora, motivo: limpiarMotivo(r.motivo) };
}

function limpiarMotivo(motivo: string | null | undefined): string {
  const t = String(motivo ?? "").replace(/\s+/g, " ").trim();
  return (t || "Volver a gestionar").slice(0, MAX_MOTIVO);
}

const SELECT = `
  SELECT r.id, r.cliente_id AS clienteId, c.nombre, c.rut, c.dv, r.fecha_hora AS fechaHora, r.motivo,
         r.estado_origen AS estadoOrigen, cc.estado_cobranza AS estadoActual,
         (SELECT COALESCE(SUM(o.deuda_total), 0) FROM operaciones o WHERE o.cliente_id = r.cliente_id AND o.periodo_id = ?) AS deuda
    FROM recordatorios r
    JOIN clientes c ON c.id = r.cliente_id
    JOIN cartera_clientes cc ON cc.cartera_id = r.cartera_id AND cc.cliente_id = r.cliente_id
   WHERE r.cartera_id = ? AND r.usuario_id = ? AND r.estado = 'PENDIENTE'`;

/** Recordatorios pendientes del mes, del más antiguo al más lejano. */
export function listarRecordatorios(db: Database.Database, ctx: Contexto): Phoenix.Recordatorio[] {
  const carteraId = idCartera(db, ctx);
  if (!carteraId) return [];
  return db.prepare(`${SELECT} ORDER BY r.fecha_hora, c.nombre`).all(ctx.periodoId, carteraId, ctx.usuarioId) as Phoenix.Recordatorio[];
}

/**
 * Recordatorios que vencieron y todavía no se avisaron. Los marca como
 * avisados para que cada uno suene una sola vez.
 */
export function recordatoriosPorAvisar(db: Database.Database, ctx: Contexto): Phoenix.Recordatorio[] {
  const carteraId = idCartera(db, ctx);
  if (!carteraId) return [];
  const vencidos = db
    .prepare(`${SELECT} AND r.avisado = 0 AND r.fecha_hora <= ? ORDER BY r.fecha_hora`)
    .all(ctx.periodoId, carteraId, ctx.usuarioId, fechaHoraLocal()) as Phoenix.Recordatorio[];
  const marcar = db.prepare("UPDATE recordatorios SET avisado = 1 WHERE id = ?");
  db.transaction(() => vencidos.forEach((r) => marcar.run(r.id)))();
  return vencidos;
}

function recordatorioPropio(db: Database.Database, ctx: Contexto, id: string): { id: string } {
  const carteraId = idCartera(db, ctx);
  const r = db
    .prepare("SELECT id FROM recordatorios WHERE id = ? AND cartera_id = ? AND usuario_id = ? AND estado = 'PENDIENTE'")
    .get(String(id ?? ""), carteraId, ctx.usuarioId) as { id: string } | undefined;
  if (!r) throw new Error("El recordatorio ya no está pendiente.");
  return r;
}

/** Cambia la hora de un recordatorio (vuelve a avisar a la nueva hora). */
export function posponerRecordatorio(db: Database.Database, ctx: Contexto, id: string, fechaHora: string): void {
  if (!esFechaHoraValida(fechaHora)) throw new Error("La nueva hora no es válida.");
  recordatorioPropio(db, ctx, id);
  db.prepare("UPDATE recordatorios SET fecha_hora = ?, avisado = 0 WHERE id = ?").run(fechaHora, id);
}

/** Cierra un recordatorio sin registrar gestión (hecho fuera de la app o descartado). */
export function resolverRecordatorio(db: Database.Database, ctx: Contexto, id: string, estado: "HECHO" | "DESCARTADO"): void {
  recordatorioPropio(db, ctx, id);
  db.prepare("UPDATE recordatorios SET estado = ?, resuelto_en = CURRENT_TIMESTAMP WHERE id = ?").run(
    estado === "DESCARTADO" ? "DESCARTADO" : "HECHO",
    id
  );
}

/** Agenda de seguimiento para el dashboard. */
export function agendaSeguimiento(db: Database.Database, ctx: Contexto): Phoenix.AgendaSeguimiento {
  const lista = listarRecordatorios(db, ctx);
  const ahora = fechaHoraLocal();
  const finHoy = `${fechaLocal()}T23:59`;
  const atrasados = lista.filter((r) => r.fechaHora < ahora);
  const hoy = lista.filter((r) => r.fechaHora >= ahora && r.fechaHora <= finHoy);
  return {
    atrasados: atrasados.length,
    hoy: hoy.length,
    proximos: lista.length - atrasados.length - hoy.length,
    lista: [...atrasados, ...hoy, ...lista.filter((r) => r.fechaHora > finHoy)].slice(0, 8),
  };
}
