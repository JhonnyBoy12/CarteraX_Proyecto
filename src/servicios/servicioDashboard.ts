/**
 * @file servicioDashboard.ts
 * @description Indicadores del mes (RF-19, RF-22, RF-24, RF-26):
 * deuda total/recuperada/pendiente, avance de meta, compromisos,
 * contactabilidad, distribución por estado, tramo y rango de deuda,
 * actividad diaria del período, mayores deudas y alertas.
 *
 * Todo se calcula desde SQLite local (offline-first, RNF-11).
 * @since 0.3.0
 */
import Database from "better-sqlite3";

import { ESTADOS, esCerrado } from "../dominio/estados";
import { leerCartera } from "./servicioCartera";
import { leerConfigApp } from "./servicioConfiguracion";
import { agendaSeguimiento } from "./servicioRecordatorios";
import { Contexto, idCartera, obtenerPeriodo } from "./servicioPeriodos";
import { fechaLocal, sumarDias } from "./fechas";

/** Rangos de deuda para el histograma (pesos chilenos). */
const RANGOS: Array<{ rango: string; desde: number; hasta: number | null }> = [
  { rango: "Hasta $500 mil", desde: 0, hasta: 500_000 },
  { rango: "$500 mil – $1 M", desde: 500_000, hasta: 1_000_000 },
  { rango: "$1 M – $3 M", desde: 1_000_000, hasta: 3_000_000 },
  { rango: "$3 M – $5 M", desde: 3_000_000, hasta: 5_000_000 },
  { rango: "$5 M – $10 M", desde: 5_000_000, hasta: 10_000_000 },
  { rango: "Más de $10 M", desde: 10_000_000, hasta: null },
];

/** Porcentaje con 1 decimal (2 si es menor a 1 %, para no mostrar 0 %). */
/** 'AAAA-MM-DD' → 'DD-MM-AAAA' para textos de alerta. */
const fechaCl = (iso: string | null): string => (iso ? iso.split("-").reverse().join("-") : "");

const pct = (parte: number, total: number): number => {
  if (total <= 0) return 0;
  const v = (parte / total) * 100;
  return v > 0 && v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
};

/** Ordena tramos por el primer número ("1-30" < "31-60" < "+360"). */
function claveTramo(t: string): number {
  if (t === "(sin tramo)") return Number.MAX_SAFE_INTEGER;
  const m = t.match(/\d+/);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER - 1;
}

/**
 * Llamadas del mes por cómo terminaron, con los minutos hablados.
 * Las anteriores a v0.3.1 sin motivo se clasifican por su resultado.
 * @since 0.3.1
 */
function resumenLlamadas(db: Database.Database, carteraId: string | null): Phoenix.ResumenLlamadas {
  const vacio: Phoenix.ResumenLlamadas = { total: 0, contestadas: 0, porMotivo: {}, sinConfirmar: 0, segundosHablados: 0, duracionPromedio: null };
  if (!carteraId) return vacio;
  const filas = db
    .prepare(
      `SELECT COALESCE(motivo_llamada, CASE resultado WHEN 'contestada' THEN 'contestada' WHEN 'no contesta' THEN 'no_contesta' END) AS motivo,
              resultado, COUNT(*) AS n, COALESCE(SUM(duracion), 0) AS segundos
         FROM gestiones
        WHERE cartera_id = ? AND tipo = 'llamada' AND COALESCE(resultado, '') <> 'error'
        GROUP BY 1, 2`
    )
    .all(carteraId) as Array<{ motivo: Phoenix.MotivoLlamada | null; resultado: string | null; n: number; segundos: number }>;
  const r = { ...vacio, porMotivo: {} as Partial<Record<Phoenix.MotivoLlamada, number>> };
  for (const f of filas) {
    r.total += f.n;
    r.segundosHablados += f.segundos;
    if (f.resultado === "contestada") r.contestadas += f.n;
    if (f.motivo) r.porMotivo[f.motivo] = (r.porMotivo[f.motivo] ?? 0) + f.n;
    else r.sinConfirmar += f.n; // «enviada»: nunca se supo cómo terminó
  }
  r.duracionPromedio = r.contestadas ? Math.round(r.segundosHablados / r.contestadas) : null;
  return r;
}

/** Arma el dashboard completo del mes del contexto. */
export function obtenerDashboard(db: Database.Database, ctx: Contexto): Phoenix.Dashboard {
  const config = leerConfigApp(db);
  const periodo = obtenerPeriodo(db, ctx.usuarioId, ctx.periodoId);
  const filas = leerCartera(db, ctx);
  const carteraId = idCartera(db, ctx);
  const hoy = fechaLocal();

  // ------------------------------- KPIs -------------------------------
  const deudaTotal = filas.reduce((s, f) => s + f.deuda, 0);
  const recuperado = filas.reduce((s, f) => s + Math.min(f.montoRecuperado, f.deuda || f.montoRecuperado), 0);
  const compromisos = filas.filter((f) => f.estado === "COMPROMISO");
  const vigentes = compromisos.filter((f) => !f.compromisoVencido);
  const gestionados = filas.filter((f) => f.estado !== "PENDIENTE" || f.totalGestiones > 0).length;
  const conMora = filas.filter((f) => f.diasMora !== null);

  const llamadas = carteraId
    ? (db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN resultado = 'contestada' THEN 1 ELSE 0 END) AS contestadas,
                  SUM(CASE WHEN date(fecha, 'localtime') = ? THEN 1 ELSE 0 END) AS hoy
             FROM gestiones WHERE cartera_id = ? AND tipo = 'llamada' AND COALESCE(resultado, '') <> 'error'`
        )
        .get(hoy, carteraId) as { total: number; contestadas: number | null; hoy: number | null })
    : { total: 0, contestadas: 0, hoy: 0 };
  const llamadasFinalizadas = carteraId
    ? (db
        .prepare(
          `SELECT COUNT(*) AS n FROM gestiones
            WHERE cartera_id = ? AND tipo = 'llamada' AND resultado IN ('contestada', 'no contesta')`
        )
        .get(carteraId) as { n: number }).n
    : 0;
  const gestionesHoy = carteraId
    ? (db
        .prepare(`SELECT COUNT(*) AS n FROM gestiones WHERE cartera_id = ? AND date(fecha, 'localtime') = ?`)
        .get(carteraId, hoy) as { n: number }).n
    : 0;

  const kpis: Phoenix.Kpis = {
    clientes: filas.length,
    deudaTotal,
    // Por cobrar: saldo de los casos abiertos (los cerrados ya no se cobran).
    deudaPendiente: filas.filter((f) => !esCerrado(f.estado)).reduce((s, f) => s + Math.max(0, f.deuda - f.montoRecuperado), 0),
    recuperado,
    pctRecuperado: pct(recuperado, deudaTotal),
    metaMensual: config.metaMensual,
    pctMeta: config.metaMensual > 0 ? pct(recuperado, config.metaMensual) : null,
    compromisosVigentes: vigentes.length,
    montoCompromisos: vigentes.reduce((s, f) => s + (f.montoCompromiso ?? Math.max(0, f.deuda - f.montoRecuperado)), 0),
    compromisosVencidos: compromisos.length - vigentes.length,
    gestionados,
    pctGestionados: pct(gestionados, filas.length),
    moraPromedio: conMora.length ? Math.round(conMora.reduce((s, f) => s + (f.diasMora ?? 0), 0) / conMora.length) : null,
    enCola: filas.filter((f) => f.estado === "EN_COLA").length,
    llamadasPeriodo: llamadas.total ?? 0,
    contactadasPeriodo: llamadas.contestadas ?? 0,
    pctContactabilidad: llamadasFinalizadas > 0 ? pct(llamadas.contestadas ?? 0, llamadasFinalizadas) : null,
    llamadasHoy: llamadas.hoy ?? 0,
    gestionesHoy,
    prioridadAlta: filas.filter((f) => f.nivelPrioridad === "alta").length,
  };

  // ---------------------------- Distribuciones ----------------------------
  const porEstado: Phoenix.SerieEstado[] = ESTADOS.map((e) => {
    const grupo = filas.filter((f) => f.estado === e.codigo);
    return { estado: e.codigo, clientes: grupo.length, deuda: grupo.reduce((s, f) => s + f.deuda, 0) };
  }).filter((s) => s.clientes > 0);

  const tramos = new Map<string, Phoenix.SerieTramo>();
  for (const f of filas) {
    const t = f.tramo ?? "(sin tramo)";
    const acc = tramos.get(t) ?? { tramo: t, clientes: 0, deuda: 0 };
    acc.clientes++;
    acc.deuda += f.deuda;
    tramos.set(t, acc);
  }
  const porTramo = [...tramos.values()].sort((a, b) => claveTramo(a.tramo) - claveTramo(b.tramo));

  const porRango: Phoenix.SerieRango[] = RANGOS.map((r) => {
    const grupo = filas.filter((f) => f.deuda >= r.desde && (r.hasta === null || f.deuda < r.hasta));
    return { ...r, clientes: grupo.length, deuda: grupo.reduce((s, f) => s + f.deuda, 0) };
  });

  // ------------------- Actividad diaria dentro del mes -------------------
  const fin = periodo.fechaFin < hoy ? periodo.fechaFin : hoy;
  const actividad: Phoenix.SerieActividad[] = [];
  if (periodo.fechaInicio <= fin) {
    const porDia = new Map<string, Phoenix.SerieActividad>();
    if (carteraId) {
      for (const d of db
        .prepare(
          `SELECT date(fecha, 'localtime') AS fecha,
                  COUNT(*) AS gestiones,
                  SUM(CASE WHEN tipo = 'llamada' THEN 1 ELSE 0 END) AS llamadas,
                  SUM(CASE WHEN tipo = 'cambio_estado' THEN 1 ELSE 0 END) AS cambios,
                  COALESCE(SUM(CASE WHEN monto IS NOT NULL AND (estado_nuevo IN ('ABONO', 'PAGADO') OR resultado = 'reverso_pago')
                                    THEN monto END), 0) AS recuperado
             FROM gestiones
            WHERE cartera_id = ? AND date(fecha, 'localtime') BETWEEN ? AND ?
            GROUP BY date(fecha, 'localtime')`
        )
        .all(carteraId, periodo.fechaInicio, fin) as Phoenix.SerieActividad[]) {
        porDia.set(d.fecha, d);
      }
    }
    for (let dia = periodo.fechaInicio; dia <= fin; dia = sumarDias(dia, 1)) {
      actividad.push(porDia.get(dia) ?? { fecha: dia, gestiones: 0, llamadas: 0, cambios: 0, recuperado: 0 });
    }
  }

  // ------------------------------- Alertas -------------------------------
  const alertas: Phoenix.Alerta[] = [];
  // "Prioridad alta sin gestión" sólo para los 15 de mayor score, para que
  // a comienzo de mes la lista no se llene con toda la cartera.
  const altasSinGestion = new Set(
    filas
      .filter((f) => !esCerrado(f.estado) && f.nivelPrioridad === "alta" && (f.diasSinGestion === null || f.diasSinGestion >= config.diasSinGestion))
      .sort((a, b) => b.prioridad - a.prioridad)
      .slice(0, 15)
      .map((f) => f.id)
  );
  for (const f of filas) {
    if (esCerrado(f.estado)) continue;
    const base = { clienteId: f.id, nombre: f.nombre, rut: f.dv ? `${f.rut}-${f.dv}` : f.rut };
    if (f.compromisoVencido) {
      alertas.push({ ...base, tipo: "compromiso_vencido", nivel: "alta", detalle: `Compromiso vencido el ${fechaCl(f.fechaCompromiso)}${f.montoCompromiso ? ` por $${Math.round(f.montoCompromiso).toLocaleString("es-CL")}` : ""}` });
    } else if (f.estado === "COMPROMISO" && f.fechaCompromiso === hoy) {
      alertas.push({ ...base, tipo: "compromiso_hoy", nivel: "media", detalle: "Compromiso de pago vence hoy" });
    }
    if (f.estado === "ALERTA") {
      alertas.push({ ...base, tipo: "estado_alerta", nivel: "alta", detalle: f.ultimoComentario ?? "Marcado en alerta" });
    }
    if (altasSinGestion.has(f.id)) {
      alertas.push({
        ...base,
        tipo: "alta_sin_gestion",
        nivel: "media",
        detalle: f.diasSinGestion === null ? "Prioridad alta, nunca gestionado" : `Prioridad alta, ${f.diasSinGestion} días sin gestión`,
      });
    }
    if (f.proximaGestion && f.proximaGestion <= hoy) {
      alertas.push({
        ...base,
        tipo: "proxima_gestion",
        nivel: f.proximaGestion < hoy ? "alta" : "media",
        detalle: f.proximaGestion < hoy ? `Gestión agendada para el ${fechaCl(f.proximaGestion)}, atrasada` : "Gestión agendada para hoy",
      });
    }
  }
  alertas.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "alta" ? -1 : 1));

  return {
    periodo,
    generado: new Date().toISOString(),
    kpis,
    llamadas: resumenLlamadas(db, carteraId),
    agenda: agendaSeguimiento(db, ctx),
    porEstado,
    porTramo,
    porRango,
    actividad,
    topDeuda: [...filas].sort((a, b) => b.deuda - a.deuda).slice(0, 10),
    proximosCompromisos: compromisos
      .filter((f) => f.fechaCompromiso)
      .sort((a, b) => (a.fechaCompromiso ?? "").localeCompare(b.fechaCompromiso ?? ""))
      .slice(0, 10),
    alertas: alertas.slice(0, 60),
  };
}
