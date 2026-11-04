/**
 * @file vista-reportes.ts
 * @description Reportes mensuales guardados (RF-24, RF-25): lista por mes,
 * vista del mes congelado y descarga en Excel, PDF o CSV.
 */

let reporteAbierto: string | null = null;

async function cargarReportes(): Promise<void> {
  const lista = $("lista-reportes");
  try {
    const reportes = await Api.reportes();
    $("btn-reporte-nuevo").textContent = `Guardar reporte de ${App.contexto?.periodo.nombre ?? "este mes"}`;
    if (!reportes.length) {
      lista.innerHTML = `<p class="sin-datos">Aún no hay reportes. Guarda el primero con el botón de arriba; al terminar cada mes se guarda uno automáticamente.</p>`;
      $("reporte-detalle").innerHTML = "";
      return;
    }
    const porMes = new Map<string, Phoenix.ReporteResumen[]>();
    for (const r of reportes) porMes.set(r.periodoId, [...(porMes.get(r.periodoId) ?? []), r]);
    lista.innerHTML = [...porMes.entries()]
      .map(
        ([, grupo]) => `<section class="grupo-mes"><h3>${esc(grupo[0].periodoNombre)}</h3><ul>${grupo
          .map(
            (r) => `<li><button class="item-reporte ${r.id === reporteAbierto ? "activo" : ""}" data-reporte="${esc(r.id)}">
              <span class="ir-titulo">${esc(r.titulo)}${r.automatico ? `<em>Cierre automático</em>` : ""}</span>
              <span class="ir-meta">${fechaHora(r.generadoEn)}</span>
              <span class="ir-cifras">${pesosCorto(r.recuperado)} recuperado de ${pesosCorto(r.deudaTotal)}</span>
            </button></li>`
          )
          .join("")}</ul></section>`
      )
      .join("");
    if (!reporteAbierto || !reportes.some((r) => r.id === reporteAbierto)) void abrirReporte(reportes[0].id);
  } catch (e) {
    lista.innerHTML = `<p class="sin-datos">${esc((e as Error).message)}</p>`;
  }
}

async function abrirReporte(id: string): Promise<void> {
  reporteAbierto = id;
  document.querySelectorAll<HTMLElement>(".item-reporte").forEach((b) => b.classList.toggle("activo", b.dataset.reporte === id));
  const cont = $("reporte-detalle");
  cont.innerHTML = `<p class="cargando">Abriendo reporte…</p>`;
  try {
    const r = await Api.reporte(id);
    cont.innerHTML = `
      <header class="reporte-cab">
        <div><h2>${esc(r.titulo)}</h2>
          <p class="bajada">Muestra la cartera de ${esc(r.periodoNombre)} tal como estaba el ${fechaHora(r.generadoEn)}</p>
          ${r.notas ? `<p class="reporte-notas">${esc(r.notas)}</p>` : ""}</div>
        <div class="acciones">
          <button class="btn primario" data-descargar="xlsx">Descargar Excel</button>
          <button class="btn secundario" data-descargar="pdf">Descargar PDF</button>
          <button class="btn secundario" data-descargar="csv">CSV</button>
          <button class="btn texto peligro" data-eliminar>Eliminar</button>
        </div>
      </header>
      <div id="reporte-dashboard"></div>
      <section class="bloque">
        <header class="bloque-cab"><h2>Clientes al momento del reporte</h2><span class="bajada">${numero(r.clientesDetalle.length)} clientes</span></header>
        <div class="tabla-envoltura alto-limitado"><table class="tabla-compacta">
          <thead><tr><th>Cliente</th><th>Estado</th><th class="num">Deuda</th><th class="num">Recuperado</th><th class="num">Mora</th><th>Último comentario</th></tr></thead>
          <tbody>${r.clientesDetalle
            .map((c) => `<tr><td>${esc(c.nombre)}<small>${esc(rutCompleto(c.rut, c.dv))}</small></td><td>${etiquetaEstado(c.estado)}</td>
              <td class="num">${pesos(c.deuda)}</td><td class="num">${c.recuperado ? pesos(c.recuperado) : ""}</td>
              <td class="num">${c.diasMora ?? "—"}</td><td class="col-gestion"><small class="comentario-corto">${esc(c.ultimoComentario ?? "")}</small></td></tr>`)
            .join("")}</tbody></table></div>
      </section>`;
    pintarDashboard($("reporte-dashboard"), r.dashboard, false);
  } catch (e) {
    cont.innerHTML = `<p class="sin-datos">${esc((e as Error).message)}</p>`;
  }
}

function abrirDialogoReporte(): void {
  const dlg = $("dialogo-reporte") as HTMLDialogElement;
  const mes = App.contexto?.periodo.nombre ?? "";
  $("reporte-dialogo-titulo").textContent = `Guardar reporte de ${mes}`;
  $input("reporte-titulo").value = `Reporte ${mes}`;
  ($("reporte-notas") as HTMLTextAreaElement).value = "";
  dlg.showModal();
  $input("reporte-titulo").select();
}

function prepararReportes(): void {
  $("btn-reporte-nuevo").addEventListener("click", abrirDialogoReporte);
  $("reporte-cancelar").addEventListener("click", () => ($("dialogo-reporte") as HTMLDialogElement).close());
  $("form-reporte").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const r = await intentar(() => Api.generarReporte($input("reporte-titulo").value, ($("reporte-notas") as HTMLTextAreaElement).value));
    if (!r) return;
    ($("dialogo-reporte") as HTMLDialogElement).close();
    aviso(`Reporte «${r.titulo}» guardado.`, "ok", { texto: "Ver reportes", fn: () => irA("reportes") });
    reporteAbierto = r.id;
    if (vistaActual === "reportes") void cargarReportes();
  });
  $("lista-reportes").addEventListener("click", (ev) => {
    const id = (ev.target as HTMLElement).closest<HTMLElement>("[data-reporte]")?.dataset.reporte;
    if (id) void abrirReporte(id);
  });
  $("reporte-detalle").addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const formato = t.closest<HTMLButtonElement>("[data-descargar]");
    if (formato && reporteAbierto) {
      const r = await intentar(() => Api.descargarReporte(reporteAbierto!, formato.dataset.descargar as Phoenix.FormatoDescarga), formato);
      avisoArchivo(r ?? null, "Reporte descargado");
    }
    if (t.closest("[data-eliminar]") && reporteAbierto) {
      if (await confirmar("Eliminar reporte", "El reporte guardado se borra de forma permanente. La cartera del mes no se modifica.", "Eliminar", true)) {
        if (await intentar(() => Api.eliminarReporte(reporteAbierto!))) {
          reporteAbierto = null;
          aviso("Reporte eliminado.", "ok");
          void cargarReportes();
        }
      }
    }
  });
}
