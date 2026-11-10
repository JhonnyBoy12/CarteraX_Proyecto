/**
 * @file servicioColaLlamadas.ts
 * @description Cola progresiva de llamadas automáticas (RF-30, RF-31, RF-32, RNF-22).
 *
 * Quién entra: SÓLO los clientes del mes en estado ejecutivo **EN_COLA**
 * que tengan al menos un teléfono válido pendiente. El ejecutivo decide
 * quién entra (desde Clientes: uno, varios o todos los filtrados).
 *
 * Orden: score de prioridad (RF-21), luego deuda. Dentro de un cliente,
 * los teléfonos se prueban por su prioridad (FONO1, FONO2, …).
 *
 * Ciclo (un contacto a la vez, nunca llamadas simultáneas):
 *
 *   MARCANDO → ESPERANDO_FIN / EN_LLAMADA ─┬─ contestó ──▶ ESPERANDO_RESULTADO
 *                                           │      (el ejecutivo registra estado +
 *                                           │       comentario y la cola sigue)
 *                                           └─ no contestó ─▶ siguiente teléfono del
 *                                                  mismo cliente; si no quedan, el
 *                                                  cliente pasa a NO_CONTESTA y la
 *                                                  cola sigue con el próximo.
 *
 * Si Phoenix Mobile no informa el estado de las llamadas (falta el permiso
 * READ_PHONE_STATE), el ejecutivo marca «Contestó» / «No contestó» a mano.
 *
 * v0.3.1 — minutos y motivos:
 *  - Toda llamada se cierra con duración: la del registro de Android o,
 *    si se marcó a mano, el tiempo desde que el teléfono mostró actividad.
 *  - Sin respuesta, el ejecutivo puede indicar el motivo (ocupado,
 *    rechazada, apagado, número inexistente) en el momento o corregirlo
 *    después con el «último intento». Un número inexistente sale de la cola.
 *  - Saltar o detener con una llamada en curso la deja «cortada» con su
 *    tiempo, en vez de quedar «enviada» sin cerrar.
 *  - Si el teléfono cuelga sin saber si contestaron, se pide el resultado
 *    en vez de suponer «no contesta».
 *
 * v0.4 — la cola ya no se queda esperando:
 *  - Si el teléfono deja de responder más de un minuto, se reinicia a mitad
 *    de llamada o colgó sin informar el término, se pide el resultado al
 *    ejecutivo con los minutos aproximados.
 *  - Si el teléfono no pudo marcar (sin señal, sin SIM, modo avión), la cola
 *    se pausa con el aviso y ese número no cuenta como intento.
 *  - Detección automática: una llamada que se corta sin contestar en pocos
 *    segundos queda como «apagado o sin cobertura»; si el mismo número se
 *    corta así 3 veces, se marca «número no existe» y sale de la cola (se
 *    puede reactivar en la ficha). El ejecutivo puede corregirlo siempre.
 *
 * @since 0.3.0 (reescrita)
 */
import Database from "better-sqlite3";

import { confirmarEstadoLlamadaMovil, ErrorMovil, EstadoLlamadaMovil, obtenerEstadoLlamadaMovil } from "../movil/clienteMovil";
import { leerCartera, registrarGestion } from "./servicioCartera";
import { cerrarLlamada, esMotivoLlamada, llamar, MOTIVOS_LLAMADA, obtenerConexionMovil, probarMovil, segundosDesde } from "./servicioMovil";
import { Contexto } from "./servicioPeriodos";

/** Segundos sin actividad del teléfono antes de dar la llamada por fallida. */
const ESPERA_SIN_ACTIVIDAD_S = 45;
/** Segundos sin respuesta del teléfono antes de pedir el resultado al ejecutivo. */
const SIN_SENAL_MAX_S = 60;
/** Segundos con el teléfono en reposo, sin informar el término, antes de preguntar. */
const REPOSO_SIN_CIERRE_S = 25;
/** Una llamada sin contestar que se corta antes de esto no alcanzó a sonar. */
export const CORTE_RAPIDO_S = 12;
/** Cortes rápidos del mismo número para darlo por inexistente. */
export const CORTES_PARA_DESCARTAR = 3;

interface Estado {
  activa: boolean;
  pausada: boolean;
  proceso: Phoenix.ProcesoCola;
  actual: Phoenix.ItemColaLlamadas | null;
  gestionActual: string | null;
  preferido: string | null;
  mensaje: string | null;
  duracionUltima: number | null;
  ctx: Contexto | null;
  omitidos: Set<string>;
  seguimiento: boolean;
  marcadoEn: number;
  vioActividad: boolean;
  /** Primera vez que el teléfono mostró la llamada activa (para estimar minutos). */
  actividadDesde: number;
  /** El teléfono colgó sin informar si contestaron. */
  terminoSinDatos: boolean;
  /** Segundos de llamada informados por el teléfono al colgar sin datos. */
  transcurridoTelefono: number | null;
  /** Motivos de los intentos del cliente actual (para el comentario final). */
  intentosCliente: Array<{ clienteId: string; numero: string; motivo: Phoenix.MotivoLlamada }>;
  ultimoIntento: Phoenix.IntentoLlamada | null;
  /** Id de la llamada que informó el teléfono al marcar (v0.4). */
  callIdEsperado: number | null;
  /** Desde cuándo el teléfono no responde (0: responde). */
  sinRespuestaDesde: number;
  /** Desde cuándo el teléfono está en reposo sin cerrar la llamada. */
  reposoDesde: number;
  ocupado: boolean;
  sesion: Phoenix.EstadoColaLlamadas["sesion"];
}

function estadoInicial(): Estado {
  return {
    activa: false,
    pausada: false,
    proceso: "DETENIDA",
    actual: null,
    gestionActual: null,
    preferido: null,
    mensaje: null,
    duracionUltima: null,
    ctx: null,
    omitidos: new Set(),
    seguimiento: false,
    marcadoEn: 0,
    vioActividad: false,
    actividadDesde: 0,
    terminoSinDatos: false,
    transcurridoTelefono: null,
    intentosCliente: [],
    ultimoIntento: null,
    callIdEsperado: null,
    sinRespuestaDesde: 0,
    reposoDesde: 0,
    ocupado: false,
    sesion: { llamadas: 0, contestadas: 0, noContesta: 0, gestionados: 0, inicio: null },
  };
}

let st: Estado = estadoInicial();

/** Clientes EN_COLA con su próximo teléfono pendiente, por prioridad. */
function candidatos(db: Database.Database, ctx: Contexto): { items: Phoenix.ItemColaLlamadas[]; sinTelefono: number } {
  const enCola = leerCartera(db, ctx).filter((f) => f.estado === "EN_COLA");
  const items: Phoenix.ItemColaLlamadas[] = [];
  let sinTelefono = 0;

  for (const f of enCola) {
    const pendientes = f.telefonos.filter((t) => t.valido && t.estadoLlamada === "PENDIENTE").sort((a, b) => a.prioridad - b.prioridad);
    if (!pendientes.length) {
      // El cliente en llamada ya no tiene teléfonos "pendientes": no se cuenta.
      if (f.id !== st.actual?.clienteId) sinTelefono++;
      continue;
    }
    if (st.omitidos.has(f.id)) continue;
    items.push({
      telefonoId: pendientes[0].id,
      numero: pendientes[0].numero,
      clienteId: f.id,
      rut: f.rut,
      dv: f.dv,
      nombre: f.nombre,
      deuda: f.deuda,
      diasMora: f.diasMora,
      prioridad: f.prioridad,
      telefonosPendientes: pendientes.length,
      ultimoComentario: f.ultimoComentario,
    });
  }
  items.sort((a, b) => b.prioridad - a.prioridad || b.deuda - a.deuda);
  return { items, sinTelefono };
}

/** Estado público de la cola para la interfaz. */
export function obtenerEstadoCola(db: Database.Database, ctx: Contexto): Phoenix.EstadoColaLlamadas {
  const { items, sinTelefono } = candidatos(db, st.ctx ?? ctx);
  const otros = items.filter((i) => i.clienteId !== st.actual?.clienteId);
  return {
    activa: st.activa,
    pausada: st.pausada,
    proceso: st.proceso,
    actual: st.actual,
    terminoSinDatos: st.terminoSinDatos,
    ultimoIntento: st.ultimoIntento,
    pendientes: otros.length,
    sinTelefono,
    proximos: otros.slice(0, 8),
    mensaje: st.mensaje,
    duracionUltima: st.duracionUltima,
    sesion: { ...st.sesion },
  };
}

/** Marca el siguiente número (o termina la cola si no quedan). */
async function enviarSiguiente(db: Database.Database): Promise<void> {
  const ctx = st.ctx;
  if (!ctx || !st.activa) return;
  if (st.pausada) {
    st.proceso = "PAUSADA";
    return;
  }

  const { items } = candidatos(db, ctx);
  const siguiente = (st.preferido && items.find((i) => i.clienteId === st.preferido)) || items[0];
  st.preferido = null;

  if (!siguiente) {
    st.activa = false;
    st.actual = null;
    st.proceso = "FINALIZADA";
    st.mensaje = "No quedan clientes en cola con teléfonos pendientes.";
    return;
  }

  if (st.intentosCliente[0]?.clienteId !== siguiente.clienteId) st.intentosCliente = [];
  st.actual = siguiente;
  st.gestionActual = null;
  st.terminoSinDatos = false;
  st.transcurridoTelefono = null;
  st.proceso = "MARCANDO";
  st.mensaje = `Marcando a ${siguiente.nombre} (${siguiente.numero})…`;
  try {
    const r = await llamar(db, ctx, siguiente.numero, siguiente.clienteId);
    st.gestionActual = r.gestionId;
    st.callIdEsperado = r.callId ?? null;
    st.sinRespuestaDesde = 0;
    st.reposoDesde = 0;
    db.prepare(
      `UPDATE telefonos SET estado_llamada = 'ENVIADA', intentos_llamada = intentos_llamada + 1,
              ultima_llamada = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(siguiente.telefonoId);
    st.sesion.llamadas++;
    st.proceso = "ESPERANDO_FIN";
    st.marcadoEn = Date.now();
    st.vioActividad = false;
    st.actividadDesde = 0;
    st.mensaje = `Llamando a ${siguiente.nombre} · ${siguiente.numero}`;
  } catch (e) {
    st.proceso = "ERROR";
    st.pausada = true;
    st.preferido = siguiente.clienteId;
    st.mensaje = `No se pudo llamar: ${(e as Error).message}`;
  }
}

/** Inicia la cola con los clientes EN_COLA del mes. */
export async function iniciarCola(db: Database.Database, ctx: Contexto): Promise<Phoenix.EstadoColaLlamadas> {
  if (st.activa) return obtenerEstadoCola(db, ctx);

  if (!obtenerConexionMovil(db)) throw new Error("Primero vincula Phoenix Mobile en la sección «Teléfono».");
  // Si el teléfono cambió de IP, probarMovil lo reencuentra por su identificador.
  const ping = await probarMovil(db);
  const conexion = obtenerConexionMovil(db)!;
  if (!ping.conectado) throw new Error(`Phoenix Mobile no responde: ${ping.detalle ?? "verifica la conexión Wi-Fi."}`);
  if (ping.requiereVinculo) throw new Error(`${ping.detalle ?? "Falta vincular el teléfono."} Hazlo en la sección «Teléfono».`);
  if (!ping.permisoLlamadas) throw new Error("Phoenix Mobile no tiene permiso para realizar llamadas. Concédelo en el teléfono.");
  if (!candidatos(db, ctx).items.length) {
    throw new Error("No hay clientes «En cola» con teléfonos pendientes. Envía clientes a la cola desde «Clientes».");
  }

  await confirmarEstadoLlamadaMovil(conexion).catch(() => undefined); // limpia un estado viejo del teléfono
  st = estadoInicial();
  st.ctx = ctx;
  st.activa = true;
  st.seguimiento = Boolean(ping.seguimientoLlamadas);
  st.sesion.inicio = new Date().toISOString();
  await enviarSiguiente(db);
  if (!st.seguimiento && st.activa) {
    st.mensaje = `${st.mensaje ?? ""} · El teléfono no informa el estado de las llamadas: marca el resultado manualmente.`;
  }
  return obtenerEstadoCola(db, ctx);
}

/**
 * Cierra la llamada en curso. Si contestó, espera el resultado del
 * ejecutivo; si no, prueba el siguiente teléfono o pasa al siguiente cliente.
 */
export async function finalizarLlamada(
  db: Database.Database,
  ctx: Contexto,
  motivo: Phoenix.MotivoLlamada,
  duracion: number | null = null,
  notaSinRespuesta: string | null = null
): Promise<Phoenix.EstadoColaLlamadas> {
  const item = st.actual;
  const ctxCola = st.ctx;
  if (!item || !ctxCola || !["MARCANDO", "ESPERANDO_FIN", "EN_LLAMADA"].includes(st.proceso)) {
    return obtenerEstadoCola(db, ctx);
  }
  if (!esMotivoLlamada(motivo)) throw new Error("Resultado de llamada no válido.");
  const contestada = motivo === "contestada";

  // Minutos: los que informa el teléfono; si no, el tiempo con la línea activa.
  let nota: string | null = null;
  let segundos = duracion;
  if (contestada && !segundos) {
    segundos = st.transcurridoTelefono ?? segundosDesde(st.actividadDesde || st.marcadoEn);
    nota = "duración aproximada";
  }
  if (!contestada) {
    segundos = 0;
    nota = notaSinRespuesta;
  }
  cerrarLlamada(db, st.gestionActual, motivo, segundos, nota);
  st.duracionUltima = segundos;
  st.terminoSinDatos = false;
  st.transcurridoTelefono = null;
  db.prepare(`UPDATE telefonos SET estado_llamada = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND estado_llamada <> 'INVALIDO'`).run(
    contestada ? "CONTACTADO" : "NO_CONTESTA",
    item.telefonoId
  );

  if (contestada) {
    st.sesion.contestadas++;
    st.ultimoIntento = null;
    st.proceso = "ESPERANDO_RESULTADO";
    st.mensaje = `Llamada con ${item.nombre} terminada. Registra el resultado para continuar.`;
    return obtenerEstadoCola(db, ctx);
  }

  st.sesion.noContesta++;
  st.intentosCliente.push({ clienteId: item.clienteId, numero: item.numero, motivo });
  st.ultimoIntento = st.gestionActual
    ? { gestionId: st.gestionActual, nombre: item.nombre, numero: item.numero, motivo, duracion: segundos }
    : null;
  const etiqueta = MOTIVOS_LLAMADA[motivo].toLowerCase() + (notaSinRespuesta ? " (detectado)" : "");
  const quedan = candidatos(db, ctxCola).items.some((i) => i.clienteId === item.clienteId);
  if (quedan) {
    st.preferido = item.clienteId;
    st.mensaje = `${item.numero}: ${etiqueta}. Se prueba otro teléfono de ${item.nombre}.`;
  } else {
    // Todos los números probados no existen → Inubicable; si no, No contesta.
    const intentos = st.intentosCliente.filter((i) => i.clienteId === item.clienteId);
    const inubicable = intentos.length > 0 && intentos.every((i) => i.motivo === "inexistente");
    const detalle = intentos.map((i) => `${i.numero} ${MOTIVOS_LLAMADA[i.motivo].toLowerCase()}`).join("; ");
    registrarGestion(
      db,
      ctxCola,
      {
        clienteIds: [item.clienteId],
        estado: inubicable ? "INUBICABLE" : "NO_CONTESTA",
        comentario: `Sin respuesta en los teléfonos disponibles (cola automática): ${detalle}.`,
      },
      { telefono: item.numero }
    );
    st.sesion.gestionados++;
    st.mensaje = inubicable
      ? `Los números de ${item.nombre} no existen: queda como «Inubicable».`
      : `${item.nombre} no contestó en ningún teléfono: queda como «No contesta».`;
  }
  st.actual = null;
  st.gestionActual = null;
  await enviarSiguiente(db);
  return obtenerEstadoCola(db, ctx);
}

/**
 * Corrige el motivo del último intento sin respuesta (ej. «No contesta» →
 * «Número no existe») mientras la cola sigue.
 */
export function corregirUltimoIntento(db: Database.Database, ctx: Contexto, motivo: Phoenix.MotivoLlamada): Phoenix.EstadoColaLlamadas {
  const u = st.ultimoIntento;
  if (!u) throw new Error("No hay un intento reciente para corregir.");
  if (!esMotivoLlamada(motivo) || motivo === "contestada") throw new Error("Elige un motivo sin respuesta.");
  cerrarLlamada(db, u.gestionId, motivo, 0, "motivo indicado por el ejecutivo");
  u.motivo = motivo;
  const intento = [...st.intentosCliente].reverse().find((i) => i.numero === u.numero);
  if (intento) intento.motivo = motivo;
  return obtenerEstadoCola(db, ctx);
}

/** `true` si la gestión es la llamada que la cola tiene abierta. */
export function esLlamadaEnCurso(gestionId: string): boolean {
  return st.activa && st.gestionActual === gestionId;
}

/** `true` mientras la cola está en marcha (no se mezclan llamadas manuales). */
export function colaActiva(): boolean {
  return st.activa;
}

/**
 * Cierra como «cortada» la llamada abierta (al saltar o detener la cola) y
 * deja ese teléfono pendiente: el cliente sigue «En cola» para la próxima vez.
 */
function cortarLlamadaAbierta(db: Database.Database | null): void {
  if (!db || !st.gestionActual || !st.actual || !["MARCANDO", "ESPERANDO_FIN", "EN_LLAMADA"].includes(st.proceso)) return;
  const segundos = st.vioActividad ? segundosDesde(st.actividadDesde || st.marcadoEn) : 0;
  cerrarLlamada(db, st.gestionActual, "cortada", segundos, "llamada interrumpida desde CarteraX");
  db.prepare(`UPDATE telefonos SET estado_llamada = 'PENDIENTE' WHERE id = ? AND estado_llamada = 'ENVIADA'`).run(st.actual.telefonoId);
}

/**
 * Motivo de una llamada sin respuesta según cuánto duró: si se cortó en
 * pocos segundos, no alcanzó a sonar (apagado, sin señal, sin chip o fuera
 * de servicio). A la tercera vez con el mismo número, se da por inexistente.
 */
function motivoSinRespuesta(
  db: Database.Database,
  numero: string,
  m: EstadoLlamadaMovil
): { motivo: Phoenix.MotivoLlamada; nota: string | null } {
  if (m.transcurrido === null || m.transcurrido <= 0 || m.transcurrido > CORTE_RAPIDO_S) return { motivo: "no_contesta", nota: null };
  const digitos = (n: string) => n.replace(/\D/g, "").slice(-9);
  const previos = (
    db
      .prepare(
        `SELECT telefono FROM gestiones
          WHERE tipo = 'llamada' AND motivo_llamada IN ('apagado', 'inexistente') AND texto_libre LIKE '%detección automática%'`
      )
      .all() as Array<{ telefono: string | null }>
  ).filter((g) => g.telefono && digitos(g.telefono) === digitos(numero)).length;
  if (previos + 1 >= CORTES_PARA_DESCARTAR) {
    return {
      motivo: "inexistente",
      nota: `detección automática: ${previos + 1} llamadas se cortaron sin sonar (esta a los ${m.transcurrido} s); el número sale de la cola y se puede reactivar en la ficha`,
    };
  }
  return { motivo: "apagado", nota: `detección automática: se cortó a los ${m.transcurrido} s sin contestar (apagado, sin señal o fuera de servicio)` };
}

/** La llamada quedó sin dato confiable: se pide el resultado al ejecutivo. */
function preguntarResultado(mensaje: string): void {
  st.terminoSinDatos = true;
  st.transcurridoTelefono = st.vioActividad ? segundosDesde(st.actividadDesde || st.marcadoEn) : null;
  st.sinRespuestaDesde = 0;
  st.reposoDesde = 0;
  st.mensaje = mensaje;
}

/** Sincroniza con el estado de la llamada que informa Android (sondeo). */
export async function actualizarCola(db: Database.Database, ctx: Contexto): Promise<Phoenix.EstadoColaLlamadas> {
  if (!st.activa || !st.actual || !["ESPERANDO_FIN", "EN_LLAMADA"].includes(st.proceso) || st.ocupado || st.terminoSinDatos) {
    return obtenerEstadoCola(db, ctx);
  }
  const conexion = obtenerConexionMovil(db);
  if (!conexion) throw new Error("No hay un teléfono Android vinculado.");
  const actual = st.actual;

  st.ocupado = true;
  try {
    const movil = await obtenerEstadoLlamadaMovil(conexion);
    st.sinRespuestaDesde = 0;

    // El teléfono se reinició o perdió la llamada: ya no sabe cómo terminó.
    if (st.callIdEsperado !== null && movil.callId !== st.callIdEsperado) {
      preguntarResultado(`El teléfono se reinició durante la llamada con ${actual.nombre}. Indica cómo terminó (los minutos son aproximados).`);
      return obtenerEstadoCola(db, ctx);
    }
    if (movil.estado === "OFFHOOK" || movil.estado === "RINGING") {
      if (!st.vioActividad) st.actividadDesde = Date.now();
      st.vioActividad = true;
      st.reposoDesde = 0;
      st.proceso = "EN_LLAMADA";
      st.mensaje = `En llamada con ${actual.nombre} · ${actual.numero}`;
      return obtenerEstadoCola(db, ctx);
    }
    if (movil.completada) {
      await confirmarEstadoLlamadaMovil(conexion).catch(() => undefined);
      // No se pudo marcar: es un problema del teléfono, no del cliente.
      if (movil.falloMarcado) {
        cerrarLlamada(db, st.gestionActual, "cortada", 0, "el teléfono no pudo marcar (sin señal, sin SIM o modo avión)");
        db.prepare(`UPDATE telefonos SET estado_llamada = 'PENDIENTE' WHERE id = ? AND estado_llamada = 'ENVIADA'`).run(actual.telefonoId);
        st.gestionActual = null;
        st.proceso = "ERROR";
        st.pausada = true;
        st.preferido = actual.clienteId;
        st.mensaje = `El teléfono no pudo marcar a ${actual.numero}. Revisa que tenga señal y SIM (y que no esté en modo avión) y reanuda la cola.`;
        return obtenerEstadoCola(db, ctx);
      }
      // Sin registro de llamadas el teléfono no sabe si contestaron: se
      // pregunta al ejecutivo en vez de dar la llamada por no contestada.
      if (movil.contestada === null || !st.seguimiento) {
        st.terminoSinDatos = true;
        st.transcurridoTelefono = movil.transcurrido;
        st.mensaje = `La llamada con ${actual.nombre} terminó, pero el teléfono no informó si contestaron. Indica cómo terminó.`;
        return obtenerEstadoCola(db, ctx);
      }
      if (movil.contestada) return await finalizarLlamada(db, ctx, "contestada", movil.duracion);
      const { motivo, nota } = motivoSinRespuesta(db, actual.numero, movil);
      return await finalizarLlamada(db, ctx, motivo, 0, nota);
    }
    // Colgó (reposo) pero nunca informó el término: no se queda esperando.
    if (st.vioActividad) {
      if (!st.reposoDesde) st.reposoDesde = Date.now();
      if (segundosDesde(st.reposoDesde) >= REPOSO_SIN_CIERRE_S) {
        preguntarResultado(`El teléfono colgó la llamada con ${actual.nombre} sin informar cómo terminó. Indícalo para seguir.`);
      }
      return obtenerEstadoCola(db, ctx);
    }
    // El teléfono nunca mostró actividad: la llamada no se inició.
    if (st.seguimiento && Date.now() - st.marcadoEn > ESPERA_SIN_ACTIVIDAD_S * 1000) {
      return await finalizarLlamada(db, ctx, "no_contesta", 0);
    }
    return obtenerEstadoCola(db, ctx);
  } catch (e) {
    if (e instanceof ErrorMovil && e.codigo === "NO_VINCULADO") {
      preguntarResultado(`${e.message} Indica cómo terminó la llamada con ${actual.nombre} y vuelve a vincular el teléfono en «Teléfono».`);
      st.pausada = true;
      return obtenerEstadoCola(db, ctx);
    }
    if (!st.sinRespuestaDesde) st.sinRespuestaDesde = Date.now();
    const s = segundosDesde(st.sinRespuestaDesde);
    if (s >= SIN_SENAL_MAX_S) {
      preguntarResultado(
        `Se perdió la conexión con el teléfono por más de un minuto durante la llamada con ${actual.nombre}. Indica cómo terminó (los minutos son aproximados).`
      );
    } else {
      st.mensaje = `Sin señal del teléfono hace ${s} s: ${(e as Error).message}`;
    }
    return obtenerEstadoCola(db, ctx);
  } finally {
    st.ocupado = false;
  }
}

/** Guarda el resultado de la llamada contestada y continúa (RF-32). */
export async function registrarResultado(
  db: Database.Database,
  ctx: Contexto,
  resultado: Phoenix.ResultadoCola
): Promise<Phoenix.EstadoColaLlamadas> {
  if (st.proceso !== "ESPERANDO_RESULTADO" || !st.actual || !st.ctx) {
    throw new Error("No hay una llamada esperando resultado.");
  }
  if (resultado.estado === "EN_COLA") throw new Error("Elige un resultado distinto de «En cola».");
  const duracion = resultado.duracion;
  if (duracion !== undefined && duracion !== null && (!Number.isFinite(duracion) || duracion < 0 || duracion > 6 * 3600)) {
    throw new Error("La duración de la llamada no es válida.");
  }

  registrarGestion(
    db,
    st.ctx,
    {
      clienteIds: [st.actual.clienteId],
      estado: resultado.estado,
      comentario: resultado.comentario,
      monto: resultado.monto,
      fechaCompromiso: resultado.fechaCompromiso,
      proximaGestion: resultado.proximaGestion,
      recordatorio: resultado.recordatorio,
    },
    { telefono: st.actual.numero, resultadoLlamada: "contestada" }
  );
  // El ejecutivo ajustó los minutos de la llamada.
  if (duracion !== undefined && duracion !== null && st.gestionActual) {
    db.prepare("UPDATE gestiones SET duracion = ? WHERE id = ? AND tipo = 'llamada'").run(Math.round(duracion), st.gestionActual);
  }
  st.sesion.gestionados++;
  st.mensaje = `Resultado de ${st.actual.nombre} guardado.`;
  st.actual = null;
  st.gestionActual = null;
  await enviarSiguiente(db);
  return obtenerEstadoCola(db, ctx);
}

/** Salta el cliente actual (sigue «En cola», pero no se llama en esta pasada). */
export async function saltarCliente(db: Database.Database, ctx: Contexto): Promise<Phoenix.EstadoColaLlamadas> {
  if (!st.actual) return obtenerEstadoCola(db, ctx);
  st.omitidos.add(st.actual.clienteId);
  if (st.proceso === "MARCANDO" || st.proceso === "ESPERANDO_FIN" || st.proceso === "EN_LLAMADA") {
    cortarLlamadaAbierta(db);
    db.prepare(`UPDATE telefonos SET estado_llamada = 'PENDIENTE' WHERE id = ?`).run(st.actual.telefonoId);
  }
  st.terminoSinDatos = false;
  st.mensaje = `Se saltó a ${st.actual.nombre}.`;
  st.actual = null;
  st.gestionActual = null;
  st.preferido = null;
  if (st.proceso === "ERROR") st.pausada = false;
  await enviarSiguiente(db);
  return obtenerEstadoCola(db, ctx);
}

export function pausarCola(db: Database.Database, ctx: Contexto): Phoenix.EstadoColaLlamadas {
  if (!st.activa) return obtenerEstadoCola(db, ctx);
  st.pausada = true;
  if (!st.actual) st.proceso = "PAUSADA";
  st.mensaje = st.actual ? "La cola se pausará al terminar la llamada actual." : "Cola en pausa.";
  return obtenerEstadoCola(db, ctx);
}

export async function reanudarCola(db: Database.Database, ctx: Contexto): Promise<Phoenix.EstadoColaLlamadas> {
  if (!st.activa) return obtenerEstadoCola(db, ctx);
  st.pausada = false;
  if (st.proceso === "PAUSADA" || st.proceso === "ERROR") {
    if (st.proceso === "ERROR" && st.actual) st.preferido = st.actual.clienteId;
    st.actual = null;
    await enviarSiguiente(db);
  } else {
    st.mensaje = "Cola reanudada.";
  }
  return obtenerEstadoCola(db, ctx);
}

/** Detiene la cola sin alterar los estados ya registrados. */
export function detenerCola(db: Database.Database | null, ctx: Contexto | null): Phoenix.EstadoColaLlamadas | null {
  cortarLlamadaAbierta(db);
  const sesion = st.sesion;
  st = estadoInicial();
  st.sesion = sesion;
  st.mensaje = "Cola detenida.";
  return db && ctx ? obtenerEstadoCola(db, ctx) : null;
}
