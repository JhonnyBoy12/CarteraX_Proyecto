/**
 * @file vista-clientes.ts
 * @description Gestión de cartera (RF-16 a RF-21):
 *  - Búsqueda, chips de estado con conteos, filtros rápidos y filtros
 *    avanzados (rango de deuda y mora, tramo, comuna, teléfono, prioridad).
 *  - Selección múltiple para cambiar estado o enviar a la cola.
 *  - Ficha lateral del cliente: registrar gestión (estado + comentario +
 *    compromiso/abono + próxima gestión), contacto e historial.
 */

const FILTRO_INICIAL: Phoenix.FiltroClientes = {
  texto: "", estados: [], tramo: "", comuna: "", deudaMin: null, deudaMax: null,
  moraMin: null, moraMax: null, conTelefono: "", prioridad: "", rapido: "", orden: "prioridad", pagina: 1, porPagina: 50,
};

const filtro: Phoenix.FiltroClientes = { ...FILTRO_INICIAL };
const seleccion = new Set<string>();
let ultimaPagina: Phoenix.PaginaClientes | null = null;
let fichaActual: Phoenix.DetalleCliente | null = null;

const PRESETS_DEUDA: Array<{ etiqueta: string; min: number | null; max: number | null }> = [
  { etiqueta: "Menos de $500 mil", min: null, max: 499_999 },
  { etiqueta: "$500 mil a $1 M", min: 500_000, max: 999_999 },
  { etiqueta: "$1 M a $3 M", min: 1_000_000, max: 2_999_999 },
  { etiqueta: "$3 M a $5 M", min: 3_000_000, max: 4_999_999 },
  { etiqueta: "Más de $5 M", min: 5_000_000, max: null },
];
const PRESETS_MORA: Array<{ etiqueta: string; min: number | null; max: number | null }> = [
  { etiqueta: "Hasta 30 días", min: null, max: 30 },
  { etiqueta: "31 a 90", min: 31, max: 90 },
  { etiqueta: "91 a 180", min: 91, max: 180 },
  { etiqueta: "Más de 180", min: 181, max: null },
];

/** Frases frecuentes que el ejecutivo inserta en el comentario con un clic. */
const FRASES_RAPIDAS = [
  "Buzón de voz",
  "Número equivocado",
  "Titular no disponible, llamar más tarde",
  "Solicita repactación",
  "Se envía cupón de pago",
  "Indica que ya pagó, validar",
];

// =========================== Navegación externa ===========================

/** Abre Clientes con un filtro (desde el dashboard, alertas, etc.). */
function irAClientes(parcial: Partial<Phoenix.FiltroClientes>): void {
  Object.assign(filtro, FILTRO_INICIAL, parcial, { pagina: 1 });
  sincronizarControles();
  irA("clientes");
}

// ============================== Filtros UI ==============================

/** Cantidad de filtros avanzados activos (para el botón "Más filtros"). */
function filtrosAvanzadosActivos(): number {
  return [
    filtro.deudaMin !== null || filtro.deudaMax !== null,
    filtro.moraMin !== null || filtro.moraMax !== null,
    !!filtro.tramo, !!filtro.comuna, !!filtro.conTelefono, !!filtro.prioridad,
  ].filter(Boolean).length;
}

/** Copia `filtro` a los controles (tras navegar con un filtro externo). */
function sincronizarControles(): void {
  $input("buscar-cliente").value = filtro.texto ?? "";
  $select("orden-clientes").value = filtro.orden ?? "prioridad";
  $input("deuda-min").value = filtro.deudaMin === null || filtro.deudaMin === undefined ? "" : numero(filtro.deudaMin);
  $input("deuda-max").value = filtro.deudaMax === null || filtro.deudaMax === undefined ? "" : numero(filtro.deudaMax);
  $input("mora-min").value = filtro.moraMin === null || filtro.moraMin === undefined ? "" : String(filtro.moraMin);
  $input("mora-max").value = filtro.moraMax === null || filtro.moraMax === undefined ? "" : String(filtro.moraMax);
  $select("filtro-tramo").value = filtro.tramo ?? "";
  $select("filtro-comuna").value = filtro.comuna ?? "";
  $select("filtro-telefono").value = filtro.conTelefono ?? "";
  $select("filtro-prioridad").value = filtro.prioridad ?? "";
  $select("por-pagina").value = String(filtro.porPagina ?? 50);
  document.querySelectorAll<HTMLButtonElement>("#filtros-rapidos button").forEach((b) =>
    b.setAttribute("aria-pressed", String((b.dataset.rapido ?? "") === (filtro.rapido ?? "")))
  );
  pintarPresets();
  const n = filtrosAvanzadosActivos();
  $("contador-filtros").textContent = n ? String(n) : "";
  $("contador-filtros").hidden = n === 0;
  if (n > 0) $("panel-filtros").hidden = false;
}

function pintarPresets(): void {
  $("presets-deuda").innerHTML = PRESETS_DEUDA.map(
    (p, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${p.min === (filtro.deudaMin ?? null) && p.max === (filtro.deudaMax ?? null)}">${esc(p.etiqueta)}</button>`
  ).join("");
  $("presets-mora").innerHTML = PRESETS_MORA.map(
    (p, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${p.min === (filtro.moraMin ?? null) && p.max === (filtro.moraMax ?? null)}">${esc(p.etiqueta)}</button>`
  ).join("");
}

/** Chips de estado con conteo (multi-selección). */
function pintarChipsEstado(conteo: Partial<Record<Phoenix.CodigoEstado, number>>, total: number): void {
  const activos = new Set(filtro.estados ?? []);
  const todos = Object.values(conteo).reduce((s, n) => s + (n ?? 0), 0);
  $("chips-estado").innerHTML =
    `<button class="chip-estado" data-estado="" aria-pressed="${activos.size === 0}">Todos <b>${numero(todos)}</b></button>` +
    App.estados
      .map((e) => {
        const n = conteo[e.codigo] ?? 0;
        return `<button class="chip-estado tono-${e.tono}" data-estado="${e.codigo}" aria-pressed="${activos.has(e.codigo)}"
          ${n === 0 && !activos.has(e.codigo) ? "data-vacio" : ""} title="${esc(e.descripcion)}"><i></i>${esc(e.nombre)} <b>${numero(n)}</b></button>`;
      })
      .join("");
  void total;
}

async function cargarOpcionesFiltro(): Promise<void> {
  try {
    const o = await Api.opcionesFiltro();
    $select("filtro-tramo").innerHTML = `<option value="">Todos los tramos</option>` + o.tramos.map((t) => `<option>${esc(t)}</option>`).join("");
    $select("filtro-comuna").innerHTML = `<option value="">Todas las comunas</option>` + o.comunas.map((c) => `<option>${esc(c)}</option>`).join("");
    $select("filtro-tramo").value = filtro.tramo ?? "";
    $select("filtro-comuna").value = filtro.comuna ?? "";
  } catch {
    /* sin cartera: los selectores quedan vacíos */
  }
}

// ============================== Tabla ==============================

/** Texto de la última gestión para la tabla. */
function celdaUltimaGestion(c: Phoenix.ClienteFila): string {
  const cuando = c.ultimaGestion ? haceDias(c.diasSinGestion) : "Sin gestión";
  const alerta = !c.ultimaGestion || (c.diasSinGestion ?? 0) >= App.config.diasSinGestion;
  return `<span class="${alerta && c.nivelPrioridad === "alta" ? "texto-aviso" : ""}">${esc(cuando)}</span>${
    c.ultimoComentario ? `<small class="comentario-corto" title="${esc(c.ultimoComentario)}">${esc(c.ultimoComentario)}</small>` : ""
  }`;
}

function celdaEstado(c: Phoenix.ClienteFila): string {
  let extra = "";
  if (c.estado === "COMPROMISO" && c.fechaCompromiso) {
    extra = `<small class="${c.compromisoVencido ? "texto-alerta" : ""}">${c.compromisoVencido ? "Venció" : "Paga"} ${fechaCalendario(c.fechaCompromiso)}</small>`;
  } else if (c.proximaGestion) {
    extra = `<small class="${c.proximaGestion <= hoyLocal() ? "texto-alerta" : ""}">Agendado ${fechaCalendario(c.proximaGestion)}</small>`;
  }
  return etiquetaEstado(c.estado) + extra;
}

function celdaTelefonos(c: Phoenix.ClienteFila): string {
  const validos = c.telefonos.filter((t) => t.valido);
  if (!validos.length) return `<span class="bajada">${c.telefonos.length ? "Teléfonos erróneos" : "Sin teléfono"}</span>`;
  const t = validos[0];
  return `<button class="btn-llamar" data-numero="${esc(t.numero)}" data-cliente="${esc(c.id)}" title="Llamar desde Phoenix Mobile">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>
      ${esc(t.numero)}</button>${validos.length > 1 ? `<small>+${validos.length - 1} más</small>` : ""}`;
}

async function cargarClientes(): Promise<void> {
  const cuerpo = document.querySelector("#tabla-clientes tbody")!;
  try {
    const r = await Api.clientes(filtro);
    ultimaPagina = r;
    filtro.pagina = r.pagina;
    pintarChipsEstado(r.conteoEstados, r.total);
    const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
    $("clientes-resumen").innerHTML = `<b>${numero(r.total)}</b> ${r.total === 1 ? "cliente" : "clientes"} · deuda <b>${pesos(r.sumaDeuda)}</b>`;
    $("pag-info").textContent = `Página ${r.pagina} de ${paginas}`;
    $boton("pag-anterior").disabled = r.pagina <= 1;
    $boton("pag-siguiente").disabled = r.pagina >= paginas;

    cuerpo.innerHTML = r.filas.length
      ? r.filas
          .map(
            (c) => `<tr data-id="${esc(c.id)}" class="${seleccion.has(c.id) ? "seleccionada" : ""} ${fichaActual?.id === c.id ? "abierta" : ""}">
              <td class="col-check"><input type="checkbox" class="sel-fila" aria-label="Seleccionar ${esc(c.nombre)}" ${seleccion.has(c.id) ? "checked" : ""}></td>
              <td><span class="nombre-cliente">${esc(c.nombre)}</span><small>${esc(rutCompleto(c.rut, c.dv))}${c.comuna ? ` · ${esc(c.comuna)}` : ""}</small></td>
              <td>${celdaEstado(c)}</td>
              <td class="num"><b>${pesos(c.deuda)}</b>${c.montoRecuperado > 0 ? `<small class="positivo">${pesos(c.montoRecuperado)} recuperado</small>` : ""}</td>
              <td class="num">${c.diasMora === null ? "—" : `${numero(c.diasMora)} d`}<small>${esc(c.tramo ?? "")}</small></td>
              <td class="col-prioridad">${etiquetaPrioridad(c.prioridad, c.nivelPrioridad)}</td>
              <td class="col-gestion">${celdaUltimaGestion(c)}</td>
              <td class="col-telefono">${celdaTelefonos(c)}</td>
            </tr>`
          )
          .join("")
      : filaVacia(8, filtro.texto || (filtro.estados ?? []).length || filtrosAvanzadosActivos() || filtro.rapido
          ? "Ningún cliente calza con estos filtros. Prueba limpiándolos."
          : "No hay clientes en este mes. Importa un archivo de cartera.");
    actualizarBarraSeleccion();
  } catch (e) {
    cuerpo.innerHTML = filaVacia(8, (e as Error).message);
  }
}

const recargar = () => {
  filtro.pagina = 1;
  void cargarClientes();
};

// ============================ Selección ============================

function actualizarBarraSeleccion(): void {
  const n = seleccion.size;
  $("barra-seleccion").hidden = n === 0;
  $("sel-cantidad").textContent = `${numero(n)} ${n === 1 ? "seleccionado" : "seleccionados"}`;
  const total = ultimaPagina?.total ?? 0;
  const todos = $boton("sel-todos-filtrados");
  todos.hidden = n >= total || total === 0;
  todos.textContent = `Seleccionar los ${numero(total)} filtrados`;
  const visibles = ultimaPagina?.filas ?? [];
  const marca = $input("sel-pagina");
  marca.checked = visibles.length > 0 && visibles.every((f) => seleccion.has(f.id));
  marca.indeterminate = !marca.checked && visibles.some((f) => seleccion.has(f.id));
}

async function aplicarEstadoMasivo(estado: Phoenix.CodigoEstado, comentario: string | null, fecha: string | null, proxima: string | null): Promise<void> {
  const ids = [...seleccion];
  const r = await intentar(() =>
    Api.gestionar({ clienteIds: ids, estado, comentario, fechaCompromiso: fecha, proximaGestion: proxima })
  );
  if (!r) return;
  aviso(`${numero(r.actualizados)} ${r.actualizados === 1 ? "cliente quedó" : "clientes quedaron"} en «${nombreEstado(estado)}».`, "ok");
  seleccion.clear();
  await cargarClientes();
  if (fichaActual && ids.includes(fichaActual.id)) abrirFicha(fichaActual.id);
}

function abrirDialogoMasivo(estadoInicial: Phoenix.CodigoEstado | null = null): void {
  const dlg = $("dialogo-masivo") as HTMLDialogElement;
  $("masivo-titulo").textContent = `Cambiar estado de ${numero(seleccion.size)} ${seleccion.size === 1 ? "cliente" : "clientes"}`;
  $select("masivo-estado").innerHTML = opcionesEstados(estadoInicial ?? "EN_COLA", ["ABONO"]);
  $input("masivo-fecha").value = "";
  $input("masivo-fecha").min = hoyLocal();
  $input("masivo-proxima").value = "";
  ($("masivo-comentario") as HTMLTextAreaElement).value = "";
  actualizarCamposMasivo();
  dlg.showModal();
}

function actualizarCamposMasivo(): void {
  const e = App.porCodigo.get($select("masivo-estado").value);
  $("masivo-campo-fecha").hidden = !e?.pideFecha;
  $("masivo-descripcion").textContent = e?.descripcion ?? "";
}

// ============================== Ficha ==============================

async function llamarCliente(numeroTel: string, clienteId: string | null, boton?: HTMLButtonElement): Promise<void> {
  const r = await intentar(() => Api.llamar(numeroTel, clienteId), boton);
  if (!r) return;
  aviso(`Llamando a ${r.numero} desde el teléfono.`, "ok");
  if (r.seguimiento) mostrarLlamadaManual(r.seguimiento);
}

function cerrarFicha(): void {
  fichaActual = null;
  $("ficha").hidden = true;
  document.querySelectorAll("#tabla-clientes tr.abierta").forEach((tr) => tr.classList.remove("abierta"));
}

/** Abre (o recarga) la ficha de un cliente. Funciona desde cualquier vista. */
async function abrirFicha(clienteId: string): Promise<void> {
  if (vistaActual !== "clientes") irA("clientes");
  const ficha = $("ficha");
  ficha.hidden = false;
  if (fichaActual?.id !== clienteId) $("ficha-cuerpo").innerHTML = `<p class="cargando">Cargando ficha…</p>`;
  try {
    const c = await Api.detalle(clienteId);
    fichaActual = c;
    pintarFicha(c);
    document.querySelectorAll<HTMLElement>("#tabla-clientes tbody tr").forEach((tr) => tr.classList.toggle("abierta", tr.dataset.id === c.id));
  } catch (e) {
    $("ficha-cuerpo").innerHTML = `<p class="sin-datos">${esc((e as Error).message)}</p>`;
  }
}

function textoGestion(g: Phoenix.Gestion): string {
  if (g.tipo === "llamada") {
    const res = textoLlamada(g.resultado, g.motivoLlamada, g.duracion);
    return `Llamada a ${esc(g.telefono ?? "")}: <span class="resultado ${res.clase}">${esc(res.texto)}</span>`;
  }
  if (g.resultado === "reverso_pago") return `Se revierte pago de ${pesos(Math.abs(g.monto ?? 0))}`;
  const partes: string[] = [];
  if (g.estadoAnterior && g.estadoNuevo) partes.push(`${etiquetaEstado(g.estadoAnterior)} <span class="flecha">a</span> ${etiquetaEstado(g.estadoNuevo)}`);
  else if (g.estadoNuevo) partes.push(etiquetaEstado(g.estadoNuevo));
  if (g.fechaCompromiso) partes.push(`<span>paga el ${fechaCalendario(g.fechaCompromiso)}</span>`);
  if (g.monto && g.monto > 0) partes.push(`<span class="positivo">${pesos(g.monto)}</span>`);
  if (g.proximaGestion) partes.push(`<span>próxima gestión ${fechaCalendario(g.proximaGestion)}</span>`);
  return partes.join(" ");
}

function pintarFicha(c: Phoenix.DetalleCliente): void {
  const saldo = Math.max(0, c.deuda - c.montoRecuperado);
  $("ficha-cuerpo").innerHTML = `
    <header class="ficha-cab">
      <div>
        <h2>${esc(c.nombre)}</h2>
        <p class="bajada">${esc(rutCompleto(c.rut, c.dv))}${c.comuna ? ` · ${esc(c.comuna)}` : ""}</p>
      </div>
      <div class="ficha-cab-estado">${etiquetaEstado(c.estado)}${etiquetaPrioridad(c.prioridad, c.nivelPrioridad)}</div>
    </header>

    <dl class="ficha-cifras">
      <div><dt>Deuda</dt><dd>${pesos(c.deuda)}</dd></div>
      <div><dt>Saldo</dt><dd>${pesos(saldo)}</dd>${c.montoRecuperado ? `<small class="positivo">${pesos(c.montoRecuperado)} recuperado</small>` : ""}</div>
      <div><dt>Mora</dt><dd>${c.diasMora === null ? "—" : `${numero(c.diasMora)} días`}</dd><small>${esc(c.tramo ?? "")}</small></div>
      <div><dt>Cuotas pagadas</dt><dd>${c.pctRecuperacion === null ? "—" : `${numero(c.pctRecuperacion, 1)} %`}</dd></div>
    </dl>
    ${
      c.estado === "COMPROMISO" && c.fechaCompromiso
        ? `<p class="aviso-ficha ${c.compromisoVencido ? "vencido" : ""}">${c.compromisoVencido ? "Compromiso vencido" : "Compromiso de pago"}: ${fechaCalendario(c.fechaCompromiso)}${c.montoCompromiso ? ` por ${pesos(c.montoCompromiso)}` : ""}</p>`
        : ""
    }
    ${avisoRecordatorioFicha(c.id)}

    <form class="form-gestion" id="form-gestion">
      <h3>Registrar gestión</h3>
      <fieldset class="estados-grilla" aria-label="Nuevo estado">
        <label class="estado-opcion sin-cambio"><input type="radio" name="estado" value="" checked><span>Sólo comentario</span></label>
        ${App.estados
          .map(
            (e) => `<label class="estado-opcion tono-${e.tono} ${e.codigo === c.estado ? "actual" : ""}" title="${esc(e.descripcion)}">
              <input type="radio" name="estado" value="${e.codigo}"><span><i></i>${esc(e.nombre)}</span></label>`
          )
          .join("")}
      </fieldset>
      <div class="campos-condicionales">
        <label class="campo" id="gc-fecha" hidden><span>Fecha del compromiso</span><input type="date" name="fecha" min="${hoyLocal()}"></label>
        <label class="campo" id="gc-monto" hidden><span id="gc-monto-etiqueta">Monto</span><input type="text" name="monto" inputmode="numeric" placeholder="$ 0" autocomplete="off"></label>
        <label class="campo"><span>Próxima gestión</span><input type="date" name="proxima" min="${hoyLocal()}"></label>
      </div>
      ${campoRecordatorio()}
      <label class="campo campo-comentario">
        <span>Comentario <small id="gc-contador">0 / 2000</small></span>
        <textarea name="comentario" rows="3" maxlength="2000" placeholder="Qué se habló, qué acordó el cliente, qué sigue."></textarea>
      </label>
      <div class="frases-rapidas">${FRASES_RAPIDAS.map((f) => `<button type="button" class="chip" data-frase="${esc(f)}">${esc(f)}</button>`).join("")}</div>
      <p class="form-error" id="gc-error" hidden></p>
      <div class="form-acciones"><span class="bajada">Ctrl + Enter para guardar</span><button class="btn primario" type="submit">Guardar gestión</button></div>
    </form>

    <section class="ficha-seccion">
      <h3>Contacto</h3>
      <ul class="lista-telefonos">${
        c.telefonos
          .map(
            (t) => `<li class="${t.valido ? "" : "invalido"}">
              <span class="tel-numero">${esc(t.numero)}</span>
              <span class="tel-estado">${t.valido ? (t.intentos ? `${t.intentos} ${t.intentos === 1 ? "intento" : "intentos"}${t.estadoLlamada === "CONTACTADO" ? ", contestó" : t.estadoLlamada === "NO_CONTESTA" ? ", no contestó" : ""}` : "Sin llamar") : "Marcado como erróneo"}</span>
              ${t.valido ? `<button class="btn pequeño primario" data-llamar="${esc(t.numero)}">Llamar</button>` : ""}
              <button class="btn pequeño texto" data-telefono="${esc(t.id)}" data-valido="${t.valido ? "0" : "1"}">${t.valido ? "Marcar erróneo" : "Marcar válido"}</button>
            </li>`
          )
          .join("") || `<li class="bajada">Sin teléfonos registrados.</li>`
      }</ul>
      ${c.correos.length ? `<p class="dato-contacto"><span>Correo</span>${c.correos.map((m) => esc(m)).join(", ")}</p>` : ""}
      ${c.direcciones.filter((d) => d.direccion).map((d) => `<p class="dato-contacto"><span>Dirección</span>${esc(d.direccion)}${d.comuna ? `, ${esc(d.comuna)}` : ""}</p>`).join("")}
      ${c.vehiculos.map((v) => `<p class="dato-contacto"><span>Vehículo</span>${esc([v.marca, v.modelo].filter(Boolean).join(" "))}${v.patente ? ` · patente ${esc(v.patente)}` : ""}</p>`).join("")}
    </section>

    ${
      c.operaciones.length
        ? `<section class="ficha-seccion"><h3>Operaciones</h3><div class="tabla-envoltura"><table class="tabla-compacta">
            <thead><tr><th>N°</th><th class="num">Deuda</th><th class="num">Cuota</th><th class="num">Pagadas</th><th class="num">Morosas</th><th>Últ. pago</th></tr></thead>
            <tbody>${c.operaciones
              .map((o) => `<tr><td>${esc(o.numero)}</td><td class="num">${pesos(o.deuda)}</td><td class="num">${pesos(o.cuota)}</td>
                <td class="num">${o.cuotasPagadas ?? "—"}${o.cuotasPactadas ? ` / ${o.cuotasPactadas}` : ""}</td><td class="num">${o.cuotasMorosas ?? "—"}</td>
                <td>${o.fechaUltimoPago ? fechaCalendario(o.fechaUltimoPago) : "—"}</td></tr>`)
              .join("")}</tbody></table></div></section>`
        : ""
    }

    <section class="ficha-seccion">
      <h3>Historial del caso <small>${numero(c.gestiones.length)}</small></h3>
      <ol class="historial">${
        c.gestiones
          .map(
            (g) => `<li class="h-${g.tipo}">
              <div class="h-cab"><time>${fechaHora(g.fecha)}</time>${g.usuario ? `<span>${esc(g.usuario)}</span>` : ""}</div>
              <div class="h-accion">${textoGestion(g)}</div>
              ${g.comentario && g.tipo !== "llamada" ? `<p class="h-comentario">${esc(g.comentario)}</p>` : ""}
            </li>`
          )
          .join("") || `<li class="bajada">Aún no hay gestiones este mes.</li>`
      }${c.textoGestionImportada ? `<li class="h-importada"><div class="h-cab"><span>Gestión anterior (del archivo importado)</span></div><p class="h-comentario">${esc(c.textoGestionImportada)}</p></li>` : ""}</ol>
    </section>`;

  prepararFormGestion(c);
}

/** Línea con el recordatorio pendiente del cliente (si hay). */
function avisoRecordatorioFicha(clienteId: string): string {
  const r = listaRecordatorios.find((x) => x.clienteId === clienteId);
  if (!r) return "";
  const c = cuandoRecordatorio(r.fechaHora);
  const vencido = r.fechaHora <= fechaHoraLocalTexto();
  return `<p class="aviso-ficha recordatorio ${vencido ? "vencido" : ""}">${ICONO.campana}<span>${vencido ? "Recordatorio vencido" : "Recordatorio"}: ${esc(c.dia)} a las ${esc(c.hora)} · ${esc(r.motivo)}</span></p>`;
}

function prepararFormGestion(c: Phoenix.DetalleCliente): void {
  const form = $("form-gestion") as HTMLFormElement;
  const comentario = form.elements.namedItem("comentario") as HTMLTextAreaElement;
  const valor = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value || null;
  const refrescarRecordatorio = conectarRecordatorio(
    form,
    () => form.querySelector<HTMLInputElement>("input[name=estado]:checked")?.value || null,
    () => valor("fecha"),
    () => valor("proxima")
  );
  const actualizar = () => {
    refrescarRecordatorio();
    const codigo = (form.querySelector<HTMLInputElement>("input[name=estado]:checked")?.value ?? "") as Phoenix.CodigoEstado | "";
    const e = codigo ? App.porCodigo.get(codigo) : null;
    $("gc-fecha").hidden = !e?.pideFecha;
    $("gc-monto").hidden = !e?.pideMonto;
    $("gc-monto-etiqueta").textContent =
      codigo === "PAGADO" ? `Monto pagado (vacío = saldo ${pesos(Math.max(0, c.deuda - c.montoRecuperado))})` : codigo === "ABONO" ? "Monto abonado" : "Monto comprometido";
    $("gc-contador").textContent = `${comentario.value.length} / 2000`;
  };
  form.addEventListener("change", actualizar);
  comentario.addEventListener("input", actualizar);
  form.querySelector(".frases-rapidas")!.addEventListener("click", (ev) => {
    const f = (ev.target as HTMLElement).closest<HTMLElement>("[data-frase]")?.dataset.frase;
    if (!f) return;
    comentario.value = comentario.value.trim() ? `${comentario.value.trim()}. ${f}` : f;
    comentario.focus();
    actualizar();
  });
  form.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) form.requestSubmit();
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const datos = new FormData(form);
    const estado = (String(datos.get("estado") ?? "") || null) as Phoenix.CodigoEstado | null;
    const montoTexto = String(datos.get("monto") ?? "");
    const monto = leerMonto(montoTexto);
    const error = $("gc-error");
    error.hidden = true;
    if (montoTexto.trim() && monto === null) {
      error.textContent = "El monto no es válido. Escríbelo como 150000 o 150.000.";
      error.hidden = false;
      return;
    }
    const boton = form.querySelector<HTMLButtonElement>("button[type=submit]");
    try {
      if (boton) boton.disabled = true;
      await Api.gestionar({
        clienteIds: [c.id],
        estado,
        comentario: String(datos.get("comentario") ?? ""),
        monto,
        fechaCompromiso: String(datos.get("fecha") ?? "") || null,
        proximaGestion: String(datos.get("proxima") ?? "") || null,
        recordatorio: leerRecordatorio(form),
      });
      const rec = leerRecordatorio(form);
      const cuando = rec ? cuandoRecordatorio(rec.fechaHora) : null;
      aviso(
        `${estado && estado !== c.estado ? `Gestión guardada: ${c.nombre} quedó en «${nombreEstado(estado)}».` : "Gestión guardada."}${
          cuando ? ` Te recordaré ${cuando.dia} a las ${cuando.hora}.` : ""
        }`,
        "ok"
      );
      await cargarRecordatorios();
      await Promise.all([abrirFicha(c.id), cargarClientes()]);
    } catch (e) {
      error.textContent = (e as Error).message;
      error.hidden = false;
    } finally {
      if (boton) boton.disabled = false;
    }
  });
  actualizar();
}

// ============================== Eventos ==============================

function prepararClientes(): void {
  $input("buscar-cliente").addEventListener(
    "input",
    debounce((ev: Event) => {
      filtro.texto = (ev.target as HTMLInputElement).value;
      recargar();
    }, 220)
  );
  $select("orden-clientes").addEventListener("change", (ev) => {
    filtro.orden = (ev.target as HTMLSelectElement).value as Phoenix.OrdenClientes;
    recargar();
  });
  $select("por-pagina").addEventListener("change", (ev) => {
    filtro.porPagina = Number((ev.target as HTMLSelectElement).value);
    recargar();
  });

  $("chips-estado").addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-estado]");
    if (!b) return;
    const codigo = b.dataset.estado as Phoenix.CodigoEstado | "";
    const actuales = new Set(filtro.estados ?? []);
    if (!codigo) actuales.clear();
    else if (actuales.has(codigo)) actuales.delete(codigo);
    else actuales.add(codigo);
    filtro.estados = [...actuales];
    recargar();
  });

  $("filtros-rapidos").addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-rapido]");
    if (!b) return;
    filtro.rapido = (b.dataset.rapido ?? "") as Phoenix.FiltroRapido;
    sincronizarControles();
    recargar();
  });

  $("btn-mas-filtros").addEventListener("click", () => {
    const panel = $("panel-filtros");
    panel.hidden = !panel.hidden;
    $("btn-mas-filtros").setAttribute("aria-expanded", String(!panel.hidden));
  });
  $("btn-limpiar-filtros").addEventListener("click", () => {
    Object.assign(filtro, FILTRO_INICIAL, { porPagina: filtro.porPagina });
    sincronizarControles();
    recargar();
  });

  const rango = (idMin: string, idMax: string, esMonto: boolean, aplicar: (min: number | null, max: number | null) => void) => {
    const leer = (id: string) => (esMonto ? leerMonto($input(id).value) : $input(id).value.trim() ? Number($input(id).value) : null);
    const cambio = debounce(() => {
      aplicar(leer(idMin), leer(idMax));
      sincronizarControles();
      recargar();
    }, 450);
    $input(idMin).addEventListener("input", cambio);
    $input(idMax).addEventListener("input", cambio);
  };
  rango("deuda-min", "deuda-max", true, (min, max) => Object.assign(filtro, { deudaMin: min, deudaMax: max }));
  rango("mora-min", "mora-max", false, (min, max) => Object.assign(filtro, { moraMin: min, moraMax: max }));

  const presets = (id: string, lista: typeof PRESETS_DEUDA, clave: "deuda" | "mora") =>
    $(id).addEventListener("click", (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-i]");
      if (!b) return;
      const p = lista[Number(b.dataset.i)];
      const activo = b.getAttribute("aria-pressed") === "true";
      if (clave === "deuda") Object.assign(filtro, activo ? { deudaMin: null, deudaMax: null } : { deudaMin: p.min, deudaMax: p.max });
      else Object.assign(filtro, activo ? { moraMin: null, moraMax: null } : { moraMin: p.min, moraMax: p.max });
      sincronizarControles();
      recargar();
    });
  presets("presets-deuda", PRESETS_DEUDA, "deuda");
  presets("presets-mora", PRESETS_MORA, "mora");

  const selectFiltro = (id: string, clave: keyof Phoenix.FiltroClientes) =>
    $select(id).addEventListener("change", (ev) => {
      (filtro as Record<string, unknown>)[clave] = (ev.target as HTMLSelectElement).value;
      sincronizarControles();
      recargar();
    });
  selectFiltro("filtro-tramo", "tramo");
  selectFiltro("filtro-comuna", "comuna");
  selectFiltro("filtro-telefono", "conTelefono");
  selectFiltro("filtro-prioridad", "prioridad");

  $("pag-anterior").addEventListener("click", () => {
    filtro.pagina = Math.max(1, (filtro.pagina ?? 1) - 1);
    void cargarClientes();
  });
  $("pag-siguiente").addEventListener("click", () => {
    filtro.pagina = (filtro.pagina ?? 1) + 1;
    void cargarClientes();
  });

  // Tabla: selección, llamar, abrir ficha.
  $("tabla-clientes").addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const fila = t.closest<HTMLTableRowElement>("tbody tr[data-id]");
    const llamar = t.closest<HTMLButtonElement>(".btn-llamar");
    if (llamar) return void llamarCliente(llamar.dataset.numero!, llamar.dataset.cliente!, llamar);
    if (!fila) return;
    const id = fila.dataset.id!;
    if (t.closest(".col-check")) {
      const marcado = (fila.querySelector(".sel-fila") as HTMLInputElement).checked;
      if (t.tagName !== "INPUT") (fila.querySelector(".sel-fila") as HTMLInputElement).checked = !marcado;
      const ahora = (fila.querySelector(".sel-fila") as HTMLInputElement).checked;
      if (ahora) seleccion.add(id);
      else seleccion.delete(id);
      fila.classList.toggle("seleccionada", ahora);
      actualizarBarraSeleccion();
      return;
    }
    void abrirFicha(id);
  });
  $input("sel-pagina").addEventListener("change", (ev) => {
    const marcar = (ev.target as HTMLInputElement).checked;
    for (const f of ultimaPagina?.filas ?? []) {
      if (marcar) seleccion.add(f.id);
      else seleccion.delete(f.id);
    }
    void cargarClientes();
  });
  $("sel-todos-filtrados").addEventListener("click", () => {
    for (const id of ultimaPagina?.idsFiltrados ?? []) seleccion.add(id);
    void cargarClientes();
  });
  $("sel-limpiar").addEventListener("click", () => {
    seleccion.clear();
    void cargarClientes();
  });
  $("sel-a-cola").addEventListener("click", async () => {
    const n = seleccion.size;
    if (await confirmar(`Enviar ${numero(n)} ${n === 1 ? "cliente" : "clientes"} a la cola`, "Entrarán a la cola automática de llamadas ordenados por prioridad. Sus teléfonos válidos vuelven a quedar disponibles para llamar.", "Enviar a la cola")) {
      await aplicarEstadoMasivo("EN_COLA", null, null, null);
    }
  });
  $("sel-cambiar-estado").addEventListener("click", () => abrirDialogoMasivo());
  $select("masivo-estado").addEventListener("change", actualizarCamposMasivo);
  $("form-masivo").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const estado = $select("masivo-estado").value as Phoenix.CodigoEstado;
    const fecha = $input("masivo-fecha").value || null;
    if (App.porCodigo.get(estado)?.pideFecha && !fecha) return aviso("Indica la fecha del compromiso.", "error");
    ($("dialogo-masivo") as HTMLDialogElement).close();
    await aplicarEstadoMasivo(estado, ($("masivo-comentario") as HTMLTextAreaElement).value || null, fecha, $input("masivo-proxima").value || null);
  });
  $("masivo-cancelar").addEventListener("click", () => ($("dialogo-masivo") as HTMLDialogElement).close());

  // Exportar lo filtrado.
  $("btn-exportar-xlsx").addEventListener("click", async (ev) => {
    const r = await intentar(() => Api.exportarClientes(filtro, "xlsx"), ev.currentTarget as HTMLButtonElement);
    avisoArchivo(r ?? null, "Listado exportado");
  });
  $("btn-exportar-csv").addEventListener("click", async (ev) => {
    const r = await intentar(() => Api.exportarClientes(filtro, "csv"), ev.currentTarget as HTMLButtonElement);
    avisoArchivo(r ?? null, "Listado exportado");
  });

  // Ficha.
  $("ficha-cerrar").addEventListener("click", cerrarFicha);
  $("ficha-cuerpo").addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const llamar = t.closest<HTMLButtonElement>("[data-llamar]");
    if (llamar && fichaActual) {
      await llamarCliente(llamar.dataset.llamar!, fichaActual.id, llamar);
      return void abrirFicha(fichaActual.id);
    }
    const tel = t.closest<HTMLButtonElement>("[data-telefono]");
    if (tel && fichaActual) {
      const ok = await intentar(() => Api.marcarTelefono(tel.dataset.telefono!, tel.dataset.valido === "1"), tel);
      if (ok) {
        aviso(tel.dataset.valido === "1" ? "Teléfono marcado como válido." : "Teléfono marcado como erróneo: ya no entra a la cola.", "ok");
        await Promise.all([abrirFicha(fichaActual.id), cargarClientes()]);
      }
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("ficha").hidden && !document.querySelector("dialog[open]")) cerrarFicha();
    if (ev.key === "/" && vistaActual === "clientes" && !(ev.target as HTMLElement).closest("input, textarea, select")) {
      ev.preventDefault();
      $input("buscar-cliente").focus();
    }
  });
}

/** Al entrar a la vista. */
function entrarClientes(): void {
  void cargarOpcionesFiltro();
  sincronizarControles();
  void cargarClientes();
}
