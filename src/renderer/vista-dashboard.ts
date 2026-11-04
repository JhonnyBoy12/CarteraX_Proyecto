/**
 * @file vista-dashboard.ts
 * @description Dashboard del mes (RF-22, RF-24, RF-26). `pintarDashboard`
 * también se usa en Reportes para mostrar un mes guardado.
 */

const ICONOS_ALERTA: Record<Phoenix.TipoAlerta, string> = {
  compromiso_vencido: "Compromiso vencido",
  compromiso_hoy: "Compromiso hoy",
  alta_sin_gestion: "Sin gestión",
  estado_alerta: "En alerta",
  proxima_gestion: "Gestión agendada",
};

/**
 * Pinta un dashboard en el contenedor.
 * @param interactivo `true` en el Dashboard en vivo (clics filtran clientes).
 */
function pintarDashboard(cont: HTMLElement, d: Phoenix.Dashboard, interactivo: boolean): void {
  const k = d.kpis;
  const filaCliente = (c: Phoenix.ClienteFila, derecha: string) => `
    <li ${interactivo ? `data-cliente="${esc(c.id)}" class="clicable"` : ""}>
      <span class="lc-nombre">${esc(c.nombre)}<small><span class="sin-corte">${esc(rutCompleto(c.rut, c.dv))}</span>${etiquetaEstado(c.estado)}</small></span>
      <span class="lc-derecha">${derecha}</span>
    </li>`;

  const dato = (titulo: string, valor: string, nota: string, clase = "") =>
    `<div class="${clase}"><dt>${esc(titulo)}</dt><dd>${valor}</dd><p>${nota}</p></div>`;

  // Bloques que cambian de fila según haya agenda (dashboard en vivo) o llamadas.
  const conAgenda = interactivo && !!d.agenda;
  const mayores = `<section class="bloque">
      <header class="bloque-cab"><h2>Mayores deudas</h2></header>
      <ul class="lista-clientes">${d.topDeuda.slice(0, 8).map((c) => filaCliente(c, pesos(c.deuda))).join("") || '<li class="sin-datos">Sin clientes.</li>'}</ul>
    </section>`;
  const tramo = `<section class="bloque">
      <header class="bloque-cab"><h2>Deuda por tramo de mora</h2></header>
      ${barrasHorizontales(
        d.porTramo.map((t) => ({
          etiqueta: t.tramo,
          valor: t.deuda,
          texto: pesosCorto(t.deuda),
          secundario: `${t.clientes} clientes`,
          clase: "mora",
          dato: interactivo ? JSON.stringify({ tramo: t.tramo }) : undefined,
        }))
      )}
    </section>`;
  const rango = `<section class="bloque">
      <header class="bloque-cab"><h2>Clientes por rango de deuda</h2></header>
      ${barrasHorizontales(
        d.porRango.map((r) => ({
          etiqueta: r.rango,
          valor: r.clientes,
          texto: `${numero(r.clientes)} clientes`,
          secundario: pesosCorto(r.deuda),
          dato: interactivo ? JSON.stringify({ deudaMin: r.desde, deudaMax: r.hasta === null ? null : r.hasta - 1 }) : undefined,
        }))
      )}
    </section>`;

  cont.innerHTML = `
    <section class="d-cartera">
      <div class="d-libro">
        <dl class="d-total"><dt>Deuda de la cartera</dt><dd title="${pesos(k.deudaTotal)}">${pesosCorto(k.deudaTotal)}</dd>
          <p>${numero(k.clientes)} clientes en ${esc(d.periodo.nombre)}</p></dl>
        <dl class="d-par">
          <div><dt>Recuperado</dt><dd class="positivo" title="${pesos(k.recuperado)}">${pesosCorto(k.recuperado)}</dd>
            <small>${porcentaje(k.pctRecuperado)} de la deuda</small></div>
          <div><dt>Por cobrar</dt><dd title="${pesos(k.deudaPendiente)}">${pesosCorto(k.deudaPendiente)}</dd>
            <small>en casos abiertos</small></div>
        </dl>
        ${medidorMeta(k)}
      </div>
      <div class="d-distribucion">
        <h2 class="d-subtitulo">Dónde está la deuda del mes${interactivo ? `<small>clic en un estado para ver sus clientes</small>` : ""}</h2>
        ${franjaCartera(d.porEstado, k.deudaTotal)}
      </div>
    </section>

    <dl class="d-indicadores">
      ${dato("Compromisos vigentes", numero(k.compromisosVigentes), `${pesosCorto(k.montoCompromisos)} comprometidos`)}
      ${dato("Compromisos vencidos", numero(k.compromisosVencidos), k.compromisosVencidos ? "requieren seguimiento" : "al día", k.compromisosVencidos ? "alerta" : "")}
      ${dato("Clientes gestionados", porcentaje(k.pctGestionados), `${numero(k.gestionados)} de ${numero(k.clientes)}`)}
      ${dato("Contactabilidad", porcentaje(k.pctContactabilidad), k.llamadasPeriodo ? `${numero(k.contactadasPeriodo)} contestadas de ${numero(k.llamadasPeriodo)} llamadas` : "aún sin llamadas este mes")}
      ${dato("En cola de llamadas", numero(k.enCola), interactivo ? `<button class="btn texto" data-ir="cola">Abrir cola</button>` : "clientes")}
      ${dato("Mora promedio", k.moraPromedio === null ? "—" : `${numero(k.moraPromedio)} días`, `${numero(k.prioridadAlta)} con prioridad alta`)}
    </dl>

    <div class="d-rejilla tres">
      <section class="bloque">
        <header class="bloque-cab"><h2>Alertas</h2><span class="contador ${d.alertas.length ? "activo" : ""}">${d.alertas.length}</span></header>
        ${
          d.alertas.length
            ? `<ul class="lista-alertas">${d.alertas
                .slice(0, 12)
                .map(
                  (a) => `<li class="nivel-${a.nivel} ${interactivo ? "clicable" : ""}" ${interactivo ? `data-cliente="${esc(a.clienteId)}"` : ""}>
                    <span class="la-tipo">${esc(ICONOS_ALERTA[a.tipo])}</span>
                    <span class="la-nombre">${esc(a.nombre)}</span>
                    <span class="la-detalle">${esc(a.detalle)}</span></li>`
                )
                .join("")}</ul>${d.alertas.length > 12 ? `<p class="bajada mas">y ${d.alertas.length - 12} alertas más</p>` : ""}`
            : `<p class="sin-datos">Nada pendiente. Las alertas aparecen cuando un compromiso vence o un cliente prioritario lleva días sin gestión.</p>`
        }
      </section>
      ${conAgenda ? bloqueAgenda(d.agenda!) : mayores}
      <section class="bloque">
        <header class="bloque-cab"><h2>Próximos compromisos</h2></header>
        ${
          d.proximosCompromisos.length
            ? `<ul class="lista-clientes">${d.proximosCompromisos
                .map((c) =>
                  filaCliente(
                    c,
                    `<span class="${c.compromisoVencido ? "texto-alerta" : ""}">${fechaCalendario(c.fechaCompromiso)}</span><small>${
                      c.montoCompromiso ? pesos(c.montoCompromiso) : ""
                    }</small>`
                  )
                )
                .join("")}</ul>`
            : `<p class="sin-datos">Sin compromisos de pago registrados este mes.</p>`
        }
      </section>
    </div>

    <div class="d-rejilla">
      <section class="bloque">
        <header class="bloque-cab"><h2>Actividad del mes</h2>${interactivo && d.periodo.esActual ? `<span class="bajada">${numero(k.gestionesHoy)} gestiones y ${numero(k.llamadasHoy)} llamadas hoy</span>` : ""}</header>
        ${graficoActividad(d.actividad)}
      </section>
      ${d.llamadas ? bloqueLlamadas(d.llamadas, interactivo) : tramo}
    </div>

    <div class="d-rejilla ${["", "uno", "par", "tres"][1 + (d.llamadas ? 1 : 0) + (conAgenda ? 1 : 0)]}">
      ${d.llamadas ? tramo : ""}
      ${rango}
      ${conAgenda ? mayores : ""}
    </div>`;
}

/** "1 h 12 min", "24 min", "40 s". */
function duracionLarga(s: number): string {
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Agenda de seguimiento: recordatorios atrasados, de hoy y próximos. */
function bloqueAgenda(a: Phoenix.AgendaSeguimiento): string {
  const ahora = fechaHoraLocalTexto();
  const cifra = (t: string, n: number, clase = "") => `<div class="${clase}" ${n === 0 ? "data-cero" : ""}><dt>${t}</dt><dd>${numero(n)}</dd></div>`;
  return `<section class="bloque">
      <header class="bloque-cab"><h2>Agenda de seguimiento</h2><span class="bajada">recordatorios de vuelta de gestión</span></header>
      <dl class="cifras-linea">
        ${cifra("Atrasados", a.atrasados, a.atrasados ? "alerta" : "")}${cifra("Para hoy", a.hoy)}${cifra("Próximos", a.proximos)}
      </dl>
      ${
        a.lista.length
          ? `<ul class="agenda-lista">${a.lista
              .slice(0, 5)
              .map((r) => {
                const c = cuandoRecordatorio(r.fechaHora);
                return `<li data-cliente="${esc(r.clienteId)}">
                  <span class="ag-hora ${r.fechaHora < ahora ? "atrasado" : ""}">${esc(c.dia)} ${esc(c.hora)}</span>
                  <span class="ag-texto"><b>${esc(r.nombre)}</b><span>${esc(r.motivo)}</span></span>
                  ${etiquetaEstado(r.estadoActual)}</li>`;
              })
              .join("")}</ul>`
          : `<p class="sin-datos">Sin recordatorios pendientes. Se agendan solos al registrar «No contesta», «Notificado» o un compromiso.</p>`
      }
      <div class="pie-bloque"><span>${numero(a.atrasados + a.hoy + a.proximos)} pendientes</span><button class="btn texto" data-abrir-recordatorios>Ver todos</button></div>
    </section>`;
}

/** Resultado de las llamadas del mes y minutos hablados. */
function bloqueLlamadas(l: Phoenix.ResumenLlamadas, interactivo: boolean): string {
  const orden = Object.keys(MOTIVOS) as Phoenix.MotivoLlamada[];
  const conMotivo = orden.filter((m) => (l.porMotivo[m] ?? 0) > 0);
  const totalMotivos = conMotivo.reduce((s, m) => s + (l.porMotivo[m] ?? 0), 0);
  const terminadas = totalMotivos || 1;
  return `<section class="bloque">
      <header class="bloque-cab"><h2>Llamadas del mes</h2><span class="bajada">cómo terminó cada intento</span></header>
      <dl class="cifras-linea">
        <div ${l.total === 0 ? "data-cero" : ""}><dt>Llamadas</dt><dd>${numero(l.total)}</dd></div>
        <div ${l.contestadas === 0 ? "data-cero" : ""}><dt>Contestadas</dt><dd>${numero(l.contestadas)}<small>${totalMotivos ? porcentaje(Math.round((l.contestadas / terminadas) * 1000) / 10) : ""}</small></dd></div>
        <div ${l.segundosHablados === 0 ? "data-cero" : ""}><dt>Tiempo hablado</dt><dd>${duracionLarga(l.segundosHablados)}</dd></div>
        <div ${l.duracionPromedio === null ? "data-cero" : ""}><dt>Promedio por llamada</dt><dd>${l.duracionPromedio === null ? "—" : segundos(l.duracionPromedio)}</dd></div>
      </dl>
      ${
        totalMotivos
          ? `<div class="barra-motivos" role="img" aria-label="Distribución de resultados">${conMotivo
              .map((m) => `<span style="--c:${MOTIVOS[m].color};flex:${l.porMotivo[m]}" title="${esc(MOTIVOS[m].nombre)}: ${l.porMotivo[m]}"></span>`)
              .join("")}</div>
            <ul class="leyenda-motivos">${conMotivo
              .map((m) => `<li style="--c:${MOTIVOS[m].color}"><i></i>${esc(MOTIVOS[m].nombre)}<b>${numero(l.porMotivo[m])}</b><small>${porcentaje(Math.round(((l.porMotivo[m] ?? 0) / terminadas) * 1000) / 10)}</small></li>`)
              .join("")}</ul>`
          : `<p class="sin-datos">Cuando llames desde la cola o la ficha, aquí verás cuántos contestaron y cuánto hablaste.</p>`
      }
      ${
        l.sinConfirmar && interactivo
          ? `<div class="pie-bloque"><span>${numero(l.sinConfirmar)} ${l.sinConfirmar === 1 ? "llamada quedó" : "llamadas quedaron"} sin confirmar</span><button class="btn texto" data-ir="telefono">Revisar</button></div>`
          : ""
      }
    </section>`;
}

/** Carga el dashboard del mes activo. */
async function cargarDashboard(): Promise<void> {
  const cont = $("dashboard-contenido");
  try {
    const d = await Api.dashboard();
    const vacio = d.kpis.clientes === 0;
    $("dashboard-vacio").hidden = !vacio;
    cont.hidden = vacio;
    $("dashboard-titulo").textContent = `Dashboard de ${d.periodo.nombre}`;
    $("dashboard-bajada").textContent = d.periodo.esActual
      ? `Actualizado a las ${new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`
      : "Mes cerrado: estás viendo cómo quedó la cartera de ese mes.";
    if (!vacio) pintarDashboard(cont, d, true);
    actualizarInsigniaAlertas(d.alertas.length);
    void cargarRecordatorios();
  } catch (e) {
    aviso(`No se pudo cargar el dashboard: ${(e as Error).message}`, "error");
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

  // Clics dentro del dashboard en vivo: estado → Clientes filtrado; cliente → ficha.
  $("dashboard-contenido").addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest("[data-abrir-recordatorios]")) return void abrirRecordatorios();
    const estado = t.closest<HTMLElement>("[data-estado]")?.dataset.estado;
    if (estado) return irAClientes({ estados: [estado as Phoenix.CodigoEstado] });
    const filtro = t.closest<HTMLElement>("[data-filtro]")?.dataset.filtro;
    if (filtro) return irAClientes(JSON.parse(filtro));
    const cliente = t.closest<HTMLElement>("[data-cliente]")?.dataset.cliente;
    if (cliente) abrirFicha(cliente);
  });
}
