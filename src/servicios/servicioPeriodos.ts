/**
 * @file servicioPeriodos.ts
 * @description Meses de gestión (RF-15). Cada importación se asocia a un
 * período 'AAAA-MM' y a la cartera del ejecutivo para ese mes; los meses
 * anteriores se conservan sin borrar información.
 *
 * @since 0.3.0
 */
import Database from "better-sqlite3";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Contexto de trabajo de cada operación: quién y sobre qué mes. */
export interface Contexto {
  usuarioId: string;
  periodoId: string;
}

/** 'AAAA-MM' de una fecha (por defecto, hoy en hora local). */
export function idPeriodo(fecha = new Date()): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

/** Valida 'AAAA-MM'. */
export function esIdPeriodo(id: unknown): id is string {
  return typeof id === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(id);
}

/** 'AAAA-MM' → 'Octubre 2026'. */
export function nombrePeriodo(id: string): string {
  const [anio, mes] = id.split("-").map(Number);
  return `${MESES[mes - 1]} ${anio}`;
}

/** Primer y último día del mes. */
export function rangoPeriodo(id: string): { inicio: string; fin: string } {
  const [anio, mes] = id.split("-").map(Number);
  const ultimo = new Date(anio, mes, 0).getDate();
  return { inicio: `${id}-01`, fin: `${id}-${String(ultimo).padStart(2, "0")}` };
}

/** Crea el período si no existe. */
export function asegurarPeriodo(db: Database.Database, id: string): void {
  if (!esIdPeriodo(id)) throw new Error(`Período inválido: ${id}`);
  const { inicio, fin } = rangoPeriodo(id);
  db.prepare(`INSERT OR IGNORE INTO periodos (id, nombre, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?)`).run(
    id,
    nombrePeriodo(id),
    inicio,
    fin
  );
}

/** Id de la cartera del ejecutivo para un mes (o `null` si no existe). */
export function idCartera(db: Database.Database, ctx: Contexto): string | null {
  const fila = db.prepare("SELECT id FROM carteras WHERE usuario_id = ? AND periodo_id = ?").get(ctx.usuarioId, ctx.periodoId) as
    | { id: string }
    | undefined;
  return fila?.id ?? null;
}

/** Devuelve la cartera del mes, creándola (y el período) si hace falta. */
export function asegurarCartera(db: Database.Database, ctx: Contexto): string {
  asegurarPeriodo(db, ctx.periodoId);
  const existente = idCartera(db, ctx);
  if (existente) return existente;
  const id = `cartera-${ctx.usuarioId}-${ctx.periodoId}`;
  db.prepare("INSERT OR IGNORE INTO carteras (id, usuario_id, periodo_id, nombre) VALUES (?, ?, ?, ?)").run(
    id,
    ctx.usuarioId,
    ctx.periodoId,
    `Cartera ${nombrePeriodo(ctx.periodoId)}`
  );
  return id;
}

/**
 * Meses con cartera del ejecutivo (más el mes en curso aunque esté vacío),
 * del más reciente al más antiguo.
 */
export function listarPeriodos(db: Database.Database, usuarioId: string): Phoenix.Periodo[] {
  const actual = idPeriodo();
  const filas = db
    .prepare(
      `SELECT ca.periodo_id AS id,
              (SELECT COUNT(*) FROM cartera_clientes cc WHERE cc.cartera_id = ca.id) AS clientes,
              (SELECT COALESCE(SUM(o.deuda_total), 0)
                 FROM cartera_clientes cc JOIN operaciones o
                   ON o.cliente_id = cc.cliente_id AND o.periodo_id = ca.periodo_id
                WHERE cc.cartera_id = ca.id) AS deuda
         FROM carteras ca
        WHERE ca.usuario_id = ?`
    )
    .all(usuarioId) as Array<{ id: string; clientes: number; deuda: number }>;

  if (!filas.some((f) => f.id === actual)) filas.push({ id: actual, clientes: 0, deuda: 0 });

  return filas
    .sort((a, b) => b.id.localeCompare(a.id))
    .map((f) => {
      const { inicio, fin } = rangoPeriodo(f.id);
      return {
        id: f.id,
        nombre: nombrePeriodo(f.id),
        fechaInicio: inicio,
        fechaFin: fin,
        clientes: f.clientes,
        deuda: f.deuda,
        esActual: f.id === actual,
      };
    });
}

/**
 * Mes con el que abre la sesión: el actual si ya tiene clientes; si no, el
 * más reciente con clientes; si no hay ninguno, el actual.
 */
export function periodoPorDefecto(db: Database.Database, usuarioId: string): string {
  const periodos = listarPeriodos(db, usuarioId);
  const actual = periodos.find((p) => p.esActual);
  if (actual && actual.clientes > 0) return actual.id;
  return periodos.find((p) => p.clientes > 0)?.id ?? idPeriodo();
}

/** Busca un período en la lista del usuario (o lo arma si está vacío). */
export function obtenerPeriodo(db: Database.Database, usuarioId: string, id: string): Phoenix.Periodo {
  const encontrado = listarPeriodos(db, usuarioId).find((p) => p.id === id);
  if (encontrado) return encontrado;
  const { inicio, fin } = rangoPeriodo(id);
  return { id, nombre: nombrePeriodo(id), fechaInicio: inicio, fechaFin: fin, clientes: 0, deuda: 0, esActual: id === idPeriodo() };
}
