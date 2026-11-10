/**
 * @file graficos-nova.ts
 * @description Gráficos SVG livianos de la interfaz Nova (sin librerías,
 * offline): anillo de avance, dona, área diaria, minilínea, calendario del
 * mes, barras por día de la semana y por hora. Los colores salen de las
 * variables CSS, así que siguen el tema claro u oscuro.
 */

/** Anillo de avance 0–100 con texto central. */
function anilloAvance(pct: number | null, opciones: { tamano?: number; grosor?: number; centro?: string; sub?: string; clase?: string } = {}): string {
  const t = opciones.tamano ?? 132;
  const g = opciones.grosor ?? 11;
  const r = (t - g) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return `<svg class="anillo ${opciones.clase ?? ""}" viewBox="0 0 ${t} ${t}" width="${t}" height="${t}" role="img" aria-label="${pct === null ? "Sin meta" : `${numero(v, 1)} %`}">
      <circle class="anillo-pista" cx="${t / 2}" cy="${t / 2}" r="${r}" stroke-width="${g}"/>
      <circle class="anillo-valor" cx="${t / 2}" cy="${t / 2}" r="${r}" stroke-width="${g}"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}" style="--largo:${c}" transform="rotate(-90 ${t / 2} ${t / 2})"/>
      ${opciones.centro ? `<text class="anillo-centro" x="50%" y="${opciones.sub ? "47%" : "50%"}" dominant-baseline="middle" text-anchor="middle">${opciones.centro}</text>` : ""}
      ${opciones.sub ? `<text class="anillo-sub" x="50%" y="63%" dominant-baseline="middle" text-anchor="middle">${esc(opciones.sub)}</text>` : ""}
    </svg>`;
}

/** Dona por segmentos (colores CSS). */
function dona(segmentos: Array<{ valor: number; color: string; etiqueta: string }>, centro: string, sub: string, tamano = 168): string {
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  const g = 20;
  const r = (tamano - g) / 2;
  const c = 2 * Math.PI * r;
  let acumulado = 0;
  const arcos = total
    ? segmentos
        .filter((s) => s.valor > 0)
        .map((s) => {
          const largo = (s.valor / total) * c;
          const separacion = segmentos.length > 1 ? Math.min(2.5, largo * 0.25) : 0;
          const arco = `<circle class="dona-seg" cx="${tamano / 2}" cy="${tamano / 2}" r="${r}" stroke-width="${g}" style="stroke:${s.color}"
            stroke-dasharray="${Math.max(0.01, largo - separacion)} ${c}" stroke-dashoffset="${-acumulado}" transform="rotate(-90 ${tamano / 2} ${tamano / 2})">
            <title>${esc(s.etiqueta)}: ${numero(s.valor)} (${numero((s.valor / total) * 100, 1)} %)</title></circle>`;
          acumulado += largo;
          return arco;
        })
        .join("")
    : "";
  return `<svg class="dona" viewBox="0 0 ${tamano} ${tamano}" width="${tamano}" height="${tamano}" role="img" aria-label="${esc(sub)}">
      <circle class="anillo-pista" cx="${tamano / 2}" cy="${tamano / 2}" r="${r}" stroke-width="${g}"/>${arcos}
      <text class="anillo-centro" x="50%" y="46%" dominant-baseline="middle" text-anchor="middle">${centro}</text>
      <text class="anillo-sub" x="50%" y="61%" dominant-baseline="middle" text-anchor="middle">${esc(sub)}</text></svg>`;
}

/** Minilínea para tarjetas de cifras. */
function minilinea(valores: number[], clase = ""): string {
  // Sin al menos dos cambios la línea no dice nada (p. ej. todo ocurrió hoy).
  const cambios = valores.filter((v, i) => i > 0 && v !== valores[i - 1]).length;
  if (valores.length < 2 || cambios < 2) return "";
  const W = 120;
  const H = 34;
  const max = Math.max(1, ...valores);
  const paso = W / (valores.length - 1);
  const pts = valores.map((v, i) => [i * paso, H - 3 - (v / max) * (H - 6)]);
  const linea = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return `<svg class="minilinea ${clase}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="ml-area" d="${linea} L${W} ${H} L0 ${H} Z"/><path class="ml-linea" d="${linea}"/></svg>`;
}

/** Curva suave (Catmull-Rom → Bézier) por puntos, sin pasarse de los valores vecinos. */
function curva(pts: Array<[number, number]>): string {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const bajo = Math.min(p1[1], p2[1]);
    const alto = Math.max(p1[1], p2[1]);
    const c1y = Math.min(alto, Math.max(bajo, p1[1] + (p2[1] - p0[1]) / 6));
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = Math.min(alto, Math.max(bajo, p2[1] - (p3[1] - p1[1]) / 6));
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * Ritmo diario del mes: llamadas en área y gestiones en columnas; los días
 * con pagos llevan un punto. Cada día tiene su detalle al pasar el puntero.
 */
function graficoRitmo(actividad: Phoenix.SerieActividad[]): string {
  if (!actividad.length) return `<p class="sin-datos">El mes aún no comienza.</p>`;
  const W = 1100;
  const H = 250;
  const base = H - 28;
  const alto = base - 22;
  const max = Math.max(4, ...actividad.map((a) => Math.max(a.gestiones, a.llamadas)));
  const paso = W / actividad.length;
  const ancho = Math.max(3, Math.min(14, paso * 0.46));
  const y = (v: number) => base - (v / max) * alto;
  const hoy = hoyLocal();
  const guias = [0, Math.round(max / 2), max]
    .map((v) => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="guia"/><text x="0" y="${y(v) - 5}" class="eje">${v}</text>`)
    .join("");
  const puntos = actividad.map((a, i) => [i * paso + paso / 2, y(a.llamadas)] as [number, number]);
  const lineaLlamadas = curva(puntos);
  const area = `${lineaLlamadas} L${puntos[puntos.length - 1][0]} ${base} L${puntos[0][0]} ${base} Z`;
  const columnas = actividad
    .map((a, i) => {
      const x = i * paso + (paso - ancho) / 2;
      const dia = Number(a.fecha.slice(8));
      const etiqueta = actividad.length <= 16 || dia === 1 || dia % 5 === 0 ? `<text x="${x + ancho / 2}" y="${H - 8}" class="eje" text-anchor="middle">${dia}</text>` : "";
      const titulo = `${fechaCalendario(a.fecha)}: ${a.gestiones} gestiones, ${a.llamadas} llamadas, ${a.cambios} cambios de estado${a.recuperado ? `, ${pesos(a.recuperado)} recuperado` : ""}`;
      return `<g class="rd-dia ${a.fecha === hoy ? "hoy" : ""}" style="--i:${i}"><title>${esc(titulo)}</title>
        <rect x="${i * paso}" y="0" width="${paso}" height="${base}" class="zona"/>
        <rect x="${x}" y="${y(a.gestiones)}" width="${ancho}" height="${base - y(a.gestiones)}" rx="3" class="col-gestiones"/>
        ${a.recuperado > 0 ? `<circle cx="${x + ancho / 2}" cy="${Math.min(y(a.gestiones), y(a.llamadas)) - 9}" r="3.5" class="punto-pago"/>` : ""}
        ${etiqueta}</g>`;
    })
    .join("");
  return `<svg class="grafico-ritmo" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ritmo diario del mes">
      <defs><linearGradient id="g-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ga-1"/><stop offset="1" class="ga-2"/></linearGradient></defs>
      ${guias}${columnas}
      <path d="${area}" class="area-llamadas"/><path d="${lineaLlamadas}" class="linea-llamadas"/>
      <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="eje-base"/></svg>
    <p class="leyenda-n"><span class="l-llamadas"></span>Llamadas <span class="l-gestiones"></span>Gestiones <span class="l-pago"></span>Día con pagos o abonos</p>`;
}

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Índice lunes=0 … domingo=6 de 'AAAA-MM-DD'. */
function diaSemana(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return (new Date(a, m - 1, d).getDay() + 6) % 7;
}

/** Barras verticales por día de la semana (llamadas y gestiones del mes). */
function barrasSemana(actividad: Phoenix.SerieActividad[]): string {
  const sumas = DIAS_SEMANA.map(() => ({ llamadas: 0, gestiones: 0 }));
  for (const a of actividad) {
    const s = sumas[diaSemana(a.fecha)];
    s.llamadas += a.llamadas;
    s.gestiones += a.gestiones;
  }
  const max = Math.max(1, ...sumas.map((s) => Math.max(s.llamadas, s.gestiones)));
  const mejor = sumas.reduce((b, s, i) => (s.llamadas + s.gestiones > sumas[b].llamadas + sumas[b].gestiones ? i : b), 0);
  const hayDatos = sumas.some((s) => s.llamadas + s.gestiones > 0);
  return `<ul class="barras-v">${sumas
    .map(
      (s, i) => `<li class="${hayDatos && i === mejor ? "mejor" : ""}" title="${DIAS_SEMANA[i]}: ${s.llamadas} llamadas, ${s.gestiones} gestiones">
        <span class="bv-pista"><b class="bv-gestiones" style="--h:${(s.gestiones / max) * 100}%"></b><b class="bv-llamadas" style="--h:${(s.llamadas / max) * 100}%"></b></span>
        <small>${DIAS_SEMANA[i]}</small></li>`
    )
    .join("")}</ul>`;
}

/** Barras por hora del día (llamadas recientes). */
function barrasHora(llamadas: Phoenix.LlamadaRegistrada[]): string {
  const horas = new Array(24).fill(0) as number[];
  for (const l of llamadas) {
    const d = desdeUtc(l.fecha);
    if (!Number.isNaN(d.getTime())) horas[d.getHours()]++;
  }
  const desde = Math.min(8, ...horas.map((n, h) => (n ? h : 24)));
  const hasta = Math.max(20, ...horas.map((n, h) => (n ? h : 0)));
  const rango = horas.slice(desde, hasta + 1);
  const max = Math.max(1, ...rango);
  return `<ul class="barras-hora">${rango
    .map((n, i) => `<li title="${desde + i}:00 – ${desde + i}:59: ${n} ${n === 1 ? "llamada" : "llamadas"}"><span style="--h:${(n / max) * 100}%" ${n === 0 ? "data-cero" : ""}></span><small>${(desde + i) % 2 === 0 ? desde + i : ""}</small></li>`)
    .join("")}</ul>`;
}

/**
 * Calendario del mes: cada día se colorea según las gestiones; los días con
 * pagos llevan un punto. Empieza en lunes.
 */
function calendarioMes(actividad: Phoenix.SerieActividad[], periodo: Phoenix.Periodo): string {
  const [a, m] = periodo.id.split("-").map(Number);
  const diasMes = new Date(a, m, 0).getDate();
  const porFecha = new Map(actividad.map((x) => [x.fecha, x]));
  const max = Math.max(1, ...actividad.map((x) => x.gestiones + x.llamadas));
  const desfase = (new Date(a, m - 1, 1).getDay() + 6) % 7;
  const hoy = hoyLocal();
  const celdas: string[] = [];
  for (let i = 0; i < desfase; i++) celdas.push(`<span class="cal-vacio"></span>`);
  for (let d = 1; d <= diasMes; d++) {
    const f = `${periodo.id}-${String(d).padStart(2, "0")}`;
    const x = porFecha.get(f);
    const total = x ? x.gestiones + x.llamadas : 0;
    const nivel = total === 0 ? 0 : Math.min(4, Math.ceil((total / max) * 4));
    const futuro = f > hoy;
    celdas.push(
      `<span class="cal-dia n${nivel} ${f === hoy ? "hoy" : ""} ${futuro ? "futuro" : ""}" title="${esc(fechaCalendario(f))}${x ? `: ${x.gestiones} gestiones, ${x.llamadas} llamadas${x.recuperado ? `, ${pesos(x.recuperado)} recuperado` : ""}` : ""}">${d}${x && x.recuperado > 0 ? "<i></i>" : ""}</span>`
    );
  }
  return `<div class="calendario"><div class="cal-sem">${DIAS_SEMANA.map((d) => `<span>${d.slice(0, 2)}</span>`).join("")}</div>
      <div class="cal-rejilla">${celdas.join("")}</div>
      <p class="leyenda-n cal-leyenda"><span>Menos</span><b class="n1"></b><b class="n2"></b><b class="n3"></b><b class="n4"></b><span>Más</span><span class="l-pago"></span>Pagos</p></div>`;
}
