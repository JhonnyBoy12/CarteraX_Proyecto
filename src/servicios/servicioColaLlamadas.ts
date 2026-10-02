/**
 * @file servicioColaLlamadas.ts
 * @description Controla el modo automático de cola de llamadas.
 * Excluye clientes pagados/cerrados, prueba los teléfonos por prioridad y
 * mantiene la cola pausada mientras Android informa una llamada en curso.
 */
import Database from "better-sqlite3";
import { llamar } from "./servicioMovil";
import { obtenerIpMovil } from "./servicioMovil";
import { confirmarEstadoLlamadaMovil, obtenerEstadoLlamadaMovil } from "../movil/clienteMovil";

const ESTADOS_EXCLUIDOS = ["pago realizado", "pagado", "pago", "cerrado", "cancelado"];

type EstadoProceso = "DETENIDA" | "BUSCANDO" | "MARCANDO" | "EN_LLAMADA" | "ESPERANDO_FIN" | "FINALIZADA" | "ERROR";

let activa = false;
let estadoProceso: EstadoProceso = "DETENIDA";
let actual: Phoenix.ItemColaLlamadas | null = null;
let clientePreferido: string | null = null;
let mensaje: string | null = null;

function normalizarEstadoSql(campo: string): string {
  return `LOWER(TRIM(COALESCE(${campo}, '')))`;
}

/** Devuelve el siguiente número elegible; puede priorizar otro teléfono del mismo cliente. */
export function obtenerSiguiente(db: Database.Database, preferirCliente: string | null = null): Phoenix.ItemColaLlamadas | null {
  const placeholders = ESTADOS_EXCLUIDOS.map(() => "?").join(", ");
  const fila = db.prepare(
    `SELECT
       t.id AS telefonoId, t.numero, t.prioridad, t.estado_llamada AS estadoTelefono,
       c.id AS clienteId, c.rut, c.dv, c.nombre AS nombreCliente,
       cc.categoria_gestion AS estadoImportado,
       COALESCE(SUM(o.deuda_total), 0) AS deudaTotal
     FROM telefonos t
     JOIN clientes c ON c.id = t.cliente_id
     JOIN cartera_clientes cc ON cc.cliente_id = c.id
     LEFT JOIN operaciones o ON o.cliente_id = c.id
     WHERE t.valido = 1
       AND t.estado_llamada = 'PENDIENTE'
       AND cc.estado NOT IN ('CERRADO', 'CONTACTADO')
       AND ${normalizarEstadoSql("cc.categoria_gestion")} NOT IN (${placeholders})
     GROUP BY t.id, c.id, cc.id
     ORDER BY
       CASE WHEN ? IS NOT NULL AND c.id = ? THEN 0 ELSE 1 END,
       t.prioridad ASC,
       deudaTotal DESC,
       c.nombre ASC
     LIMIT 1`
  ).get(...ESTADOS_EXCLUIDOS, preferirCliente, preferirCliente) as Phoenix.ItemColaLlamadas | undefined;
  return fila ?? null;
}

export function obtenerEstadoCola(db: Database.Database): Phoenix.EstadoColaLlamadas {
  const placeholders = ESTADOS_EXCLUIDOS.map(() => "?").join(", ");
  const { pendientes } = db.prepare(
    `SELECT COUNT(*) AS pendientes
     FROM telefonos t
     JOIN clientes c ON c.id = t.cliente_id
     JOIN cartera_clientes cc ON cc.cliente_id = c.id
     WHERE t.valido = 1
       AND t.estado_llamada = 'PENDIENTE'
       AND cc.estado NOT IN ('CERRADO', 'CONTACTADO')
       AND ${normalizarEstadoSql("cc.categoria_gestion")} NOT IN (${placeholders})`
  ).get(...ESTADOS_EXCLUIDOS) as { pendientes: number };

  return {
    pendientes,
    siguiente: obtenerSiguiente(db, clientePreferido),
    activa,
    estadoProceso,
    actual,
    mensaje,
  };
}

async function enviarSiguiente(db: Database.Database): Promise<Phoenix.ResultadoColaLlamadas | null> {
  if (!activa) return null;
  estadoProceso = "BUSCANDO";
  const siguiente = obtenerSiguiente(db, clientePreferido);
  if (!siguiente) {
    activa = false;
    actual = null;
    estadoProceso = "FINALIZADA";
    mensaje = "No quedan teléfonos elegibles en la cola.";
    return null;
  }

  actual = siguiente;
  estadoProceso = "MARCANDO";
  const resultado = await llamar(db, siguiente.numero, siguiente.clienteId);
  db.prepare(
    `UPDATE telefonos
     SET estado_llamada = 'ENVIADA', intentos_llamada = intentos_llamada + 1,
         ultima_llamada = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(siguiente.telefonoId);
  estadoProceso = "ESPERANDO_FIN";
  mensaje = `Llamando a ${siguiente.nombreCliente}: ${siguiente.numero}`;
  return { item: siguiente, llamada: resultado };
}

/** Inicia el modo cola y envía automáticamente el primer número. */
export async function iniciarCola(db: Database.Database): Promise<Phoenix.EstadoColaLlamadas> {
  if (activa) return obtenerEstadoCola(db);
  activa = true;
  clientePreferido = null;
  mensaje = "Cola iniciada.";
  try {
    await enviarSiguiente(db);
  } catch (e) {
    activa = false;
    estadoProceso = "ERROR";
    mensaje = (e as Error).message;
    throw e;
  }
  return obtenerEstadoCola(db);
}

/** Detiene la cola sin alterar los estados ya registrados. */
export function detenerCola(db: Database.Database): Phoenix.EstadoColaLlamadas {
  activa = false;
  estadoProceso = "DETENIDA";
  actual = null;
  clientePreferido = null;
  mensaje = "Cola detenida por el ejecutivo.";
  return obtenerEstadoCola(db);
}

/**
 * Sincroniza la cola con el estado del Android.
 * Si la llamada termina sin duración, prueba el siguiente teléfono del mismo cliente.
 * Si tuvo duración, marca al cliente como contactado y continúa con otro cliente.
 */
export async function actualizarCola(db: Database.Database): Promise<Phoenix.EstadoColaLlamadas> {
  if (!activa || !actual) return obtenerEstadoCola(db);
  const ip = obtenerIpMovil(db);
  if (!ip) throw new Error("No hay un teléfono Android configurado.");

  const movil = await obtenerEstadoLlamadaMovil(ip);
  if (movil.estado === "OFFHOOK" || movil.estado === "RINGING") {
    estadoProceso = "EN_LLAMADA";
    mensaje = `Cola pausada mientras se procesa la llamada a ${actual.nombreCliente}.`;
    return obtenerEstadoCola(db);
  }

  if (!movil.completada) {
    estadoProceso = "ESPERANDO_FIN";
    return obtenerEstadoCola(db);
  }

  const finalizada = actual;
  await confirmarEstadoLlamadaMovil(ip);

  if (movil.contestada) {
    db.prepare(
      `UPDATE telefonos SET estado_llamada = 'CONTACTADO', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(finalizada.telefonoId);
    db.prepare(
      `UPDATE cartera_clientes SET estado = 'CONTACTADO', updated_at = CURRENT_TIMESTAMP WHERE cliente_id = ?`
    ).run(finalizada.clienteId);
    clientePreferido = null;
    mensaje = `Contacto finalizado con ${finalizada.nombreCliente}. Continuando con el siguiente cliente.`;
  } else {
    db.prepare(
      `UPDATE telefonos SET estado_llamada = 'NO_CONTESTA', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(finalizada.telefonoId);
    clientePreferido = finalizada.clienteId;
    mensaje = `${finalizada.numero} no tuvo conversación. Se probará el siguiente teléfono del mismo cliente.`;
  }

  actual = null;
  await enviarSiguiente(db);
  return obtenerEstadoCola(db);
}

/** Compatibilidad con el botón antiguo: envía un único siguiente número. */
export async function llamarSiguiente(db: Database.Database): Promise<Phoenix.ResultadoColaLlamadas> {
  const siguiente = obtenerSiguiente(db);
  if (!siguiente) throw new Error("No quedan teléfonos elegibles en la cola de llamadas.");
  const resultado = await llamar(db, siguiente.numero, siguiente.clienteId);
  db.prepare(
    `UPDATE telefonos SET estado_llamada = 'ENVIADA', intentos_llamada = intentos_llamada + 1,
     ultima_llamada = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(siguiente.telefonoId);
  return { item: siguiente, llamada: resultado };
}
