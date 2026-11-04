/**
 * @file vista-recordatorios.ts
 * @description Recordatorios de vuelta de gestión (v0.3.1).
 *
 * - Botón en la barra superior con la cantidad de pendientes; se pinta en
 *   naranja cuando hay alguno vencido.
 * - Panel lateral con los atrasados, los de hoy y los próximos: abrir la
 *   ficha, posponer o marcar como hecho.
 * - Cada minuto se consultan los recordatorios que vencieron: cada uno se
 *   avisa UNA vez con una notificación de escritorio y un aviso en la app.
 */

let listaRecordatorios: Phoenix.Recordatorio[] = [];
let temporizadorRecordatorios: number | null = null;

const OPCIONES_POSPONER: Array<{ valor: string; texto: string }> = [
  { valor: "1h", texto: "1 hora" },
  { valor: "3h", texto: "3 horas" },
  { valor: "manana", texto: "Mañana 9:00" },
  { valor: "3d", texto: "En 3 días" },
  { valor: "7d", texto: "En una semana" },
];

function horaPospuesta(opcion: string): string {
  const ahora = new Date();
  if (opcion.endsWith("h")) return fechaHoraLocalTexto(new Date(ahora.getTime() + Number(opcion.slice(0, -1)) * 3_600_000));
  const dias = opcion === "manana" ? 1 : Number(opcion.slice(0, -1));
  const f = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + dias, opcion === "manana" ? 9 : ahora.getHours(), opcion === "manana" ? 0 : ahora.getMinutes());
  return fechaHoraLocalTexto(f);
}

/** Actualiza el contador del botón (pendientes / vencidos). */
function pintarContadorRecordatorios(): void {
  const ahora = fechaHoraLocalTexto();
  const vencidos = listaRecordatorios.filter((r) => r.fechaHora <= ahora).length;
  const b = $("btn-recordatorios");
  b.toggleAttribute("data-vencidos", vencidos > 0);
  $("contador-recordatorios").textContent = String(vencidos || listaRecordatorios.length);
  b.title = vencidos
    ? `${vencidos} ${vencidos === 1 ? "recordatorio vencido" : "recordatorios vencidos"} de ${listaRecordatorios.length}`
    : `${listaRecordatorios.length} recordatorios pendientes`;
}

function itemRecordatorio(r: Phoenix.Recordatorio): string {
  const c = cuandoRecordatorio(r.fechaHora);
  return `<li data-recordatorio="${esc(r.id)}">
      <span class="rec-hora">${esc(c.hora)}<small>${esc(c.dia)}</small></span>
      <div>
        <button class="rec-nombre" data-abrir-cliente="${esc(r.clienteId)}">${esc(r.nombre || rutCompleto(r.rut, r.dv))}</button>
        <p class="rec-motivo">${esc(r.motivo)}</p>
        <p class="rec-meta">${etiquetaEstado(r.estadoActual)}<span>${pesos(r.deuda)}</span></p>
      </div>
      <div class="rec-acciones">
        <button class="btn pequeño secundario" data-abrir-cliente="${esc(r.clienteId)}">Gestionar</button>
        <select class="rec-posponer" data-posponer aria-label="Posponer">
          <option value="">Posponer…</option>
          ${OPCIONES_POSPONER.map((o) => `<option value="${o.valor}">${o.texto}</option>`).join("")}
        </select>
        <button class="btn pequeño texto" data-hecho>Hecho</button>
        <button class="btn pequeño texto peligro" data-descartar title="Quitar sin registrar gestión">Descartar</button>
      </div>
    </li>`;
}

function pintarPanelRecordatorios(): void {
  const ahora = fechaHoraLocalTexto();
  const finHoy = `${hoyLocal()}T23:59`;
  const grupos = [
    { clase: "atrasados", titulo: "Atrasados", items: listaRecordatorios.filter((r) => r.fechaHora < ahora) },
    { clase: "hoy", titulo: "Hoy", items: listaRecordatorios.filter((r) => r.fechaHora >= ahora && r.fechaHora <= finHoy) },
    { clase: "proximos", titulo: "Próximos", items: listaRecordatorios.filter((r) => r.fechaHora > finHoy) },
  ].filter((g) => g.items.length);
  $("recordatorios-resumen").textContent = listaRecordatorios.length
    ? `${numero(listaRecordatorios.length)} pendientes en ${App.contexto?.periodo.nombre ?? "este mes"}`
    : "";
  $("recordatorios-cuerpo").innerHTML = grupos.length
    ? grupos
        .map(
          (g) => `<section class="grupo-recordatorios ${g.clase}">
            <h3>${g.titulo} <span class="contador">${g.items.length}</span></h3>
            <ul class="lista-recordatorios">${g.items.map(itemRecordatorio).join("")}</ul></section>`
        )
        .join("")
    : `<div class="panel-vacio">${ICONO.campana}<p>No tienes recordatorios pendientes.</p>
        <p class="bajada">Se agendan solos al registrar estados como «No contesta», «Notificado» o «Compromiso de pago».</p></div>`;
}

async function cargarRecordatorios(): Promise<void> {
  if (!App.contexto) return;
  try {
    listaRecordatorios = await Api.recordatorios();
    pintarContadorRecordatorios();
    if ($("panel-recordatorios").classList.contains("abierto")) pintarPanelRecordatorios();
  } catch {
    /* sin sesión o sin cartera: se reintenta en el próximo ciclo */
  }
}

async function abrirRecordatorios(): Promise<void> {
  await cargarRecordatorios();
  pintarPanelRecordatorios();
  const panel = $("panel-recordatorios");
  panel.classList.add("abierto");
  panel.setAttribute("aria-hidden", "false");
  $("velo-recordatorios").hidden = false;
  $("btn-recordatorios").setAttribute("aria-expanded", "true");
  $("recordatorios-cerrar").focus();
}

function cerrarRecordatorios(): void {
  const panel = $("panel-recordatorios");
  panel.classList.remove("abierto");
  panel.setAttribute("aria-hidden", "true");
  $("velo-recordatorios").hidden = true;
  $("btn-recordatorios").setAttribute("aria-expanded", "false");
}

/** Notificación de escritorio (Windows/macOS) más aviso dentro de la app. */
function avisarRecordatorio(r: Phoenix.Recordatorio): void {
  const titulo = `Volver a gestionar: ${r.nombre || rutCompleto(r.rut, r.dv)}`;
  const abrir = () => {
    window.focus();
    cerrarRecordatorios();
    void abrirFicha(r.clienteId);
  };
  try {
    if ("Notification" in window && Notification.permission !== "denied") {
      const n = new Notification(titulo, { body: `${r.motivo} · ${nombreEstado(r.estadoActual)}`, tag: r.id, silent: false });
      n.onclick = abrir;
    }
  } catch {
    /* sin notificaciones del sistema: queda el aviso de la app */
  }
  aviso(`${titulo}. ${r.motivo}.`, "info", { texto: "Abrir ficha", fn: abrir });
}

async function revisarRecordatoriosVencidos(): Promise<void> {
  if (!App.contexto) return;
  try {
    const nuevos = await Api.recordatoriosAvisar();
    if (nuevos.length) {
      nuevos.slice(0, 3).forEach(avisarRecordatorio);
      if (nuevos.length > 3) aviso(`Y ${nuevos.length - 3} recordatorios más vencieron.`, "info", { texto: "Ver", fn: () => void abrirRecordatorios() });
      const b = $("btn-recordatorios");
      b.classList.remove("timbre");
      void b.offsetWidth; // reinicia la animación
      b.classList.add("timbre");
    }
    await cargarRecordatorios();
  } catch {
    /* se reintenta en el próximo ciclo */
  }
}

/** Arranca (o reinicia) la revisión periódica tras iniciar sesión o cambiar de mes. */
function iniciarRecordatorios(): void {
  if (temporizadorRecordatorios !== null) clearInterval(temporizadorRecordatorios);
  void revisarRecordatoriosVencidos();
  temporizadorRecordatorios = window.setInterval(() => void revisarRecordatoriosVencidos(), 60_000);
}

function detenerRecordatorios(): void {
  if (temporizadorRecordatorios !== null) clearInterval(temporizadorRecordatorios);
  temporizadorRecordatorios = null;
  listaRecordatorios = [];
  cerrarRecordatorios();
}

function prepararRecordatorios(): void {
  $("btn-recordatorios").addEventListener("click", () => {
    if ($("panel-recordatorios").classList.contains("abierto")) cerrarRecordatorios();
    else void abrirRecordatorios();
  });
  $("recordatorios-cerrar").addEventListener("click", cerrarRecordatorios);
  $("velo-recordatorios").addEventListener("click", cerrarRecordatorios);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("panel-recordatorios").classList.contains("abierto")) cerrarRecordatorios();
  });

  const cuerpo = $("recordatorios-cuerpo");
  cuerpo.addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const cliente = t.closest<HTMLElement>("[data-abrir-cliente]")?.dataset.abrirCliente;
    if (cliente) {
      cerrarRecordatorios();
      return void abrirFicha(cliente);
    }
    const id = t.closest<HTMLElement>("[data-recordatorio]")?.dataset.recordatorio;
    if (!id) return;
    if (t.closest("[data-hecho]") || t.closest("[data-descartar]")) {
      const estado = t.closest("[data-hecho]") ? "HECHO" : "DESCARTADO";
      if (await intentar(() => Api.resolverRecordatorio(id, estado))) {
        aviso(estado === "HECHO" ? "Recordatorio cumplido." : "Recordatorio descartado.", "ok");
        await cargarRecordatorios();
      }
    }
  });
  cuerpo.addEventListener("change", async (ev) => {
    const sel = (ev.target as HTMLElement).closest<HTMLSelectElement>("[data-posponer]");
    const id = sel?.closest<HTMLElement>("[data-recordatorio]")?.dataset.recordatorio;
    if (!sel || !id || !sel.value) return;
    const nueva = horaPospuesta(sel.value);
    if (await intentar(() => Api.posponerRecordatorio(id, nueva))) {
      const c = cuandoRecordatorio(nueva);
      aviso(`Pospuesto para ${c.dia} a las ${c.hora}.`, "ok");
      await cargarRecordatorios();
    }
  });

  // Permiso de notificaciones de escritorio (Electron lo concede sin preguntar).
  try {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  } catch {
    /* sin API de notificaciones */
  }
}
