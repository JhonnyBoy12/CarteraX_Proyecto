/**
 * @file servicioCartera.ts
 * @description Gestión de cartera del ejecutivo (RF-16 a RF-21):
 *
 *  - Lectura de la cartera de UN mes y UN ejecutivo, con indicadores
 *    derivados (días sin gestión, compromiso vencido, score de prioridad).
 *  - Búsqueda y filtros (texto, estados, tramo, comuna, rangos de deuda y
 *    mora, prioridad, filtros rápidos) con orden y paginación.
 *  - Ficha del cliente con operaciones e historial.
 *  - Registro de gestiones: cambio de estado ejecutivo + comentario,
 *    compromiso, abono/pago y próxima gestión, para uno o varios clientes.
 *
 * La cartera de un ejecutivo ronda los 200–250 clientes (RNF-10), por lo que
 * se lee completa en una consulta y el filtrado/orden se hace en memoria:
 * así el score de prioridad (que depende de toda la cartera) es exacto y el
 * orden por prioridad no requiere SQL complejo.
 *
 * @since 0.3.0
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

import { ESTADOS, esCerrado, esEstadoValido, estadoPorCodigo } from "../dominio/estados";
import { calcularPrioridad, nivelPrioridad, percentiles } from "../dominio/prioridad";
import { Contexto, idCartera } from "./servicioPeriodos";
import { diasDesde, esFechaValida, fechaLocal, sumarDias } from "./fechas";
import { recordatorioSugerido, reprogramarRecordatorio, validarNuevoRecordatorio } from "./servicioRecordatorios";

/** Largo máximo de un comentario de gestión. */
export const MAX_COMENTARIO = 2000;

interface FilaSql {
  id: string;
  rut: string;
  dv: string | null;
  nombre: string;
  estado: string;
  categoriaImportada: string | null;
  fechaCompromiso: string | null;
  montoCompromiso: number | null;
  proximaGestion: string | null;
  ultimaGestion: string | null;
  montoRecuperado: number;
  deuda: number;
  diasMora: number | null;
  tramo: string | null;
  pctRecuperacion: number | null;
  comuna: string | null;
  patentes: string | null;
  totalGestiones: number;
  ultimoComentario: string | null;
}

/** Lanza si el ejecutivo no tiene cartera en el mes del contexto. */
function carteraObligatoria(db: Database.Database, ctx: Contexto): string {
  const id = idCartera(db, ctx);
  if (!id) throw new Error("No hay cartera cargada para este mes. Importa un archivo primero.");
  return id;
}

/**
 * Lee TODA la cartera del mes con sus datos derivados y score.
 * Es la base del listado, el dashboard, la cola y los reportes.
 */
export function leerCartera(db: Database.Database, ctx: Contexto): Phoenix.ClienteFila[] {
  const carteraId = idCartera(db, ctx);
  if (!carteraId) return [];

  const filas = db
    .prepare(
      `SELECT c.id, c.rut, c.dv, c.nombre,
              cc.estado_cobranza AS estado, cc.categoria_gestion AS categoriaImportada,
              cc.fecha_compromiso AS fechaCompromiso, cc.monto_compromiso AS montoCompromiso,
              cc.proxima_gestion AS proximaGestion, cc.ultima_gestion AS ultimaGestion,
              cc.monto_recuperado AS montoRecuperado,
              COALESCE(op.deuda, 0) AS deuda, op.diasMora, op.pct AS pctRecuperacion,
              (SELECT o2.tramo_mora FROM operaciones o2
                WHERE o2.cliente_id = c.id AND o2.periodo_id = @periodo AND o2.tramo_mora IS NOT NULL
                ORDER BY COALESCE(o2.dias_mora, 0) DESC LIMIT 1) AS tramo,
              (SELECT d.comuna FROM direcciones d WHERE d.cliente_id = c.id AND d.comuna IS NOT NULL LIMIT 1) AS comuna,
              (SELECT GROUP_CONCAT(v.patente, '|') FROM vehiculos v WHERE v.cliente_id = c.id AND v.patente IS NOT NULL) AS patentes,
              (SELECT COUNT(*) FROM gestiones g WHERE g.cliente_id = c.id AND g.cartera_id = cc.cartera_id) AS totalGestiones,
              (SELECT g.texto_libre FROM gestiones g
                WHERE g.cliente_id = c.id AND g.cartera_id = cc.cartera_id
                  AND g.tipo IN ('comentario', 'cambio_estado') AND TRIM(COALESCE(g.texto_libre, '')) <> ''
                ORDER BY g.fecha DESC, g.rowid DESC LIMIT 1) AS ultimoComentario
         FROM cartera_clientes cc
         JOIN clientes c ON c.id = cc.cliente_id
         LEFT JOIN (
              SELECT cliente_id, SUM(deuda_total) AS deuda, MAX(dias_mora) AS diasMora, AVG(pct_recuperacion) AS pct
                FROM operaciones WHERE periodo_id = @periodo GROUP BY cliente_id
         ) op ON op.cliente_id = c.id
        WHERE cc.cartera_id = @cartera`
    )
    .all({ cartera: carteraId, periodo: ctx.periodoId }) as FilaSql[];

  // Teléfonos y correos en una consulta cada uno (no una por cliente).
  const telefonos = new Map<string, Phoenix.TelefonoCliente[]>();
  for (const t of db
    .prepare(
      `SELECT t.cliente_id, t.id, t.numero, t.prioridad, t.valido, t.estado_llamada, t.intentos_llamada, t.ultima_llamada
         FROM telefonos t JOIN cartera_clientes cc ON cc.cliente_id = t.cliente_id
        WHERE cc.cartera_id = ? ORDER BY t.prioridad, t.numero`
    )
    .all(carteraId) as Array<{
    cliente_id: string;
    id: string;
    numero: string;
    prioridad: number;
    valido: number;
    estado_llamada: string;
    intentos_llamada: number;
    ultima_llamada: string | null;
  }>) {
    const lista = telefonos.get(t.cliente_id) ?? [];
    lista.push({
      id: t.id,
      numero: t.numero,
      prioridad: t.prioridad,
      valido: t.valido === 1,
      estadoLlamada: t.estado_llamada,
      intentos: t.intentos_llamada,
      ultimaLlamada: t.ultima_llamada,
    });
    telefonos.set(t.cliente_id, lista);
  }

  const correos = new Map<string, string[]>();
  for (const m of db
    .prepare(
      `SELECT m.cliente_id, m.correo FROM correos m JOIN cartera_clientes cc ON cc.cliente_id = m.cliente_id
        WHERE cc.cartera_id = ? AND m.valido = 1 ORDER BY m.correo`
    )
    .all(carteraId) as Array<{ cliente_id: string; correo: string }>) {
    const lista = correos.get(m.cliente_id) ?? [];
    lista.push(m.correo);
    correos.set(m.cliente_id, lista);
  }

  const hoy = fechaLocal();
  const percentil = percentiles(filas.map((f) => f.deuda));

  return filas.map((f) => {
    const estado = (esEstadoValido(f.estado) ? f.estado : "PENDIENTE") as Phoenix.CodigoEstado;
    const diasSinGestion = diasDesde(f.ultimaGestion);
    const compromisoVencido = estado === "COMPROMISO" && !!f.fechaCompromiso && f.fechaCompromiso < hoy;
    const prioridad = calcularPrioridad({
      percentilDeuda: percentil.get(f.deuda) ?? 0,
      diasMora: f.diasMora,
      estado,
      diasSinGestion,
      compromisoVencido,
    });
    return {
      id: f.id,
      rut: f.rut,
      dv: f.dv,
      nombre: f.nombre || "(sin nombre)",
      deuda: f.deuda,
      diasMora: f.diasMora,
      tramo: f.tramo,
      pctRecuperacion: f.pctRecuperacion === null ? null : Math.round(f.pctRecuperacion * 10) / 10,
      comuna: f.comuna,
      patentes: f.patentes ? f.patentes.split("|") : [],
      estado,
      categoriaImportada: f.categoriaImportada,
      telefonos: telefonos.get(f.id) ?? [],
      correos: correos.get(f.id) ?? [],
      ultimaGestion: f.ultimaGestion,
      diasSinGestion,
      ultimoComentario: f.ultimoComentario,
      proximaGestion: f.proximaGestion,
      fechaCompromiso: f.fechaCompromiso,
      montoCompromiso: f.montoCompromiso,
      compromisoVencido,
      montoRecuperado: f.montoRecuperado ?? 0,
      totalGestiones: f.totalGestiones,
      prioridad,
      nivelPrioridad: nivelPrioridad(prioridad),
    };
  });
}

/** Normaliza texto para búsquedas: minúsculas, sin tildes ni puntos/guiones. */
function normalizarBusqueda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** `true` si la fila calza con el texto (RUT, nombre, patente, teléfono, correo). */
function coincideTexto(f: Phoenix.ClienteFila, texto: string): boolean {
  const q = normalizarBusqueda(texto);
  if (!q) return true;
  const qCompacto = q.replace(/[\s.\-]/g, "");
  const rutCompleto = `${f.rut}${f.dv ?? ""}`.toLowerCase();
  if (qCompacto && (rutCompleto.includes(qCompacto) || f.rut.includes(qCompacto))) return true;
  if (normalizarBusqueda(f.nombre).includes(q)) return true;
  if (f.patentes.some((p) => p.toLowerCase().includes(qCompacto))) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos.length >= 4 && f.telefonos.some((t) => t.numero.replace(/\D/g, "").includes(digitos))) return true;
  if (f.correos.some((c) => c.includes(q))) return true;
  return false;
}

/** Aplica el filtro rápido (chips de la barra superior de Clientes). */
function coincideRapido(f: Phoenix.ClienteFila, rapido: Phoenix.FiltroRapido, diasAlerta: number): boolean {
  const hoy = fechaLocal();
  switch (rapido) {
    case "compromisos_vencidos":
      return f.compromisoVencido;
    case "compromisos_semana":
      return f.estado === "COMPROMISO" && !!f.fechaCompromiso && f.fechaCompromiso >= hoy && f.fechaCompromiso <= sumarDias(hoy, 7);
    case "sin_gestion":
      return !esCerrado(f.estado) && (f.diasSinGestion === null || f.diasSinGestion >= diasAlerta);
    case "gestionados_hoy":
      return f.diasSinGestion === 0;
    case "proxima_gestion_hoy":
      return !!f.proximaGestion && f.proximaGestion <= hoy && !esCerrado(f.estado);
    default:
      return true;
  }
}

/** Comparadores por criterio de orden. Empates: mayor deuda primero. */
const ORDENES: Record<Phoenix.OrdenClientes, (a: Phoenix.ClienteFila, b: Phoenix.ClienteFila) => number> = {
  prioridad: (a, b) => b.prioridad - a.prioridad || b.deuda - a.deuda,
  deuda_desc: (a, b) => b.deuda - a.deuda,
  deuda_asc: (a, b) => a.deuda - b.deuda,
  mora_desc: (a, b) => (b.diasMora ?? -1) - (a.diasMora ?? -1) || b.deuda - a.deuda,
  mora_asc: (a, b) => (a.diasMora ?? Number.MAX_SAFE_INTEGER) - (b.diasMora ?? Number.MAX_SAFE_INTEGER) || b.deuda - a.deuda,
  nombre: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
  ultima_gestion: (a, b) => (b.ultimaGestion ?? "").localeCompare(a.ultimaGestion ?? "") || b.deuda - a.deuda,
  compromiso: (a, b) => (a.fechaCompromiso ?? "9999").localeCompare(b.fechaCompromiso ?? "9999") || b.deuda - a.deuda,
};

/** Número finito o `null`. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Búsqueda, filtros, orden y paginación de la cartera (RF-17).
 * @param diasAlerta Días sin gestión para el filtro rápido "sin gestión".
 */
export function listarClientes(
  db: Database.Database,
  ctx: Contexto,
  filtro: Phoenix.FiltroClientes = {},
  diasAlerta = 7
): Phoenix.PaginaClientes {
  const porPagina = Math.min(Math.max(Math.trunc(num(filtro.porPagina) ?? 50), 1), 500);
  const deudaMin = num(filtro.deudaMin);
  const deudaMax = num(filtro.deudaMax);
  const moraMin = num(filtro.moraMin);
  const moraMax = num(filtro.moraMax);
  const estados = (filtro.estados ?? []).filter(esEstadoValido);

  // Todos los filtros MENOS el de estado: sirve para contar los chips.
  const base = leerCartera(db, ctx).filter(
    (f) =>
      coincideTexto(f, filtro.texto ?? "") &&
      (!filtro.tramo || (f.tramo ?? "(sin tramo)") === filtro.tramo) &&
      (!filtro.comuna || (f.comuna ?? "") === filtro.comuna) &&
      (deudaMin === null || f.deuda >= deudaMin) &&
      (deudaMax === null || f.deuda <= deudaMax) &&
      (moraMin === null || (f.diasMora ?? 0) >= moraMin) &&
      (moraMax === null || (f.diasMora ?? 0) <= moraMax) &&
      (!filtro.conTelefono || (filtro.conTelefono === "si") === f.telefonos.some((t) => t.valido)) &&
      (!filtro.prioridad || f.nivelPrioridad === filtro.prioridad) &&
      coincideRapido(f, filtro.rapido ?? "", diasAlerta)
  );

  const conteoEstados: Partial<Record<Phoenix.CodigoEstado, number>> = {};
  for (const f of base) conteoEstados[f.estado] = (conteoEstados[f.estado] ?? 0) + 1;

  const filtradas = estados.length ? base.filter((f) => estados.includes(f.estado)) : base;
  filtradas.sort(ORDENES[filtro.orden ?? "prioridad"] ?? ORDENES.prioridad);

  const total = filtradas.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(Math.max(Math.trunc(num(filtro.pagina) ?? 1), 1), paginas);

  return {
    total,
    pagina,
    porPagina,
    filas: filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    sumaDeuda: filtradas.reduce((s, f) => s + f.deuda, 0),
    conteoEstados,
    idsFiltrados: filtradas.map((f) => f.id),
  };
}

/** Valores disponibles para los selectores de filtro. */
export function opcionesFiltro(db: Database.Database, ctx: Contexto): Phoenix.OpcionesFiltro {
  const filas = leerCartera(db, ctx);
  const ordenTramo = (t: string) => {
    const m = t.match(/\d+/);
    return t === "(sin tramo)" ? Number.MAX_SAFE_INTEGER : m ? Number(m[0]) : Number.MAX_SAFE_INTEGER - 1;
  };
  const tramos = [...new Set(filas.map((f) => f.tramo ?? "(sin tramo)"))].sort((a, b) => ordenTramo(a) - ordenTramo(b));
  const comunas = [...new Set(filas.map((f) => f.comuna).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "es"));
  return { tramos, comunas, deudaMaxima: filas.reduce((m, f) => Math.max(m, f.deuda), 0) };
}

/** Ficha completa de un cliente de la cartera del mes. */
export function detalleCliente(db: Database.Database, ctx: Contexto, clienteId: string): Phoenix.DetalleCliente {
  const carteraId = carteraObligatoria(db, ctx);
  const fila = leerCartera(db, ctx).find((f) => f.id === clienteId);
  if (!fila) throw new Error("El cliente no pertenece a tu cartera de este mes.");

  const textoImportado = db
    .prepare("SELECT texto_gestion FROM cartera_clientes WHERE cartera_id = ? AND cliente_id = ?")
    .get(carteraId, clienteId) as { texto_gestion: string | null } | undefined;

  const operaciones = (
    db
      .prepare(
        `SELECT numero_operacion, deuda_total, monto_cuota, cuotas_pactadas, cuotas_pagadas, cuotas_morosas,
                dias_mora, tramo_mora, fecha_primer_vencimiento, fecha_ultimo_pago
           FROM operaciones WHERE cliente_id = ? AND periodo_id = ? ORDER BY deuda_total DESC`
      )
      .all(clienteId, ctx.periodoId) as Array<Record<string, unknown>>
  ).map((o) => ({
    numero: String(o.numero_operacion).startsWith("SIN-OPERACION-") ? "(sin número)" : String(o.numero_operacion),
    deuda: Number(o.deuda_total ?? 0),
    cuota: o.monto_cuota as number | null,
    cuotasPactadas: o.cuotas_pactadas as number | null,
    cuotasPagadas: o.cuotas_pagadas as number | null,
    cuotasMorosas: o.cuotas_morosas as number | null,
    diasMora: o.dias_mora as number | null,
    tramo: o.tramo_mora as string | null,
    fechaVencimiento: o.fecha_primer_vencimiento as string | null,
    fechaUltimoPago: o.fecha_ultimo_pago as string | null,
  }));

  // Historial del caso: gestiones del mes + llamadas manuales sin cartera (prototipo).
  const gestiones = (
    db
      .prepare(
        `SELECT g.id, g.fecha, g.tipo, g.estado_anterior, g.estado_nuevo, g.texto_libre, g.resultado,
                g.monto, g.fecha_compromiso, g.proxima_accion, g.telefono, g.duracion, g.motivo_llamada,
                TRIM(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellido, '')) AS usuario
           FROM gestiones g LEFT JOIN usuarios u ON u.id = g.usuario_id
          WHERE g.cliente_id = ? AND (g.cartera_id = ? OR g.cartera_id IS NULL)
          ORDER BY g.fecha DESC, g.rowid DESC LIMIT 300`
      )
      .all(clienteId, carteraId) as Array<Record<string, unknown>>
  ).map((g) => ({
    id: String(g.id),
    fecha: String(g.fecha),
    tipo: (g.tipo as Phoenix.TipoGestion) ?? "comentario",
    estadoAnterior: (g.estado_anterior as Phoenix.CodigoEstado) ?? null,
    estadoNuevo: (g.estado_nuevo as Phoenix.CodigoEstado) ?? null,
    comentario: (g.texto_libre as string) ?? null,
    resultado: (g.resultado as string) ?? null,
    monto: (g.monto as number) ?? null,
    fechaCompromiso: (g.fecha_compromiso as string) ?? null,
    proximaGestion: (g.proxima_accion as string) ?? null,
    telefono: (g.telefono as string) ?? null,
    duracion: (g.duracion as number) ?? null,
    motivoLlamada: (g.motivo_llamada as Phoenix.MotivoLlamada) ?? null,
    usuario: (g.usuario as string) || null,
  }));

  return {
    ...fila,
    direcciones: db
      .prepare("SELECT direccion, comuna FROM direcciones WHERE cliente_id = ?")
      .all(clienteId) as Phoenix.DetalleCliente["direcciones"],
    vehiculos: db
      .prepare("SELECT marca, modelo, patente FROM vehiculos WHERE cliente_id = ?")
      .all(clienteId) as Phoenix.DetalleCliente["vehiculos"],
    operaciones,
    gestiones,
    textoGestionImportada: textoImportado?.texto_gestion ?? null,
  };
}

/** Limpia y valida un comentario. */
function limpiarComentario(texto: unknown): string | null {
  if (texto === null || texto === undefined) return null;
  const limpio = String(texto).replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!limpio) return null;
  if (limpio.length > MAX_COMENTARIO) throw new Error(`El comentario supera los ${MAX_COMENTARIO} caracteres.`);
  return limpio;
}

/**
 * Registra una gestión sobre uno o varios clientes (RF-18): cambio de
 * estado ejecutivo, comentario, compromiso, abono/pago y próxima gestión.
 * Todo queda en el historial del caso (`gestiones`).
 *
 * Reglas:
 *  - Sin estado y sin comentario no hay nada que registrar.
 *  - COMPROMISO exige fecha (hoy o futura) y acepta monto.
 *  - ABONO exige monto > 0 y sólo se aplica a un cliente a la vez.
 *  - PAGADO registra como recuperado el monto indicado o, si no se indica,
 *    el saldo pendiente de cada cliente.
 *  - Salir de PAGADO revierte el monto de ese pago (queda registrado).
 *  - Pasar a EN_COLA reactiva los teléfonos válidos para la cola.
 */
export function registrarGestion(
  db: Database.Database,
  ctx: Contexto,
  solicitud: Phoenix.SolicitudGestion,
  extra: { telefono?: string | null; resultadoLlamada?: string | null } = {}
): Phoenix.ResultadoGestion {
  const carteraId = carteraObligatoria(db, ctx);
  const ids = [...new Set((solicitud.clienteIds ?? []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) throw new Error("Selecciona al menos un cliente.");

  const estadoNuevo = solicitud.estado ?? null;
  if (estadoNuevo !== null && !esEstadoValido(estadoNuevo)) throw new Error("Estado de cobranza inválido.");
  const definicion = estadoNuevo ? estadoPorCodigo(estadoNuevo) : null;

  const comentario = limpiarComentario(solicitud.comentario);
  if (!estadoNuevo && !comentario) throw new Error("Escribe un comentario o elige un nuevo estado.");

  const monto = num(solicitud.monto);
  if (monto !== null && monto < 0) throw new Error("El monto no puede ser negativo.");
  if (definicion?.montoObligatorio && (monto === null || monto <= 0)) throw new Error(`«${definicion.nombre}» requiere un monto mayor a cero.`);
  if (estadoNuevo === "ABONO" && ids.length > 1) throw new Error("Registra los abonos de a un cliente, cada uno con su monto.");

  const hoy = fechaLocal();
  const fechaCompromiso = solicitud.fechaCompromiso || null;
  if (estadoNuevo === "COMPROMISO") {
    if (!esFechaValida(fechaCompromiso)) throw new Error("Indica la fecha del compromiso de pago.");
    if (fechaCompromiso < hoy) throw new Error("La fecha del compromiso no puede ser anterior a hoy.");
  }
  const proximaGestion = solicitud.proximaGestion || null;
  if (proximaGestion !== null && !esFechaValida(proximaGestion)) throw new Error("La fecha de próxima gestión no es válida.");
  // undefined = regla del estado; null = sin recordatorio.
  const recordatorioPedido =
    solicitud.recordatorio === undefined ? undefined : solicitud.recordatorio === null ? null : validarNuevoRecordatorio(solicitud.recordatorio);

  const leerCaso = db.prepare(
    `SELECT cc.id, cc.estado_cobranza AS estado, cc.monto_recuperado AS recuperado,
            cc.fecha_compromiso AS fechaPrevia, cc.monto_compromiso AS montoPrevio, cc.proxima_gestion AS proximaPrevia,
            (SELECT COALESCE(SUM(o.deuda_total), 0) FROM operaciones o
              WHERE o.cliente_id = cc.cliente_id AND o.periodo_id = ?) AS deuda
       FROM cartera_clientes cc WHERE cc.cartera_id = ? AND cc.cliente_id = ?`
  );
  const ultimoPago = db.prepare(
    `SELECT monto FROM gestiones WHERE cartera_id = ? AND cliente_id = ? AND estado_nuevo = 'PAGADO' AND monto IS NOT NULL
      ORDER BY fecha DESC, rowid DESC LIMIT 1`
  );
  const insertar = db.prepare(
    `INSERT INTO gestiones (id, cliente_id, usuario_id, cartera_id, tipo, estado_anterior, estado_nuevo,
                            texto_libre, resultado, monto, fecha_compromiso, proxima_accion, telefono, categoria)
     VALUES (@id, @cliente, @usuario, @cartera, @tipo, @anterior, @nuevo, @texto, @resultado, @monto, @fecha, @proxima, @telefono, @categoria)`
  );
  const actualizar = db.prepare(
    `UPDATE cartera_clientes
        SET estado_cobranza = @estado, fecha_compromiso = @fechaCompromiso, monto_compromiso = @montoCompromiso,
            proxima_gestion = @proxima, monto_recuperado = @recuperado,
            ultima_gestion = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id`
  );
  const reactivarTelefonos = db.prepare(
    `UPDATE telefonos SET estado_llamada = 'PENDIENTE', updated_at = CURRENT_TIMESTAMP
      WHERE cliente_id = ? AND valido = 1`
  );

  let actualizados = 0;
  let omitidos = 0;

  db.transaction(() => {
    for (const clienteId of ids) {
      const caso = leerCaso.get(ctx.periodoId, carteraId, clienteId) as
        | {
            id: string;
            estado: Phoenix.CodigoEstado;
            recuperado: number;
            deuda: number;
            fechaPrevia: string | null;
            montoPrevio: number | null;
            proximaPrevia: string | null;
          }
        | undefined;
      if (!caso) {
        omitidos++;
        continue;
      }

      const anterior = caso.estado;
      const cambia = estadoNuevo !== null && estadoNuevo !== anterior;
      const estadoFinal = estadoNuevo ?? anterior;
      let recuperado = caso.recuperado ?? 0;
      let montoGestion: number | null = null;
      const notas: string[] = [];

      // Corrección: si deja de estar pagado, se revierte el pago registrado.
      if (cambia && anterior === "PAGADO") {
        const pago = (ultimoPago.get(carteraId, clienteId) as { monto: number } | undefined)?.monto ?? 0;
        if (pago > 0) {
          recuperado = Math.max(0, recuperado - pago);
          insertar.run({
            id: randomUUID(), cliente: clienteId, usuario: ctx.usuarioId, cartera: carteraId, tipo: "cambio_estado",
            anterior, nuevo: estadoFinal, texto: "Se revierte el pago registrado anteriormente.", resultado: "reverso_pago",
            monto: -pago, fecha: null, proxima: null, telefono: null, categoria: null,
          });
        }
      }

      if (estadoNuevo === "ABONO" && monto) {
        montoGestion = monto;
        recuperado += monto;
      } else if (estadoNuevo === "PAGADO" && (cambia || monto)) {
        const saldo = Math.max(0, caso.deuda - recuperado);
        montoGestion = monto !== null && ids.length === 1 ? monto : saldo;
        recuperado += montoGestion;
      } else if (estadoNuevo === "COMPROMISO") {
        montoGestion = ids.length === 1 ? monto : null;
      }

      if (estadoFinal === "EN_COLA" && cambia) {
        reactivarTelefonos.run(clienteId);
        notas.push("Enviado a la cola de llamadas.");
      }

      insertar.run({
        id: randomUUID(),
        cliente: clienteId,
        usuario: ctx.usuarioId,
        cartera: carteraId,
        tipo: cambia ? "cambio_estado" : "comentario",
        anterior: cambia ? anterior : null,
        nuevo: cambia ? estadoFinal : estadoNuevo && ["ABONO", "PAGADO", "COMPROMISO"].includes(estadoNuevo) ? estadoNuevo : null,
        texto: comentario ?? (notas.join(" ") || null),
        resultado: extra.resultadoLlamada ?? null,
        monto: montoGestion,
        fecha: estadoFinal === "COMPROMISO" ? fechaCompromiso : null,
        proxima: proximaGestion,
        telefono: extra.telefono ?? null,
        categoria: null,
      });

      // Un comentario sin cambio de estado conserva el compromiso vigente.
      // La próxima gestión se reemplaza si se indica; si no, se conserva sólo
      // si es futura (la de hoy o atrasada se da por realizada).
      const mantieneCompromiso = estadoFinal === "COMPROMISO" && estadoNuevo !== "COMPROMISO";
      actualizar.run({
        id: caso.id,
        estado: estadoFinal,
        fechaCompromiso: estadoFinal !== "COMPROMISO" ? null : mantieneCompromiso ? caso.fechaPrevia : fechaCompromiso,
        montoCompromiso: estadoFinal !== "COMPROMISO" ? null : mantieneCompromiso ? caso.montoPrevio : montoGestion,
        proxima: proximaGestion ?? (!cambia && caso.proximaPrevia && caso.proximaPrevia > hoy ? caso.proximaPrevia : null),
        recuperado,
      });

      // Vuelta de gestión: cualquier gestión cumple los recordatorios
      // pendientes; se agenda el siguiente según lo pedido o el estado.
      let recordatorio = recordatorioPedido;
      if (recordatorio === undefined) {
        const regla = estadoPorCodigo(estadoFinal).recordatorio;
        if (proximaGestion) {
          recordatorio = { fechaHora: `${proximaGestion}T${regla?.hora ?? "09:00"}`, motivo: regla?.motivo ?? "Gestión agendada" };
        } else {
          recordatorio = ids.length === 1 && cambia ? recordatorioSugerido(estadoFinal, fechaCompromiso) : null;
        }
      }
      reprogramarRecordatorio(db, ctx, carteraId, clienteId, recordatorio, estadoFinal);
      actualizados++;
    }
  })();

  return { actualizados, omitidos };
}

/** Marca un teléfono como válido o erróneo (sale o entra a la cola). */
export function marcarTelefono(db: Database.Database, ctx: Contexto, telefonoId: string, valido: boolean): void {
  const carteraId = carteraObligatoria(db, ctx);
  const tel = db
    .prepare(
      `SELECT t.id, t.numero, t.cliente_id FROM telefonos t JOIN cartera_clientes cc ON cc.cliente_id = t.cliente_id
        WHERE t.id = ? AND cc.cartera_id = ?`
    )
    .get(telefonoId, carteraId) as { id: string; numero: string; cliente_id: string } | undefined;
  if (!tel) throw new Error("Teléfono no encontrado en tu cartera.");

  db.prepare(
    `UPDATE telefonos SET valido = ?, estado_llamada = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(valido ? 1 : 0, valido ? "PENDIENTE" : "INVALIDO", tel.id);
  db.prepare(
    `INSERT INTO gestiones (id, cliente_id, usuario_id, cartera_id, tipo, texto_libre, telefono)
     VALUES (?, ?, ?, ?, 'comentario', ?, ?)`
  ).run(
    randomUUID(),
    tel.cliente_id,
    ctx.usuarioId,
    carteraId,
    valido ? `Teléfono ${tel.numero} marcado como válido.` : `Teléfono ${tel.numero} marcado como erróneo.`,
    tel.numero
  );
}

/** Historial de importaciones del ejecutivo (todas sus carteras). */
export function historialImportaciones(db: Database.Database, usuarioId: string): Phoenix.ImportacionHistorial[] {
  return db
    .prepare(
      `SELECT i.nombre_archivo AS archivo_nombre, i.hoja_nombre, i.fecha_importacion AS fecha, p.nombre AS periodo,
              i.registros_importados AS registros_cargados, i.registros_corregidos,
              i.registros_rechazados AS registros_con_error, i.estado
         FROM importaciones i
         JOIN carteras ca ON ca.id = i.cartera_id
         JOIN periodos p ON p.id = ca.periodo_id
        WHERE ca.usuario_id = ?
        ORDER BY i.fecha_importacion DESC, i.rowid DESC`
    )
    .all(usuarioId) as Phoenix.ImportacionHistorial[];
}

/** Catálogo de estados para la interfaz. */
export function catalogoEstados(): Phoenix.EstadoCobranza[] {
  return ESTADOS;
}
