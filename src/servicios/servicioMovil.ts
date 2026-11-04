/**
 * @file servicioMovil.ts
 * @description Une Phoenix Mobile con la cartera (RF-28, RF-29, RF-33):
 *  - Guarda la IP del teléfono en `configuracion`.
 *  - Ordena llamadas y registra cada intento en `gestiones` (tipo 'llamada')
 *    asociado al ejecutivo y a la cartera del mes.
 *  - v0.3.1: cada llamada se cierra con su motivo (contestó, no contesta,
 *    ocupado, rechazada, apagado, número inexistente, cortada) y sus
 *    segundos; las manuales también quedan en seguimiento, y cualquier
 *    llamada se puede corregir después.
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import { CLAVES, guardarConfig, leerConfig } from "../db/configuracion";
import {
  confirmarEstadoLlamadaMovil,
  llamarDesdeMovil,
  normalizarIp,
  normalizarTelefono,
  obtenerEstadoLlamadaMovil,
  pingMovil,
  PUERTO_MOVIL,
} from "../movil/clienteMovil";
import { Contexto, idCartera } from "./servicioPeriodos";

export function obtenerIpMovil(db: Database.Database): string | null {
  return leerConfig(db, CLAVES.MOVIL_IP);
}

export function guardarIpMovil(db: Database.Database, ip: string): string {
  const limpia = normalizarIp(ip);
  guardarConfig(db, CLAVES.MOVIL_IP, limpia || null);
  return limpia;
}

/** Prueba la conexión; si se entrega una IP nueva y responde, la guarda. */
export async function probarMovil(db: Database.Database, ip?: string): Promise<Phoenix.EstadoMovil> {
  const objetivo = ip ?? obtenerIpMovil(db) ?? "";
  const estado = await pingMovil(objetivo);
  if (estado.conectado && ip) guardarIpMovil(db, ip);
  return estado;
}

/**
 * Ordena a Phoenix Mobile llamar y lo registra en el historial.
 * Si falla, también se registra (resultado `error`) y se relanza.
 */
export async function llamar(
  db: Database.Database,
  ctx: Contexto,
  numero: string,
  clienteId: string | null = null
): Promise<Phoenix.ResultadoLlamada> {
  const ip = obtenerIpMovil(db);
  if (!ip) throw new Error("Primero conecta Phoenix Mobile en la sección «Teléfono».");

  const carteraId = idCartera(db, ctx);
  const cliente = clienteId
    ? (db.prepare("SELECT nombre, rut, dv FROM clientes WHERE id = ?").get(clienteId) as
        | { nombre: string; rut: string; dv: string | null }
        | undefined)
    : undefined;

  const registrar = (texto: string, resultado: string, telefono: string) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO gestiones (id, cliente_id, usuario_id, cartera_id, tipo, categoria, texto_libre, resultado, telefono)
       VALUES (?, ?, ?, ?, 'llamada', 'llamada', ?, ?, ?)`
    ).run(id, clienteId, ctx.usuarioId, clienteId ? carteraId : null, texto, resultado, telefono);
    return id;
  };

  try {
    const r = await llamarDesdeMovil(ip, numero, {
      nombre: cliente?.nombre ?? null,
      rut: cliente ? (cliente.dv ? `${cliente.rut}-${cliente.dv}` : cliente.rut) : null,
    });
    const gestionId = registrar(`Llamada a ${r.numero} vía Phoenix Mobile (${ip}:${PUERTO_MOVIL})`, "enviada", r.numero);
    return { numero: r.numero, accion: r.accion, gestionId };
  } catch (e) {
    registrar(`Llamada a ${numero} fallida: ${(e as Error).message}`, "error", normalizarTelefono(numero) || numero);
    throw e;
  }
}

/** Cómo terminó una llamada, en palabras del ejecutivo. */
export const MOTIVOS_LLAMADA: Record<Phoenix.MotivoLlamada, string> = {
  contestada: "Contestó",
  no_contesta: "No contesta",
  ocupado: "Ocupado / no estaba en línea",
  rechazada: "Rechazó la llamada",
  apagado: "Apagado o sin cobertura",
  inexistente: "Número no existe",
  cortada: "Se cortó",
};

export function esMotivoLlamada(m: unknown): m is Phoenix.MotivoLlamada {
  return typeof m === "string" && m in MOTIVOS_LLAMADA;
}

/**
 * Valor de `resultado` (lo usan el dashboard y el historial desde v0.3.0):
 * sólo «contestada» cuenta como contacto; una llamada cortada no se sabe.
 */
function resultadoDe(motivo: Phoenix.MotivoLlamada): string {
  return motivo === "contestada" ? "contestada" : motivo === "cortada" ? "cortada" : "no contesta";
}

/** Segundos enteros desde una marca `Date.now()`. */
export function segundosDesde(marca: number): number {
  return Math.max(0, Math.round((Date.now() - marca) / 1000));
}

/**
 * Cierra una llamada registrada: resultado, motivo y duración en segundos.
 * @param nota Texto que se agrega al detalle (ej. «duración aproximada»).
 */
export function cerrarLlamada(
  db: Database.Database,
  gestionId: string | null,
  motivo: Phoenix.MotivoLlamada,
  duracion: number | null,
  nota: string | null = null
): void {
  if (!gestionId) return;
  db.prepare(
    `UPDATE gestiones SET resultado = ?, motivo_llamada = ?, duracion = ?,
            texto_libre = CASE WHEN ? IS NULL THEN texto_libre ELSE COALESCE(texto_libre, '') || ' · ' || ? END
      WHERE id = ? AND tipo = 'llamada'`
  ).run(resultadoDe(motivo), motivo, duracion === null ? null : Math.max(0, Math.round(duracion)), nota, nota, gestionId);
  if (motivo === "inexistente") marcarNumeroInexistente(db, gestionId);
}

/** «Número no existe»: ese teléfono sale de la cola (se puede reactivar en la ficha). */
function marcarNumeroInexistente(db: Database.Database, gestionId: string): void {
  const g = db.prepare("SELECT cliente_id, telefono FROM gestiones WHERE id = ?").get(gestionId) as
    | { cliente_id: string | null; telefono: string | null }
    | undefined;
  if (!g?.cliente_id || !g.telefono) return;
  const digitos = (n: string) => n.replace(/\D/g, "").slice(-9);
  const tels = db.prepare("SELECT id, numero FROM telefonos WHERE cliente_id = ?").all(g.cliente_id) as Array<{ id: string; numero: string }>;
  const tel = tels.find((t) => digitos(t.numero) === digitos(g.telefono!));
  if (tel) {
    db.prepare("UPDATE telefonos SET valido = 0, estado_llamada = 'INVALIDO', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(tel.id);
  }
}

/**
 * Corrige cómo terminó una llamada ya registrada (o una que quedó «enviada»
 * porque se cortó la conexión): motivo y, si se indica, duración.
 */
export function corregirLlamada(
  db: Database.Database,
  ctx: Contexto,
  gestionId: string,
  motivo: Phoenix.MotivoLlamada,
  duracion?: number | null
): void {
  if (!esMotivoLlamada(motivo)) throw new Error("Resultado de llamada no válido.");
  if (duracion !== undefined && duracion !== null && (!Number.isFinite(duracion) || duracion < 0 || duracion > 6 * 3600)) {
    throw new Error("La duración no es válida.");
  }
  const carteraId = idCartera(db, ctx);
  const g = db
    .prepare(
      `SELECT id, duracion FROM gestiones WHERE id = ? AND tipo = 'llamada'
          AND (cartera_id = ? OR (cartera_id IS NULL AND (usuario_id = ? OR usuario_id IS NULL)))`
    )
    .get(String(gestionId ?? ""), carteraId, ctx.usuarioId) as { id: string; duracion: number | null } | undefined;
  if (!g) throw new Error("No se encontró esa llamada en tu cartera.");
  const segundos = duracion !== undefined ? duracion : motivo === "contestada" || motivo === "cortada" ? g.duracion : 0;
  cerrarLlamada(db, g.id, motivo, segundos ?? null, "resultado corregido por el ejecutivo");
}

// --------------------- Llamadas manuales (fuera de la cola) ---------------------

interface Seguimiento {
  gestionId: string;
  numero: string;
  nombre: string | null;
  inicio: number;
  automatico: boolean;
  terminada: boolean;
  motivo: Phoenix.MotivoLlamada | null;
  duracion: number | null;
}

let seguimiento: Seguimiento | null = null;

function seguimientoPublico(): Phoenix.SeguimientoLlamada | null {
  if (!seguimiento) return null;
  const { inicio, ...resto } = seguimiento;
  return { ...resto, transcurrido: segundosDesde(inicio) };
}

/**
 * Llamada desde la ficha o desde «Teléfono»: además de marcar, queda en
 * seguimiento para registrar cómo terminó y sus minutos.
 */
export async function llamarManual(
  db: Database.Database,
  ctx: Contexto,
  numero: string,
  clienteId: string | null = null
): Promise<Phoenix.ResultadoLlamada & { seguimiento: Phoenix.SeguimientoLlamada | null }> {
  const r = await llamar(db, ctx, numero, clienteId);
  const ip = obtenerIpMovil(db) ?? "";
  const ping = await pingMovil(ip);
  await confirmarEstadoLlamadaMovil(ip).catch(() => undefined);
  const nombre = clienteId
    ? ((db.prepare("SELECT nombre FROM clientes WHERE id = ?").get(clienteId) as { nombre: string } | undefined)?.nombre ?? null)
    : null;
  seguimiento = {
    gestionId: r.gestionId ?? "",
    numero: r.numero,
    nombre,
    inicio: Date.now(),
    automatico: Boolean(ping.seguimientoLlamadas),
    terminada: false,
    motivo: null,
    duracion: null,
  };
  return { ...r, seguimiento: seguimientoPublico() };
}

/** Consulta al teléfono si la llamada manual terminó y, si es así, la cierra. */
export async function seguirLlamadaManual(db: Database.Database): Promise<Phoenix.SeguimientoLlamada | null> {
  const s = seguimiento;
  if (!s || s.terminada || !s.automatico) return seguimientoPublico();
  const ip = obtenerIpMovil(db);
  if (!ip) return seguimientoPublico();
  try {
    const m = await obtenerEstadoLlamadaMovil(ip);
    if (m.completada) {
      await confirmarEstadoLlamadaMovil(ip).catch(() => undefined);
      if (m.contestada === null) {
        s.automatico = false; // el teléfono no sabe si contestaron: lo indica el ejecutivo
      } else {
        terminar(db, m.contestada ? "contestada" : "no_contesta", m.contestada ? m.duracion : 0, null);
      }
    }
  } catch {
    /* sin conexión: se reintenta en el próximo sondeo */
  }
  return seguimientoPublico();
}

function terminar(db: Database.Database, motivo: Phoenix.MotivoLlamada, duracion: number | null, nota: string | null): void {
  if (!seguimiento) return;
  cerrarLlamada(db, seguimiento.gestionId, motivo, duracion, nota);
  Object.assign(seguimiento, { terminada: true, motivo, duracion });
}

/**
 * El ejecutivo indica cómo terminó la llamada manual. Si contestó y no
 * indica la duración, se usa el tiempo desde que se marcó (aproximado).
 */
export function terminarLlamadaManual(
  db: Database.Database,
  motivo: Phoenix.MotivoLlamada,
  duracion: number | null = null
): Phoenix.SeguimientoLlamada | null {
  if (!seguimiento || seguimiento.terminada) throw new Error("No hay una llamada manual en curso.");
  if (!esMotivoLlamada(motivo)) throw new Error("Resultado de llamada no válido.");
  const hablada = motivo === "contestada" || motivo === "cortada";
  const estimada = hablada && (duracion === null || duracion === undefined);
  terminar(db, motivo, hablada ? (estimada ? segundosDesde(seguimiento.inicio) : duracion) : 0, estimada ? "duración aproximada (desde que se marcó)" : null);
  return seguimientoPublico();
}

/** Olvida la llamada manual (la tarjeta se cerró). */
export function descartarSeguimiento(): void {
  seguimiento = null;
}

/** Últimas llamadas del ejecutivo (cartera del mes + llamadas manuales). */
export function obtenerLlamadas(db: Database.Database, ctx: Contexto, limite = 40): Phoenix.LlamadaRegistrada[] {
  const carteraId = idCartera(db, ctx);
  return db
    .prepare(
      `SELECT g.id, g.fecha, g.cliente_id, c.rut, c.nombre AS nombre_cliente, g.telefono, g.texto_libre, g.resultado, g.duracion,
              g.motivo_llamada
         FROM gestiones g LEFT JOIN clientes c ON c.id = g.cliente_id
        WHERE g.tipo = 'llamada' AND (g.cartera_id = ? OR (g.cartera_id IS NULL AND (g.usuario_id = ? OR g.usuario_id IS NULL)))
        ORDER BY g.fecha DESC, g.rowid DESC
        LIMIT ?`
    )
    .all(carteraId, ctx.usuarioId, limite) as Phoenix.LlamadaRegistrada[];
}
