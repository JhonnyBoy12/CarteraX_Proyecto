/**
 * @file tablero.ts (Nova)
 * @description Inicio de la interfaz Nova (RF-22, RF-24, RF-26), repartido
 * en cuatro pestañas: Resumen, Actividad, Metas y Categorías.
 * `pintarDashboard` también lo usa Reportes para mostrar un mes guardado.
 * Las metas personales (llamadas, gestiones, contactabilidad, cobertura) se
 * guardan en este equipo; la de recuperación es la de Ajustes.
 */

const NOMBRE_ALERTA: Record<Phoenix.TipoAlerta, string> = {
  compromiso_vencido: "Compromiso vencido",
  compromiso_hoy: "Compromiso hoy",
  alta_sin_gestion: "Sin gestión",
  estado_alerta: "En alerta",
  proxima_gestion: "Gestión agendada",
};

type PestanaTablero = "resumen" | "actividad" | "metas" | "categorias";
const PESTANAS: Array<{ id: PestanaTablero; nombre: string; icono: string }> = [
  { id: "resumen", nombre: "Resumen", icono: "i-resumen" },
  { id: "actividad", nombre: "Actividad", icono: "i-actividad" },
  { id: "metas", nombre: "Metas", icono: "i-meta" },
  { id: "categorias", nombre: "Categorías", icono: "i-categorias" },
];

let ultimoDashboard: Phoenix.Dashboard | null = null;

function leerLocal(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function guardarLocal(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento local */
  }
}

function pestanaGuardada(): PestanaTablero {
  const p = leerLocal("nova-pestana");
  return PESTANAS.some((x) => x.id === p) ? (p as PestanaTablero) : "resumen";
}

// ============================ Metas personales ============================

interface MetasPersonales {
  llamadas: number;
  gestiones: number;
  contacto: number;
  cobertura: number;
}

function claveMetas(): string {
  return `nova-metas:${App.contexto?.usuario.email ?? "ejecutivo"}`;
}

function metasPersonales(): MetasPersonales {
  const vacias = { llamadas: 0, gestiones: 0, contacto: 0, cobertura: 0 };
  try {
    return { ...vacias, ...JSON.parse(leerLocal(claveMetas()) ?? "{}") };
  } catch {
    return vacias;
  }
}

function abrirDialogoMetas(): void {
  const m = metasPersonales();
  $input("meta-llamadas").value = m.llamadas ? String(m.llamadas) : "";
  $input("meta-gestiones").value = m.gestiones ? String(m.gestiones) : "";
  $input("meta-contacto").value = m.contacto ? String(m.contacto) : "";
  $input("meta-cobertura").value = m.cobertura ? String(m.cobertura) : "";
  ($("dialogo-metas") as HTMLDialogElement).showModal();
  $input("meta-llamadas").focus();
}

// ============================ Calendario del mes ============================

interface InfoMes {
  diasMes: number;
  diaActual: number;
  enCurso: boolean;
  habilesTotales: number;
  habilesHastaHoy: number;
  habilesRestantes: number;
}

function infoMes(p: Phoenix.Periodo): InfoMes {
  const [a, m] = p.id.split("-").map(Number);
  const diasMes = new Date(a, m, 0).getDate();
  const ahora = new Date();
  const enCurso = p.esActual && ahora.getFullYear() === a && ahora.getMonth() + 1 === m;
  const diaActual = enCurso ? ahora.getDate() : diasMes;
  let habilesTotales = 0;
  let habilesHastaHoy = 0;
  let habilesRestantes = 0;
  for (let d = 1; d <= diasMes; d++) {
    const s = new Date(a, m - 1, d).getDay();
    if (s === 0 || s === 6) continue;
    habilesTotales++;
    if (d <= diaActual) habilesHastaHoy++;
    if (enCurso && d >= diaActual) habilesRestantes++;
  }
  return { diasMes, diaActual, enCurso, habilesTotales, habilesHastaHoy, habilesRestantes };
}

/** Días hábiles seguidos con actividad, terminando hoy (o ayer si hoy aún no hay). */
function rachaActividad(actividad: Phoenix.SerieActividad[]): number {
  const hoy = hoyLocal();
  const pasados = actividad.filter((a) => a.fecha <= hoy).sort((x, y) => (x.fecha < y.fecha ? 1 : -1));
  let racha = 0;
  for (let i = 0; i < pasados.length; i++) {
    const a = pasados[i];
    const finDeSemana = diaSemana(a.fecha) >= 5;
    const activo = a.gestiones + a.llamadas > 0;
    if (activo) racha++;
    else if (finDeSemana || (i === 0 && a.fecha === hoy)) continue;
    else break;
  }
  return racha;
}

// ============================ Piezas comunes ============================

function cifraTarjeta(titulo: string, valor: string, nota: string, opciones: { icono?: string; tono?: string; linea?: string; extra?: string } = {}): string {
  return `<article class="kpi ${opciones.tono ?? ""}">
      <header><span class="kpi-icono"><svg aria-hidden="true"><use href="#${opciones.icono ?? "i-resumen"}"/></svg></span><h3>${esc(titulo)}</h3>${opciones.extra ?? ""}</header>
      <p class="kpi-valor cifra-anim">${valor}</p>
      <p class="kpi-nota">${nota}</p>
      ${opciones.linea ?? ""}
    </article>`;
}

function estadoRitmo(valor: number, meta: number, fraccion: number): { texto: string; clase: string } {
  if (meta <= 0) return { texto: "Sin meta", clase: "neutro" };
  if (valor >= meta) return { texto: "Cumplida", clase: "ok" };
  const esperado = meta * fraccion;
  if (valor >= esperado) return { texto: "En camino", clase: "ok" };
  if (valor >= esperado * 0.8) return { texto: "Algo atrás", clase: "aviso" };
  return { texto: "Bajo el ritmo", clase: "alerta" };
}

function filaClienteN(c: Phoenix.ClienteFila, derecha: string, interactivo: boolean): string {
  const tono = App.porCodigo.get(c.estado)?.tono ?? "gris";
  return `<li ${interactivo ? `data-cliente="${esc(c.id)}" class="clicable" tabindex="0"` : ""}>
      <span class="mini-avatar tono-${esc(tono)}">${esc(iniciales(c.nombre))}</span>
      <span class="lc-nombre">${esc(c.nombre)}<small>${esc(rutCompleto(c.rut, c.dv))} · ${esc(nombreEstado(c.estado))}</small></span>
      <span class="lc-derecha">${derecha}</span></li>`;
}

// ============================ Pestañas ============================

function panelResumen(d: Phoenix.Dashboard, interactivo: boolean): string {
  const k = d.kpis;
  const recuperadoAcumulado: number[] = [];
  d.actividad.reduce((s, a) => {
    recuperadoAcumulado.push(s + a.recuperado);
    return s + a.recuperado;
  }, 0);
  const gestionesDia = d.actividad.map((a) => a.gestiones);
  const llamadasDia = d.actividad.map((a) => a.llamadas);
  const alertas = d.alertas.slice(0, 7);
  const agenda = interactivo ? d.agenda : undefined;
  const meta = k.metaMensual > 0;

  return `
    <div class="kpis">
      ${cifraTarjeta("Deuda de la cartera", `<span title="${pesos(k.deudaTotal)}">${pesosCorto(k.deudaTotal)}</span>`, `${numero(k.clientes)} clientes · mora promedio ${k.moraPromedio === null ? "—" : `${numero(k.moraPromedio)} días`}`, { icono: "i-cartera" })}
      ${cifraTarjeta("Recuperado", `<span title="${pesos(k.recuperado)}">${pesosCorto(k.recuperado)}</span>`, `${porcentaje(k.pctRecuperado)} de la deuda del mes`, { icono: "i-check", tono: "positivo", linea: minilinea(recuperadoAcumulado, "positivo") })}
      ${cifraTarjeta("Gestiones", numero(d.actividad.reduce((s, a) => s + a.gestiones, 0)), `${numero(k.gestionesHoy)} hoy · ${porcentaje(k.pctGestionados)} de la cartera`, { icono: "i-lapiz", linea: minilinea(gestionesDia) })}
      ${cifraTarjeta("Llamadas", numero(k.llamadasPeriodo), k.llamadasPeriodo ? `${porcentaje(k.pctContactabilidad)} contactabilidad · ${numero(k.llamadasHoy)} hoy` : "aún sin llamadas este mes", { icono: "i-cola", tono: "acento", linea: minilinea(llamadasDia, "acento") })}
    </div>

    <div class="rejilla-n r-2-1">
      <section class="tarjeta-n foco">
        <header class="tarjeta-cab"><h2>Foco de hoy</h2><span class="bajada">lo que no puede esperar</span></header>
        <div class="foco-cifras">
          <div class="${k.compromisosVencidos ? "alerta" : ""}"><dt>Compromisos vencidos</dt><dd class="cifra-anim">${numero(k.compromisosVencidos)}</dd></div>
          <div><dt>Compromisos vigentes</dt><dd class="cifra-anim">${numero(k.compromisosVigentes)}</dd><small>${pesosCorto(k.montoCompromisos)}</small></div>
          ${agenda ? `<div class="${agenda.atrasados ? "alerta" : ""}"><dt>Recordatorios atrasados</dt><dd class="cifra-anim">${numero(agenda.atrasados)}</dd><small>${numero(agenda.hoy)} para hoy</small></div>` : ""}
          <div><dt>En cola de llamadas</dt><dd class="cifra-anim">${numero(k.enCola)}</dd>${interactivo ? `<button class="enlace-n" data-ir="cola">Abrir cola</button>` : ""}</div>
        </div>
        ${
          alertas.length
            ? `<ul class="lista-alertas-n">${alertas
                .map(
                  (a) => `<li class="nivel-${a.nivel} ${interactivo ? "clicable" : ""}" ${interactivo ? `data-cliente="${esc(a.clienteId)}" tabindex="0"` : ""}>
                    <span class="la-marca"></span>
                    <span class="la-tipo">${esc(NOMBRE_ALERTA[a.tipo])}</span>
                    <span class="la-nombre">${esc(a.nombre)}</span>
                    <span class="la-detalle">${esc(a.detalle)}</span>
                    ${interactivo ? `<svg class="la-flecha" aria-hidden="true"><use href="#i-flecha"/></svg>` : ""}</li>`
                )
                .join("")}</ul>${d.alertas.length > alertas.length ? `<p class="bajada mas">y ${numero(d.alertas.length - alertas.length)} alertas más</p>` : ""}`
            : `<p class="sin-datos">Nada pendiente. Las alertas aparecen cuando un compromiso vence o un cliente prioritario lleva días sin gestión.</p>`
        }
      </section>

      <section class="tarjeta-n meta-mini">
        <header class="tarjeta-cab"><h2>Meta de recuperación</h2>${interactivo ? `<button class="enlace-n" data-tab-ir="metas">Ver metas</button>` : ""}</header>
        ${
          meta
            ? `<div class="meta-mini-cuerpo">${anilloAvance(k.pctMeta, { centro: porcentaje(k.pctMeta), sub: "de la meta", tamano: 148, grosor: 12 })}
                <dl><div><dt>Recuperado</dt><dd>${pesos(k.recuperado)}</dd></div><div><dt>Meta</dt><dd>${pesos(k.metaMensual)}</dd></div>
                <div><dt>${k.recuperado >= k.metaMensual ? "Superada por" : "Faltan"}</dt><dd>${pesos(Math.abs(k.metaMensual - k.recuperado))}</dd></div></dl></div>`
            : `<div class="meta-mini-cuerpo">${anilloAvance(k.pctRecuperado, { centro: porcentaje(k.pctRecuperado), sub: "recuperado", tamano: 148, grosor: 12 })}
                <dl><div><dt>Recuperado</dt><dd>${pesos(k.recuperado)}</dd></div><div><dt>De una deuda de</dt><dd>${pesosCorto(k.deudaTotal)}</dd></div>
                <div><dt>Meta del mes</dt><dd class="sin-meta-texto">Sin definir</dd></div></dl></div>
                ${interactivo ? `<button class="btn-n secundario" data-tab-ir="metas"><svg aria-hidden="true"><use href="#i-meta"/></svg>Definir meta de recuperación</button>` : ""}`
        }
      </section>
    </div>

    <div class="rejilla-n r-${agenda ? "3" : "2"}">
      ${
        agenda
          ? `<section class="tarjeta-n">
              <header class="tarjeta-cab"><h2>Agenda de seguimiento</h2><button class="enlace-n" data-abrir-recordatorios>Ver todos</button></header>
              ${
                agenda.lista.length
                  ? `<ul class="agenda-n">${agenda.lista
                      .slice(0, 6)
                      .map((r) => {
                        const c = cuandoRecordatorio(r.fechaHora);
                        return `<li data-cliente="${esc(r.clienteId)}" class="clicable" tabindex="0">
                          <span class="ag-hora ${r.fechaHora < fechaHoraLocalTexto() ? "atrasado" : ""}"><b>${esc(c.hora)}</b><small>${esc(c.dia)}</small></span>
                          <span class="ag-texto"><b>${esc(r.nombre)}</b><small>${esc(r.motivo)}</small></span></li>`;
                      })
                      .join("")}</ul>`
                  : `<p class="sin-datos">Sin recordatorios pendientes. Se agendan solos al registrar «No contesta», «Notificado» o un compromiso.</p>`
              }
            </section>`
          : ""
      }
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Próximos compromisos</h2></header>
        ${
          d.proximosCompromisos.length
            ? `<ul class="lista-n">${d.proximosCompromisos
                .slice(0, 6)
                .map((c) =>
                  filaClienteN(
                    c,
                    `<b class="${c.compromisoVencido ? "texto-alerta" : ""}">${fechaCalendario(c.fechaCompromiso)}</b><small>${c.montoCompromiso ? pesos(c.montoCompromiso) : ""}</small>`,
                    interactivo
                  )
                )
                .join("")}</ul>`
            : `<p class="sin-datos">Sin compromisos de pago registrados este mes.</p>`
        }
      </section>
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Mayores deudas</h2></header>
        <ul class="lista-n">${d.topDeuda.slice(0, 6).map((c) => filaClienteN(c, `<b>${pesosCorto(c.deuda)}</b><small>${c.diasMora === null ? "" : `${numero(c.diasMora)} días`}</small>`, interactivo)).join("") || '<li class="sin-datos">Sin clientes.</li>'}</ul>
      </section>
    </div>`;
}

function panelActividad(d: Phoenix.Dashboard, interactivo: boolean): string {
  const k = d.kpis;
  const l = d.llamadas;
  const info = infoMes(d.periodo);
  const gestionesMes = d.actividad.reduce((s, a) => s + a.gestiones, 0);
  const cambiosMes = d.actividad.reduce((s, a) => s + a.cambios, 0);
  const diasActivos = d.actividad.filter((a) => a.gestiones + a.llamadas > 0).length;
  const racha = rachaActividad(d.actividad);
  const promedioLlamadas = k.llamadasPeriodo / Math.max(1, info.habilesHastaHoy);
  const mejorDia = [...d.actividad].sort((a, b) => b.llamadas + b.gestiones - (a.llamadas + a.gestiones))[0];
  const comparacion = promedioLlamadas > 0 && info.enCurso ? Math.round(((k.llamadasHoy - promedioLlamadas) / promedioLlamadas) * 100) : null;

  const orden = Object.keys(MOTIVOS) as Phoenix.MotivoLlamada[];
  const conMotivo = l ? orden.filter((m) => (l.porMotivo[m] ?? 0) > 0) : [];
  const totalMotivos = l ? conMotivo.reduce((s, m) => s + (l.porMotivo[m] ?? 0), 0) : 0;

  return `
    <div class="kpis seis">
      ${cifraTarjeta("Llamadas del mes", numero(k.llamadasPeriodo), `${numero(promedioLlamadas, 1)} por día hábil`, { icono: "i-cola", tono: "acento" })}
      ${cifraTarjeta("Contestadas", l ? numero(l.contestadas) : numero(k.contactadasPeriodo), `${porcentaje(k.pctContactabilidad)} de contactabilidad`, { icono: "i-check", tono: "positivo" })}
      ${cifraTarjeta("Tiempo hablado", l ? duracionLarga(l.segundosHablados) : "—", l && l.duracionPromedio !== null ? `${segundos(l.duracionPromedio)} por llamada` : "sin conversaciones medidas", { icono: "i-reloj" })}
      ${cifraTarjeta("Gestiones", numero(gestionesMes), `${numero(cambiosMes)} cambios de estado`, { icono: "i-lapiz" })}
      ${cifraTarjeta("Días activos", numero(diasActivos), `de ${numero(info.habilesHastaHoy)} días hábiles transcurridos`, { icono: "i-calendario" })}
      ${cifraTarjeta("Racha", numero(racha), racha === 1 ? "día hábil seguido con actividad" : "días hábiles seguidos con actividad", { icono: "i-fuego", tono: racha >= 3 ? "acento" : "" })}
    </div>

    <section class="tarjeta-n">
      <header class="tarjeta-cab"><h2>Ritmo diario</h2>
        <span class="bajada">${
          interactivo && info.enCurso
            ? `Hoy: ${numero(k.llamadasHoy)} llamadas y ${numero(k.gestionesHoy)} gestiones${comparacion === null ? "" : ` · <b class="${comparacion >= 0 ? "positivo" : "texto-alerta"}">${comparacion >= 0 ? "+" : ""}${comparacion} %</b> frente a tu promedio`}`
            : mejorDia && mejorDia.llamadas + mejorDia.gestiones > 0
              ? `Mejor día: ${fechaCalendario(mejorDia.fecha)} (${mejorDia.llamadas} llamadas, ${mejorDia.gestiones} gestiones)`
              : ""
        }</span></header>
      ${graficoRitmo(d.actividad)}
    </section>

    <div class="rejilla-n r-3">
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Cómo terminaron las llamadas</h2></header>
        ${
          l && totalMotivos
            ? `<div class="dona-bloque">${dona(
                conMotivo.map((m) => ({ valor: l.porMotivo[m] ?? 0, color: MOTIVOS[m].color, etiqueta: MOTIVOS[m].nombre })),
                numero(totalMotivos),
                "intentos"
              )}
              <ul class="leyenda-lista">${conMotivo
                .map((m) => `<li style="--c:${MOTIVOS[m].color}"><i></i><span>${esc(MOTIVOS[m].nombre)}</span><b>${numero(l.porMotivo[m])}</b><small>${porcentaje(Math.round(((l.porMotivo[m] ?? 0) / totalMotivos) * 1000) / 10)}</small></li>`)
                .join("")}</ul></div>
              ${l.sinConfirmar && interactivo ? `<p class="pie-tarjeta">${numero(l.sinConfirmar)} ${l.sinConfirmar === 1 ? "llamada quedó" : "llamadas quedaron"} sin confirmar <button class="enlace-n" data-ir="telefono">Revisar</button></p>` : ""}`
            : `<p class="sin-datos">Cuando llames desde la cola o la ficha, aquí verás cuántos contestaron y por qué no.</p>`
        }
      </section>
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Por día de la semana</h2><span class="bajada">llamadas y gestiones del mes</span></header>
        ${barrasSemana(d.actividad)}
        <p class="leyenda-n"><span class="l-llamadas"></span>Llamadas <span class="l-gestiones"></span>Gestiones</p>
      </section>
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Horario de llamadas</h2><span class="bajada" id="hora-llamadas-nota">${interactivo ? "tus últimas llamadas" : ""}</span></header>
        <div id="hora-llamadas">${interactivo ? `<p class="cargando-n">Cargando…</p>` : `<p class="sin-datos">Disponible en el mes en vivo.</p>`}</div>
      </section>
    </div>`;
}

function tarjetaMeta(titulo: string, icono: string, valor: number, meta: number, formato: (n: number) => string, fraccion: number, nota: string): string {
  const pct = meta > 0 ? Math.min(100, (valor / meta) * 100) : 0;
  const r = estadoRitmo(valor, meta, fraccion);
  return `<article class="meta-tarjeta">
      <header><span class="kpi-icono"><svg aria-hidden="true"><use href="#${icono}"/></svg></span><h3>${esc(titulo)}</h3><span class="chip-ritmo ${r.clase}">${r.texto}</span></header>
      <p class="mt-valor"><b class="cifra-anim">${formato(valor)}</b>${meta > 0 ? `<span>de ${formato(meta)}</span>` : ""}</p>
      <div class="mt-pista" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${esc(titulo)}">
        <span class="mt-relleno" style="--p:${pct}%"></span>${meta > 0 && fraccion < 1 ? `<i class="mt-esperado" style="left:${fraccion * 100}%" title="Lo esperado a la fecha"></i>` : ""}
      </div>
      <p class="mt-nota">${meta > 0 ? nota : `<button class="enlace-n" data-editar-metas>Definir meta</button>`}</p>
    </article>`;
}

function panelMetas(d: Phoenix.Dashboard, interactivo: boolean): string {
  const k = d.kpis;
  const info = infoMes(d.periodo);
  const fraccion = info.enCurso ? info.diaActual / info.diasMes : 1;
  const proyeccion = info.enCurso ? (k.recuperado / Math.max(1, info.diaActual)) * info.diasMes : k.recuperado;
  const faltan = Math.max(0, k.metaMensual - k.recuperado);
  const porDia = info.habilesRestantes ? faltan / info.habilesRestantes : faltan;
  const r = estadoRitmo(k.recuperado, k.metaMensual, fraccion);
  const m = metasPersonales();
  const gestionesMes = d.actividad.reduce((s, a) => s + a.gestiones, 0);
  const pctProy = k.metaMensual > 0 ? Math.round((proyeccion / k.metaMensual) * 100) : null;

  return `
    <div class="rejilla-n r-2-1">
      <section class="tarjeta-n meta-heroe">
        <header class="tarjeta-cab"><h2>Meta de recuperación</h2>${k.metaMensual > 0 ? `<span class="chip-ritmo ${r.clase}">${r.texto}</span>` : ""}</header>
        ${
          k.metaMensual > 0
            ? `<div class="mh-cuerpo">
                ${anilloAvance(k.pctMeta, { centro: porcentaje(k.pctMeta), sub: "cumplido", tamano: 196, grosor: 16, clase: "grande" })}
                <dl class="mh-cifras">
                  <div><dt>Recuperado</dt><dd class="cifra-anim">${pesos(k.recuperado)}</dd></div>
                  <div><dt>Meta del mes</dt><dd>${pesos(k.metaMensual)}</dd></div>
                  <div><dt>${faltan ? "Faltan" : "Superada por"}</dt><dd>${pesos(faltan || k.recuperado - k.metaMensual)}</dd></div>
                  <div><dt>Proyección al cierre</dt><dd>${pesosCorto(proyeccion)}</dd><small>${pctProy === null ? "" : `${numero(pctProy)} % de la meta al ritmo actual`}</small></div>
                  ${info.enCurso && faltan ? `<div class="destacada"><dt>Necesitas por día hábil</dt><dd>${pesosCorto(porDia)}</dd><small>${numero(info.habilesRestantes)} ${info.habilesRestantes === 1 ? "día hábil queda" : "días hábiles quedan"}</small></div>` : ""}
                </dl>
              </div>
              <div class="mh-linea" aria-hidden="true"><span style="--p:${Math.min(100, k.pctMeta ?? 0)}%"></span><i style="left:${fraccion * 100}%"></i></div>
              <p class="leyenda-n"><span class="l-avance"></span>Avance <span class="l-hoy"></span>Día ${numero(info.diaActual)} de ${numero(info.diasMes)}</p>`
            : metaRapida(d, interactivo, proyeccion, info)
        }
      </section>
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Calendario del mes</h2><span class="bajada">gestiones y llamadas por día</span></header>
        ${calendarioMes(d.actividad, d.periodo)}
      </section>
    </div>

    <section class="tarjeta-n">
      <header class="tarjeta-cab"><h2>Metas personales</h2>${interactivo ? `<button class="btn-n secundario pequeño" data-editar-metas><svg aria-hidden="true"><use href="#i-lapiz"/></svg>Editar metas</button>` : ""}</header>
      <div class="metas-rejilla">
        ${tarjetaMeta("Llamadas", "i-cola", k.llamadasPeriodo, m.llamadas, (n) => numero(Math.round(n)), fraccion,
          m.llamadas > k.llamadasPeriodo && info.habilesRestantes ? `${numero(Math.ceil((m.llamadas - k.llamadasPeriodo) / info.habilesRestantes))} por día hábil para cumplir` : "Meta cubierta")}
        ${tarjetaMeta("Gestiones", "i-lapiz", gestionesMes, m.gestiones, (n) => numero(Math.round(n)), fraccion,
          m.gestiones > gestionesMes && info.habilesRestantes ? `${numero(Math.ceil((m.gestiones - gestionesMes) / info.habilesRestantes))} por día hábil para cumplir` : "Meta cubierta")}
        ${tarjetaMeta("Contactabilidad", "i-check", k.pctContactabilidad ?? 0, m.contacto, (n) => `${numero(n, 1)} %`, 1,
          `${numero(k.contactadasPeriodo)} contestadas de ${numero(k.llamadasPeriodo)} llamadas`)}
        ${tarjetaMeta("Cartera gestionada", "i-cartera", k.pctGestionados, m.cobertura, (n) => `${numero(n, 1)} %`, fraccion,
          `${numero(k.gestionados)} de ${numero(k.clientes)} clientes con gestión`)}
      </div>
      ${interactivo ? "" : `<p class="bajada">Las metas personales se comparan con la actividad que guardó el reporte.</p>`}
    </section>`;
}

/** Sin meta: lo que ya se sabe del mes y un formulario para definirla aquí mismo. */
function metaRapida(d: Phoenix.Dashboard, interactivo: boolean, proyeccion: number, info: InfoMes): string {
  const k = d.kpis;
  const porDia = k.recuperado / Math.max(1, info.habilesHastaHoy);
  const redondear = (n: number) => Math.max(100_000, Math.round(n / 100_000) * 100_000);
  const sugerencias = [5, 10, 15].map((p) => ({ p, monto: redondear((k.deudaTotal * p) / 100) }));
  return `<p class="bajada">Define cuánto quieres recuperar en ${esc(d.periodo.nombre)} para ver el avance, la proyección y lo que necesitas por día hábil.</p>
    <dl class="mh-cifras sin-meta">
      <div><dt>Recuperado</dt><dd class="cifra-anim">${pesos(k.recuperado)}</dd><small>${porcentaje(k.pctRecuperado)} de la deuda</small></div>
      <div><dt>Proyección al cierre</dt><dd>${pesosCorto(proyeccion)}</dd><small>al ritmo actual</small></div>
      <div><dt>Por día hábil</dt><dd>${pesosCorto(porDia)}</dd><small>promedio del mes</small></div>
    </dl>
    ${
      interactivo
        ? `<form class="meta-rapida" data-meta-rapida>
            <label class="campo"><span>Meta de recuperación del mes</span><input name="meta" inputmode="numeric" autocomplete="off" placeholder="$ 0" required></label>
            <button class="btn-n primario" type="submit"><svg aria-hidden="true"><use href="#i-meta"/></svg>Guardar meta</button>
            <div class="chips sugerencias" aria-label="Sugerencias">${sugerencias
              .map((s) => `<button type="button" class="chip" data-meta-sugerida="${s.monto}">${s.p} % de la cartera · ${pesosCorto(s.monto)}</button>`)
              .join("")}</div>
          </form>`
        : ""
    }`;
}

function panelCategorias(d: Phoenix.Dashboard, interactivo: boolean): string {
  const k = d.kpis;
  const total = k.deudaTotal || 1;
  const ordenados = [...d.porEstado].sort((a, b) => b.deuda - a.deuda);
  const conClientes = new Set(ordenados.map((s) => s.estado));
  const sinClientes = App.estados.filter((e) => !conClientes.has(e.codigo));
  const abiertos = d.porEstado.filter((s) => App.porCodigo.get(s.estado)?.grupo !== "cerrado").reduce((s, x) => s + x.clientes, 0);
  return `
    <section class="tarjeta-n d-distribucion">
      <header class="tarjeta-cab"><h2>Dónde está la deuda</h2>${interactivo ? `<span class="bajada">clic en un estado para ver sus clientes</span>` : ""}</header>
      ${franjaCartera(d.porEstado, k.deudaTotal)}
    </section>

    <div class="categorias-rejilla">
      ${ordenados
        .map((s) => {
          const e = App.porCodigo.get(s.estado);
          const pct = (s.deuda / total) * 100;
          return `<button class="cat-tarjeta tono-${esc(e?.tono ?? "gris")}" data-estado="${s.estado}" ${interactivo ? "" : "disabled"} title="${esc(e?.descripcion ?? "")}">
            <span class="cat-placa"><b class="cifra-anim">${numero(s.clientes)}</b><small>${s.clientes === 1 ? "cliente" : "clientes"}</small></span>
            <span class="cat-nombre">${esc(nombreEstado(s.estado))}</span>
            <span class="cat-cifras"><b>${pesosCorto(s.deuda)}</b><span class="cat-pct">${numero(pct, pct < 10 ? 1 : 0)} %</span></span>
            <span class="cat-barra"><i style="--p:${Math.max(1.5, pct)}%"></i></span>
          </button>`;
        })
        .join("")}
    </div>
    ${sinClientes.length ? `<p class="bajada sin-estado">Sin clientes en: ${sinClientes.map((e) => esc(e.nombre)).join(", ")}.</p>` : ""}

    <div class="rejilla-n r-3">
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Deuda por tramo de mora</h2></header>
        ${barrasHorizontales(
          d.porTramo.map((t) => ({ etiqueta: t.tramo, valor: t.deuda, texto: pesosCorto(t.deuda), secundario: `${t.clientes} clientes`, clase: "mora", dato: interactivo ? JSON.stringify({ tramo: t.tramo }) : undefined }))
        )}
      </section>
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Clientes por rango de deuda</h2></header>
        ${barrasHorizontales(
          d.porRango.map((r) => ({ etiqueta: r.rango, valor: r.clientes, texto: `${numero(r.clientes)} clientes`, secundario: pesosCorto(r.deuda), dato: interactivo ? JSON.stringify({ deudaMin: r.desde, deudaMax: r.hasta === null ? null : r.hasta - 1 }) : undefined }))
        )}
      </section>
      <section class="tarjeta-n">
        <header class="tarjeta-cab"><h2>Composición</h2></header>
        <div class="dona-bloque vertical">${dona(
          [
            { valor: abiertos, color: "var(--acento)", etiqueta: "Casos abiertos" },
            { valor: Math.max(0, k.clientes - abiertos), color: "var(--positivo)", etiqueta: "Casos cerrados" },
          ],
          numero(k.clientes),
          "clientes",
          150
        )}
          <ul class="leyenda-lista">
            <li style="--c:var(--acento)"><i></i><span>Casos abiertos</span><b>${numero(abiertos)}</b></li>
            <li style="--c:var(--positivo)"><i></i><span>Cerrados (pagado, no contactar)</span><b>${numero(Math.max(0, k.clientes - abiertos))}</b></li>
            <li style="--c:var(--aviso)"><i></i><span>Prioridad alta</span><b>${numero(k.prioridadAlta)}</b></li>
          </ul>
          ${interactivo ? `<button class="enlace-n" data-filtro='${JSON.stringify({ prioridad: "alta" })}'>Ver clientes de prioridad alta</button>` : ""}
        </div>
      </section>
    </div>`;
}

/**
 * Pinta un tablero en el contenedor.
 * @param interactivo `true` en el Inicio en vivo (clics filtran y abren fichas).
 */
function pintarDashboard(cont: HTMLElement, d: Phoenix.Dashboard, interactivo: boolean): void {
  const activa = pestanaGuardada();
  const cuentas: Record<PestanaTablero, string> = {
    resumen: d.alertas.length ? String(d.alertas.length) : "",
    actividad: d.kpis.llamadasPeriodo ? numero(d.kpis.llamadasPeriodo) : "",
    metas: d.kpis.pctMeta === null ? "" : `${numero(Math.round(d.kpis.pctMeta))} %`,
    categorias: String(d.porEstado.length),
  };
  cont.innerHTML = `<div class="tablero primera" data-interactivo="${interactivo}">
      <div class="tabs-tablero" role="tablist" aria-label="Secciones del tablero">
        <span class="tabs-indicador" aria-hidden="true"></span>
        ${PESTANAS.map(
          (p) => `<button role="tab" id="tab-${p.id}-${interactivo ? "v" : "r"}" data-tab="${p.id}" aria-selected="${p.id === activa}" tabindex="${p.id === activa ? 0 : -1}">
            <svg aria-hidden="true"><use href="#${p.icono}"/></svg>${p.nombre}${cuentas[p.id] ? `<small>${cuentas[p.id]}</small>` : ""}</button>`
        ).join("")}
      </div>
      <div class="panel-tab" data-panel="resumen" role="tabpanel" ${activa === "resumen" ? "" : "hidden"}>${panelResumen(d, interactivo)}</div>
      <div class="panel-tab" data-panel="actividad" role="tabpanel" ${activa === "actividad" ? "" : "hidden"}>${panelActividad(d, interactivo)}</div>
      <div class="panel-tab" data-panel="metas" role="tabpanel" ${activa === "metas" ? "" : "hidden"}>${panelMetas(d, interactivo)}</div>
      <div class="panel-tab" data-panel="categorias" role="tabpanel" ${activa === "categorias" ? "" : "hidden"}>${panelCategorias(d, interactivo)}</div>
    </div>`;
  requestAnimationFrame(() => {
    moverIndicadorTabs(cont.querySelector<HTMLElement>(".tabs-tablero"));
    animarCifras(cont);
  });
  // Pasado el primer momento, cambiar de pestaña muestra los gráficos ya armados.
  const tablero = cont.querySelector<HTMLElement>(".tablero");
  window.setTimeout(() => tablero?.classList.remove("primera"), 1200);
  if (interactivo) {
    void Api.llamadas()
      .then((ls) => {
        const caja = document.getElementById("hora-llamadas");
        if (!caja) return;
        caja.innerHTML = ls.length ? barrasHora(ls) : `<p class="sin-datos">Aún no hay llamadas registradas.</p>`;
        const nota = document.getElementById("hora-llamadas-nota");
        if (nota && ls.length) nota.textContent = `tus últimas ${numero(ls.length)} llamadas`;
      })
      .catch(() => undefined);
  }
}

function moverIndicadorTabs(tabs: HTMLElement | null): void {
  if (!tabs) return;
  const activo = tabs.querySelector<HTMLElement>("[aria-selected=true]");
  const ind = tabs.querySelector<HTMLElement>(".tabs-indicador");
  if (!activo || !ind) return;
  ind.style.width = `${activo.offsetWidth}px`;
  ind.style.transform = `translateX(${activo.offsetLeft}px)`;
}

function elegirPestana(tablero: HTMLElement, id: PestanaTablero, foco = false): void {
  guardarLocal("nova-pestana", id);
  tablero.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
    const activa = b.dataset.tab === id;
    b.setAttribute("aria-selected", String(activa));
    b.tabIndex = activa ? 0 : -1;
    if (activa && foco) b.focus();
  });
  tablero.querySelectorAll<HTMLElement>(".panel-tab").forEach((p) => {
    const visible = p.dataset.panel === id;
    p.hidden = !visible;
    if (visible) {
      p.classList.remove("entrando");
      void p.offsetWidth;
      p.classList.add("entrando");
    }
  });
  moverIndicadorTabs(tablero.querySelector(".tabs-tablero"));
  if (tablero.closest("#dashboard-contenido")) $("miga-extra").textContent = ` › ${PESTANAS.find((p) => p.id === id)?.nombre ?? ""}`;
}

/** "1 h 12 min", "24 min", "40 s". */
function duracionLarga(s: number): string {
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Carga el tablero del mes activo. */
async function cargarDashboard(): Promise<void> {
  const cont = $("dashboard-contenido");
  try {
    const d = await Api.dashboard();
    ultimoDashboard = d;
    const vacio = d.kpis.clientes === 0;
    $("dashboard-vacio").hidden = !vacio;
    cont.hidden = vacio;
    const hora = new Date().getHours();
    const saludo = hora < 12 ? "Buenos días" : hora < 20 ? "Buenas tardes" : "Buenas noches";
    $("dashboard-titulo").textContent = d.periodo.esActual ? `${saludo}, ${App.contexto?.usuario.nombre ?? ""}`.trim() : `Cartera de ${d.periodo.nombre}`;
    $("dashboard-bajada").textContent = d.periodo.esActual
      ? `${d.periodo.nombre} · actualizado a las ${new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`
      : "Mes cerrado: estás viendo cómo quedó la cartera de ese mes.";
    if (!vacio) {
      pintarDashboard(cont, d, true);
      $("miga-extra").textContent = ` › ${PESTANAS.find((p) => p.id === pestanaGuardada())?.nombre ?? ""}`;
    }
    actualizarInsigniaAlertas(d.alertas.length);
    void cargarRecordatorios();
  } catch (e) {
    aviso(`No se pudo cargar el inicio: ${(e as Error).message}`, "error");
  }
}

function actualizarInsigniaAlertas(n: number): void {
  const b = $("insignia-alertas");
  b.textContent = String(n);
  b.hidden = n === 0;
}

function prepararDashboard(): void {
  $("btn-dashboard-actualizar").addEventListener("click", () => void cargarDashboard());
  $("btn-dashboard-reporte").addEventListener("click", () => abrirDialogoReporte());

  // Pestañas (Inicio en vivo y reportes guardados).
  document.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const tab = t.closest<HTMLElement>(".tabs-tablero [data-tab]");
    const ir = t.closest<HTMLElement>("[data-tab-ir]");
    const tablero = (tab ?? ir)?.closest<HTMLElement>(".tablero");
    if (tablero) elegirPestana(tablero, ((tab?.dataset.tab ?? ir?.dataset.tabIr) as PestanaTablero) || "resumen");
  });
  document.addEventListener("keydown", (ev) => {
    const tab = (ev.target as HTMLElement).closest<HTMLElement>(".tabs-tablero [data-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    const i = PESTANAS.findIndex((p) => p.id === tab.dataset.tab);
    const n = ev.key === "Home" ? 0 : ev.key === "End" ? PESTANAS.length - 1 : (i + (ev.key === "ArrowRight" ? 1 : -1) + PESTANAS.length) % PESTANAS.length;
    elegirPestana(tab.closest<HTMLElement>(".tablero")!, PESTANAS[n].id, true);
  });
  window.addEventListener("resize", debounce(() => document.querySelectorAll<HTMLElement>(".tabs-tablero").forEach(moverIndicadorTabs), 120));

  // Clics del Inicio en vivo: estado → Cartera filtrada; cliente → ficha.
  const cont = $("dashboard-contenido");
  const activar = (t: HTMLElement) => {
    if (t.closest("[data-abrir-recordatorios]")) return void abrirRecordatorios();
    if (t.closest("[data-editar-metas]")) return abrirDialogoMetas();
    const estado = t.closest<HTMLElement>("[data-estado]")?.dataset.estado;
    if (estado) return irAClientes({ estados: [estado as Phoenix.CodigoEstado] });
    const filtro = t.closest<HTMLElement>("[data-filtro]")?.dataset.filtro;
    if (filtro) return irAClientes(JSON.parse(filtro));
    const cliente = t.closest<HTMLElement>("[data-cliente]")?.dataset.cliente;
    if (cliente) void abrirFicha(cliente);
  };
  cont.addEventListener("click", (ev) => activar(ev.target as HTMLElement));
  cont.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && (ev.target as HTMLElement).matches("li[tabindex]")) {
      ev.preventDefault();
      activar(ev.target as HTMLElement);
    }
  });

  // Meta de recuperación definida desde el tablero (mismo ajuste que en Ajustes).
  cont.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-meta-sugerida]");
    const entrada = b?.closest("form")?.querySelector<HTMLInputElement>("input[name=meta]");
    if (b && entrada) {
      entrada.value = numero(Number(b.dataset.metaSugerida));
      entrada.focus();
    }
  });
  cont.addEventListener("submit", async (ev) => {
    const form = (ev.target as HTMLElement).closest<HTMLFormElement>("form[data-meta-rapida]");
    if (!form) return;
    ev.preventDefault();
    const monto = leerMonto((form.elements.namedItem("meta") as HTMLInputElement).value);
    if (!monto || monto <= 0) return aviso("Escribe la meta como 25.000.000 o 25 millones.", "error");
    const c = await intentar(() => Api.guardarConfig({ metaMensual: monto }), form.querySelector<HTMLButtonElement>("button[type=submit]"));
    if (!c) return;
    App.config = c;
    aviso(`Meta de recuperación: ${pesos(monto)}.`, "ok");
    await cargarDashboard();
  });

  // Metas personales.
  $("metas-cancelar").addEventListener("click", () => ($("dialogo-metas") as HTMLDialogElement).close());
  $("form-metas").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const leer = (id: string, max: number) => Math.max(0, Math.min(max, Math.round(Number($input(id).value) || 0)));
    const m: MetasPersonales = {
      llamadas: leer("meta-llamadas", 20000),
      gestiones: leer("meta-gestiones", 50000),
      contacto: leer("meta-contacto", 100),
      cobertura: leer("meta-cobertura", 100),
    };
    guardarLocal(claveMetas(), JSON.stringify(m));
    ($("dialogo-metas") as HTMLDialogElement).close();
    aviso("Metas personales guardadas.", "ok");
    if (vistaActual === "dashboard" && ultimoDashboard) pintarDashboard(cont, ultimoDashboard, true);
  });
}
