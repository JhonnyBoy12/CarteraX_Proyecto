/**
 * @file graficos.ts (renderer)
 * @description Gráficos livianos en HTML/SVG, sin librerías externas
 * (offline-first, RNF-11). Los usan el Dashboard y la vista de Reportes.
 */

/** Orden de los estados en la franja: lo resuelto a la izquierda. */
const ORDEN_FRANJA: Phoenix.CodigoEstado[] = [
  "PAGADO", "ABONO", "COMPROMISO", "CONTACTADO", "NOTIFICADO", "EN_COLA",
  "NO_CONTESTA", "NO_PAGADO", "ALERTA", "INUBICABLE", "NO_CONTACTAR", "PENDIENTE",
];

/**
 * Franja de la cartera: toda la deuda del mes partida por estado de
 * cobranza. Cada segmento es clicable (filtra Clientes por ese estado).
 */
function franjaCartera(porEstado: Phoenix.SerieEstado[], deudaTotal: number): string {
  const total = deudaTotal || 1;
  const ordenados = [...porEstado].sort((a, b) => ORDEN_FRANJA.indexOf(a.estado) - ORDEN_FRANJA.indexOf(b.estado));
  const segmentos = ordenados
    .map((s) => {
      const e = App.porCodigo.get(s.estado);
      const pct = (s.deuda / total) * 100;
      return `<button class="franja-seg tono-${esc(e?.tono ?? "gris")}" style="flex-grow:${Math.max(s.deuda, total * 0.004)}"
        data-estado="${s.estado}" title="${esc(nombreEstado(s.estado))}: ${pesos(s.deuda)} en ${s.clientes} clientes (${numero(pct, 1)} %)">
        ${pct >= 7 ? `<span>${numero(pct, 0)} %</span>` : ""}</button>`;
    })
    .join("");
  const leyenda = ordenados
    .map(
      (s) => `<li><button data-estado="${s.estado}">${etiquetaEstado(s.estado)}
        <b>${pesosCorto(s.deuda)}</b><small>${numero(s.clientes)} ${s.clientes === 1 ? "cliente" : "clientes"}</small>
        <span class="fl-pct">${numero((s.deuda / total) * 100, 0)} %</span></button></li>`
    )
    .join("");
  return `<div class="franja">${segmentos || '<div class="franja-vacia"></div>'}</div><ul class="franja-leyenda">${leyenda}</ul>`;
}

/** Barras horizontales (tramos, rangos). */
function barrasHorizontales(
  items: Array<{ etiqueta: string; valor: number; texto: string; secundario?: string; clase?: string; dato?: string }>
): string {
  if (!items.length) return `<p class="sin-datos">Sin datos para este mes.</p>`;
  const max = Math.max(1, ...items.map((i) => i.valor));
  return `<ul class="barras-h">${items
    .map(
      (i) => `<li ${i.dato ? `data-filtro="${esc(i.dato)}" class="clicable"` : ""}>
        <span class="bh-etiqueta">${esc(i.etiqueta)}</span>
        <span class="bh-pista"><span class="bh-relleno ${i.clase ?? ""}" style="width:${Math.max(0.6, (i.valor / max) * 100)}%"></span></span>
        <span class="bh-valor">${esc(i.texto)}${i.secundario ? `<small>${esc(i.secundario)}</small>` : ""}</span>
      </li>`
    )
    .join("")}</ul>`;
}

/**
 * Columnas de actividad diaria del mes: gestiones (columna clara) con las
 * llamadas superpuestas (oscuro). Los días con recuperación llevan un punto.
 */
function graficoActividad(actividad: Phoenix.SerieActividad[]): string {
  if (!actividad.length) return `<p class="sin-datos">El mes aún no comienza.</p>`;
  const W = 720;
  const H = 190;
  const base = H - 26;
  const alto = base - 18;
  const max = Math.max(4, ...actividad.map((a) => a.gestiones));
  const paso = W / Math.max(actividad.length, 1);
  const ancho = Math.max(3, Math.min(18, paso * 0.62));
  const escala = (v: number) => (v / max) * alto;
  const hoy = hoyLocal();

  // Líneas guía: 0, mitad y máximo.
  const guias = [0, Math.round(max / 2), max]
    .map((v) => `<line x1="0" x2="${W}" y1="${base - escala(v)}" y2="${base - escala(v)}" class="guia"/>
      <text x="${W}" y="${base - escala(v) - 3}" class="eje" text-anchor="end">${v}</text>`)
    .join("");

  const columnas = actividad
    .map((a, i) => {
      const x = i * paso + (paso - ancho) / 2;
      const dia = Number(a.fecha.slice(8));
      const etiqueta = actividad.length <= 16 || dia === 1 || dia % 5 === 0 ? `<text x="${x + ancho / 2}" y="${H - 8}" class="eje" text-anchor="middle">${dia}</text>` : "";
      const titulo = `${fechaCalendario(a.fecha)}: ${a.gestiones} gestiones, ${a.llamadas} llamadas, ${a.cambios} cambios de estado${a.recuperado ? `, ${pesos(a.recuperado)} recuperado` : ""}`;
      return `<g class="${a.fecha === hoy ? "hoy" : ""}"><title>${esc(titulo)}</title>
        <rect x="${i * paso}" y="0" width="${paso}" height="${base}" class="zona"/>
        <rect x="${x}" y="${base - escala(a.gestiones)}" width="${ancho}" height="${escala(a.gestiones)}" rx="2" class="col-gestiones"/>
        <rect x="${x}" y="${base - escala(a.llamadas)}" width="${ancho}" height="${escala(a.llamadas)}" rx="2" class="col-llamadas"/>
        ${a.recuperado > 0 ? `<circle cx="${x + ancho / 2}" cy="${base - escala(a.gestiones) - 8}" r="3.5" class="punto-pago"/>` : ""}
        ${etiqueta}</g>`;
    })
    .join("");

  return `<svg class="grafico-actividad" viewBox="0 0 ${W} ${H}" role="img" aria-label="Actividad diaria del mes">
    ${guias}${columnas}<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="eje-base"/></svg>
    <p class="leyenda-grafico"><span class="l-gestiones"></span>Gestiones <span class="l-llamadas"></span>Llamadas <span class="l-pago"></span>Día con pagos o abonos</p>`;
}

/** Medidor de avance de meta. */
function medidorMeta(k: Phoenix.Kpis): string {
  if (k.metaMensual <= 0) {
    return `<div class="meta sin-meta"><p>Sin meta de recuperación para el mes.</p><button class="btn texto" data-ir="config">Definir meta</button></div>`;
  }
  const avance = Math.min(100, k.pctMeta ?? 0);
  return `<div class="meta">
    <div class="meta-cifras"><span>Meta del mes</span><b>${porcentaje(k.pctMeta)}</b></div>
    <div class="meta-pista" role="progressbar" aria-valuenow="${avance}" aria-valuemin="0" aria-valuemax="100"><span style="width:${avance}%"></span></div>
    <p>${pesos(k.recuperado)} de ${pesos(k.metaMensual)}${k.recuperado < k.metaMensual ? `, faltan ${pesos(k.metaMensual - k.recuperado)}` : ""}</p>
  </div>`;
}
