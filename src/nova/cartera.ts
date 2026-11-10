/**
 * @file cartera.ts (Nova)
 * @description Gestión de cartera (RF-16 a RF-21) en la interfaz Nova:
 *  - Búsqueda, chips de estado con conteos, filtros rápidos y avanzados.
 *  - Vista en tabla o en tarjetas; selección múltiple para cambiar estado
 *    o enviar a la cola.
 *  - Ficha del cliente como panel deslizante: registrar gestión, historial
 *    filtrable, contacto, operaciones, navegación entre clientes, copiar
 *    datos y enviar a la cola en un clic.
 * Las llamadas al backend son las mismas de la interfaz clásica.
 */

const FILTRO_INICIAL: Phoenix.FiltroClientes = {
  texto: "", estados: [], tramo: "", comuna: "", deudaMin: null, deudaMax: null,
  moraMin: null, moraMax: null, conTelefono: "", prioridad: "", rapido: "", orden: "prioridad", pagina: 1, porPagina: 50,
};

const filtro: Phoenix.FiltroClientes = { ...FILTRO_INICIAL };
const seleccion = new Set<string>();
let ultimaPagina: Phoenix.PaginaClientes | null = null;
let fichaActual: Phoenix.DetalleCliente | null = null;
let pestanaFicha: "gestion" | "historial" | "operaciones" = "gestion";
let filtroHistorial: "" | Phoenix.TipoGestion = "";
/** La próxima pintura de tarjetas lleva entrada animada (al entrar a la vista). */
let animarTarjetas = true;
let vistaCartera: "tabla" | "tarjetas" = leerLocal("nova-vista-cartera") === "tarjetas" ? "tarjetas" : "tabla";

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

const ICONO_TEL = `<svg aria-hidden="true"><use href="#i-cola"/></svg>`;

// =========================== Navegación externa ===========================

/** Abre Cartera con un filtro (desde el inicio, alertas, etc.). */
function irAClientes(parcial: Partial<Phoenix.FiltroClientes>): void {
  Object.assign(filtro, FILTRO_INICIAL, parcial, { pagina: 1, porPagina: filtro.porPagina ?? 50 });
  sincronizarControles();
  if (vistaActual === "clientes") void cargarClientes();
  else irA("clientes");
}

// ============================== Filtros UI ==============================

function filtrosAvanzadosActivos(): number {
  return [
    filtro.deudaMin !== null || filtro.deudaMax !== null,
    filtro.moraMin !== null || filtro.moraMax !== null,
    !!filtro.tramo, !!filtro.comuna, !!filtro.conTelefono, !!filtro.prioridad,
  ].filter(Boolean).length;
}

function sincronizarControles(): void {
  const v = (n: number | null | undefined, monto: boolean) => (n === null || n === undefined ? "" : monto ? numero(n) : String(n));
  $input("buscar-cliente").value = filtro.texto ?? "";
  $select("orden-clientes").value = filtro.orden ?? "prioridad";
  $input("deuda-min").value = v(filtro.deudaMin, true);
  $input("deuda-max").value = v(filtro.deudaMax, true);
  $input("mora-min").value = v(filtro.moraMin, false);
  $input("mora-max").value = v(filtro.moraMax, false);
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
  $("btn-mas-filtros").setAttribute("aria-expanded", String(!$("panel-filtros").hidden));
}

function pintarPresets(): void {
  $("presets-deuda").innerHTML = PRESETS_DEUDA.map(
    (p, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${p.min === (filtro.deudaMin ?? null) && p.max === (filtro.deudaMax ?? null)}">${esc(p.etiqueta)}</button>`
  ).join("");
  $("presets-mora").innerHTML = PRESETS_MORA.map(
    (p, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${p.min === (filtro.moraMin ?? null) && p.max === (filtro.moraMax ?? null)}">${esc(p.etiqueta)}</button>`
  ).join("");
}

function pintarChipsEstado(conteo: Partial<Record<Phoenix.CodigoEstado, number>>): void {
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

// ============================== Tabla y tarjetas ==============================

function tonoDe(codigo: string | null): string {
  return (codigo && App.porCodigo.get(codigo)?.tono) || "gris";
}

function celdaUltimaGestion(c: Phoenix.ClienteFila): string {
  const cuando = c.ultimaGestion ? haceDias(c.diasSinGestion) : "Sin gestión";
  const alerta = !c.ultimaGestion || (c.diasSinGestion ?? 0) >= App.config.diasSinGestion;
  return `<span class="${alerta && c.nivelPrioridad === "alta" ? "texto-aviso" : ""}">${esc(cuando)}</span>${
    c.ultimoComentario ? `<small class="comentario-corto" title="${esc(c.ultimoComentario)}">${esc(c.ultimoComentario)}</small>` : ""
  }`;
}

function detalleEstado(c: Phoenix.ClienteFila): string {
  if (c.estado === "COMPROMISO" && c.fechaCompromiso) {
    return `<small class="${c.compromisoVencido ? "texto-alerta" : ""}">${c.compromisoVencido ? "Venció" : "Paga"} ${fechaCalendario(c.fechaCompromiso)}</small>`;
  }
  if (c.proximaGestion) return `<small class="${c.proximaGestion <= hoyLocal() ? "texto-alerta" : ""}">Agendado ${fechaCalendario(c.proximaGestion)}</small>`;
  return "";
}

function botonLlamar(c: Phoenix.ClienteFila, compacto = false): string {
  const validos = c.telefonos.filter((t) => t.valido);
  if (!validos.length) return `<span class="bajada">${c.telefonos.length ? "Teléfonos erróneos" : "Sin teléfono"}</span>`;
  const t = validos[0];
  return `<button class="btn-llamar" data-numero="${esc(t.numero)}" data-cliente="${esc(c.id)}" title="Llamar a ${esc(t.numero)} desde Phoenix Mobile" aria-label="Llamar a ${esc(t.numero)}">
      ${ICONO_TEL}${compacto ? "" : `<span>${esc(t.numero)}</span>`}</button>${!compacto && validos.length > 1 ? `<small>+${validos.length - 1} más</small>` : ""}`;
}

function filaTabla(c: Phoenix.ClienteFila): string {
  return `<tr data-id="${esc(c.id)}" class="${seleccion.has(c.id) ? "seleccionada" : ""} ${fichaActual?.id === c.id ? "abierta" : ""}">
      <td class="col-check"><input type="checkbox" class="sel-fila" aria-label="Seleccionar ${esc(c.nombre)}" ${seleccion.has(c.id) ? "checked" : ""}></td>
      <td><div class="celda-cliente"><span class="mini-avatar tono-${esc(tonoDe(c.estado))}">${esc(iniciales(c.nombre))}</span>
        <span><span class="nombre-cliente">${esc(c.nombre)}</span><small>${esc(rutCompleto(c.rut, c.dv))}${c.comuna ? ` · ${esc(c.comuna)}` : ""}</small></span></div></td>
      <td>${etiquetaEstado(c.estado)}${detalleEstado(c)}</td>
      <td class="num"><b>${pesos(c.deuda)}</b>${c.montoRecuperado > 0 ? `<small class="positivo">${pesos(c.montoRecuperado)} recuperado</small>` : ""}</td>
      <td class="num">${c.diasMora === null ? "—" : `${numero(c.diasMora)} d`}<small>${esc(c.tramo ?? "")}</small></td>
      <td class="col-prioridad">${etiquetaPrioridad(c.prioridad, c.nivelPrioridad)}</td>
      <td class="col-gestion">${celdaUltimaGestion(c)}</td>
      <td class="col-telefono">${botonLlamar(c)}</td>
    </tr>`;
}

function tarjetaCliente(c: Phoenix.ClienteFila, i: number): string {
  const pct = c.deuda > 0 ? Math.min(100, (c.montoRecuperado / c.deuda) * 100) : 0;
  return `<article class="tarjeta-cliente ${seleccion.has(c.id) ? "seleccionada" : ""} ${fichaActual?.id === c.id ? "abierta" : ""}" data-id="${esc(c.id)}" style="--i:${Math.min(i, 24)}" tabindex="0" aria-label="${esc(c.nombre)}">
      <label class="tc-check"><input type="checkbox" class="sel-fila" aria-label="Seleccionar ${esc(c.nombre)}" ${seleccion.has(c.id) ? "checked" : ""}></label>
      <div class="tc-placa tono-${esc(tonoDe(c.estado))}"><span>${esc(iniciales(c.nombre))}</span>
        <span class="tc-prioridad p-${c.nivelPrioridad}" title="Prioridad ${c.prioridad} de 100">${c.prioridad}</span></div>
      <div class="tc-cuerpo">
        <h3>${esc(c.nombre)}</h3>
        <p class="tc-rut">${esc(rutCompleto(c.rut, c.dv))}${c.comuna ? ` · ${esc(c.comuna)}` : ""}</p>
        <p class="tc-deuda"><b>${pesos(c.deuda)}</b><span>${c.diasMora === null ? "" : `${numero(c.diasMora)} días`}</span></p>
        <span class="tc-barra" title="${numero(pct, 1)} % recuperado"><i style="--p:${pct}%"></i></span>
        <div class="tc-pie">${etiquetaEstado(c.estado)}${botonLlamar(c, true)}</div>
      </div>
    </article>`;
}

function aplicarVistaCartera(): void {
  const tarjetas = vistaCartera === "tarjetas";
  $("contenedor-tabla").hidden = tarjetas;
  $("grid-clientes").hidden = !tarjetas;
  $("vista-tabla").setAttribute("aria-pressed", String(!tarjetas));
  $("vista-tarjetas").setAttribute("aria-pressed", String(tarjetas));
}

async function cargarClientes(): Promise<void> {
  const cuerpo = document.querySelector("#tabla-clientes tbody")!;
  const rejilla = $("grid-clientes");
  try {
    const r = await Api.clientes(filtro);
    ultimaPagina = r;
    filtro.pagina = r.pagina;
    pintarChipsEstado(r.conteoEstados);
    const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
    $("clientes-resumen").innerHTML = `<b>${numero(r.total)}</b> ${r.total === 1 ? "cliente" : "clientes"} · deuda <b>${pesos(r.sumaDeuda)}</b>`;
    $("pag-info").textContent = `Página ${r.pagina} de ${paginas}`;
    $boton("pag-anterior").disabled = r.pagina <= 1;
    $boton("pag-siguiente").disabled = r.pagina >= paginas;
    const vacio = filtro.texto || (filtro.estados ?? []).length || filtrosAvanzadosActivos() || filtro.rapido
      ? "Ningún cliente calza con estos filtros. Prueba limpiándolos."
      : "No hay clientes en este mes. Importa un archivo de cartera.";
    cuerpo.innerHTML = r.filas.length ? r.filas.map(filaTabla).join("") : filaVacia(8, vacio);
    rejilla.classList.toggle("animar", animarTarjetas && vistaCartera === "tarjetas");
    if (vistaCartera === "tarjetas") animarTarjetas = false;
    rejilla.innerHTML = r.filas.length ? r.filas.map(tarjetaCliente).join("") : `<p class="sin-datos">${esc(vacio)}</p>`;
    actualizarBarraSeleccion();
    actualizarNavFicha();
  } catch (e) {
    cuerpo.innerHTML = filaVacia(8, (e as Error).message);
    rejilla.innerHTML = `<p class="sin-datos">${esc((e as Error).message)}</p>`;
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

function alternarSeleccion(id: string, marcado: boolean): void {
  if (marcado) seleccion.add(id);
  else seleccion.delete(id);
  document.querySelectorAll<HTMLElement>(`[data-id="${CSS.escape(id)}"]`).forEach((el) => {
    el.classList.toggle("seleccionada", marcado);
    const cb = el.querySelector<HTMLInputElement>(".sel-fila");
    if (cb) cb.checked = marcado;
  });
  actualizarBarraSeleccion();
}

async function aplicarEstadoMasivo(estado: Phoenix.CodigoEstado, comentario: string | null, fecha: string | null, proxima: string | null): Promise<void> {
  const ids = [...seleccion];
  const r = await intentar(() => Api.gestionar({ clienteIds: ids, estado, comentario, fechaCompromiso: fecha, proximaGestion: proxima }));
  if (!r) return;
  aviso(`${numero(r.actualizados)} ${r.actualizados === 1 ? "cliente quedó" : "clientes quedaron"} en «${nombreEstado(estado)}».`, "ok");
  seleccion.clear();
  await cargarClientes();
  if (fichaActual && ids.includes(fichaActual.id)) void abrirFicha(fichaActual.id);
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

async function copiarTexto(texto: string, que: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const t = document.createElement("textarea");
    t.value = texto;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  aviso(`${que} copiado: ${texto}`, "ok");
}

let cierreFicha: number | undefined;
/** Elemento que tenía el foco al abrir la ficha (se le devuelve al cerrar). */
let origenFicha: HTMLElement | null = null;

function cerrarFicha(): void {
  const ficha = document.getElementById("ficha");
  if (!ficha || ficha.hidden) {
    fichaActual = null;
    return;
  }
  fichaActual = null;
  ficha.classList.remove("abierta");
  $("velo-ficha").classList.remove("visible");
  document.querySelectorAll(".abierta[data-id]").forEach((el) => el.classList.remove("abierta"));
  clearTimeout(cierreFicha);
  const fin = () => {
    if (!ficha.classList.contains("abierta")) {
      ficha.hidden = true;
      $("velo-ficha").hidden = true;
    }
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) fin();
  else cierreFicha = window.setTimeout(fin, 210);
  if (ficha.contains(document.activeElement) && origenFicha?.isConnected) origenFicha.focus({ preventScroll: true });
  origenFicha = null;
}

function mostrarPanelFicha(): void {
  clearTimeout(cierreFicha);
  const ficha = $("ficha");
  if (!ficha.hidden && ficha.classList.contains("abierta")) return;
  origenFicha = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  ficha.hidden = false;
  $("velo-ficha").hidden = false;
  void ficha.offsetWidth;
  ficha.classList.add("abierta");
  $("velo-ficha").classList.add("visible");
}

/** Posición del cliente abierto en la página actual (para anterior/siguiente). */
function posicionEnLista(): number {
  return fichaActual ? (ultimaPagina?.filas ?? []).findIndex((f) => f.id === fichaActual!.id) : -1;
}

function actualizarNavFicha(): void {
  const i = posicionEnLista();
  const n = ultimaPagina?.filas.length ?? 0;
  $boton("ficha-anterior").disabled = i <= 0;
  $boton("ficha-siguiente").disabled = i < 0 || i >= n - 1;
  $("ficha-posicion").textContent = i >= 0 ? `${numero(i + 1)} de ${numero(n)}` : "";
}

function moverFicha(paso: number): void {
  const i = posicionEnLista();
  const filas = ultimaPagina?.filas ?? [];
  const destino = filas[i + paso];
  if (i >= 0 && destino) void abrirFicha(destino.id);
}

/** Abre (o recarga) la ficha de un cliente. Funciona desde cualquier vista. */
async function abrirFicha(clienteId: string): Promise<void> {
  const cuerpo = $("ficha-cuerpo");
  const otro = fichaActual?.id !== clienteId;
  mostrarPanelFicha();
  if (otro) {
    cuerpo.innerHTML = `<div class="ficha-esqueleto" aria-busy="true"><span></span><span></span><span></span><span></span></div>`;
    filtroHistorial = "";
  }
  try {
    const c = await Api.detalle(clienteId);
    fichaActual = c;
    pintarFicha(c, otro);
    // Teclado: el foco entra a la ficha para que Tab recorra sus acciones.
    if (otro && !$("ficha").contains(document.activeElement)) $("ficha-titulo").focus({ preventScroll: true });
    document.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => el.classList.toggle("abierta", el.dataset.id === c.id));
    actualizarNavFicha();
  } catch (e) {
    cuerpo.innerHTML = `<p class="sin-datos">${esc((e as Error).message)}</p>`;
  }
}

function textoGestion(g: Phoenix.Gestion): string {
  if (g.tipo === "llamada") {
    const res = textoLlamada(g.resultado, g.motivoLlamada, g.duracion);
    return `Llamada a ${esc(g.telefono ?? "")}: <span class="resultado ${res.clase}">${esc(res.texto)}</span>`;
  }
  if (g.resultado === "reverso_pago") return `Se revierte pago de ${pesos(Math.abs(g.monto ?? 0))}`;
  const partes: string[] = [];
  if (g.estadoAnterior && g.estadoNuevo) partes.push(`${etiquetaEstado(g.estadoAnterior)} <svg class="flecha-n" aria-hidden="true"><use href="#i-flecha"/></svg> ${etiquetaEstado(g.estadoNuevo)}`);
  else if (g.estadoNuevo) partes.push(etiquetaEstado(g.estadoNuevo));
  if (g.fechaCompromiso) partes.push(`<span>paga el ${fechaCalendario(g.fechaCompromiso)}</span>`);
  if (g.monto && g.monto > 0) partes.push(`<span class="positivo">${pesos(g.monto)}</span>`);
  if (g.proximaGestion) partes.push(`<span>próxima gestión ${fechaCalendario(g.proximaGestion)}</span>`);
  return partes.join(" ") || "Comentario";
}

function avisoRecordatorioFicha(clienteId: string): string {
  const r = listaRecordatorios.find((x) => x.clienteId === clienteId);
  if (!r) return "";
  const c = cuandoRecordatorio(r.fechaHora);
  const vencido = r.fechaHora <= fechaHoraLocalTexto();
  return `<p class="banda-ficha recordatorio ${vencido ? "vencido" : ""}"><svg aria-hidden="true"><use href="#i-campana"/></svg><span>${vencido ? "Recordatorio vencido" : "Recordatorio"}: ${esc(c.dia)} a las ${esc(c.hora)} · ${esc(r.motivo)}</span></p>`;
}

function historialFicha(c: Phoenix.DetalleCliente): string {
  const lista = c.gestiones.filter((g) => !filtroHistorial || g.tipo === filtroHistorial);
  const cuenta = (t: Phoenix.TipoGestion) => c.gestiones.filter((g) => g.tipo === t).length;
  const opciones: Array<[string, string, number]> = [
    ["", "Todo", c.gestiones.length],
    ["llamada", "Llamadas", cuenta("llamada")],
    ["cambio_estado", "Estados", cuenta("cambio_estado")],
    ["comentario", "Comentarios", cuenta("comentario")],
  ];
  return `<div class="filtro-historial" role="group" aria-label="Filtrar historial">${opciones
      .map(([v, t, n]) => `<button class="chip" data-historial="${v}" aria-pressed="${v === filtroHistorial}">${t} <b>${numero(n)}</b></button>`)
      .join("")}</div>
    <ol class="linea-tiempo">${
      lista
        .map(
          (g) => `<li class="lt-${g.tipo}">
            <span class="lt-marca"><svg aria-hidden="true"><use href="#${g.tipo === "llamada" ? "i-cola" : g.tipo === "cambio_estado" ? "i-flecha" : "i-lapiz"}"/></svg></span>
            <div class="lt-cuerpo">
              <div class="lt-cab"><time>${fechaHora(g.fecha)}</time>${g.usuario ? `<span>${esc(g.usuario)}</span>` : ""}</div>
              <div class="lt-accion">${textoGestion(g)}</div>
              ${g.comentario && g.tipo !== "llamada" ? `<p class="lt-comentario">${esc(g.comentario)}</p>` : ""}
            </div></li>`
        )
        .join("") || `<li class="lt-vacio">${filtroHistorial ? "Nada de este tipo todavía." : "Aún no hay gestiones este mes."}</li>`
    }${!filtroHistorial && c.textoGestionImportada ? `<li class="lt-importada"><span class="lt-marca"><svg aria-hidden="true"><use href="#i-importar"/></svg></span><div class="lt-cuerpo"><div class="lt-cab"><span>Gestión anterior (del archivo importado)</span></div><p class="lt-comentario">${esc(c.textoGestionImportada)}</p></div></li>` : ""}</ol>`;
}

function formularioGestion(c: Phoenix.DetalleCliente): string {
  return `<form class="form-gestion" id="form-gestion">
      <fieldset class="estados-grilla" aria-label="Nuevo estado">
        <legend>Nuevo estado</legend>
        <label class="estado-opcion sin-cambio"><input type="radio" name="estado" value="" checked><span>Sólo comentario</span></label>
        ${App.estados
          .map(
            (e) => `<label class="estado-opcion tono-${e.tono} ${e.codigo === c.estado ? "actual" : ""}" title="${esc(e.descripcion)}${e.codigo === c.estado ? " (estado actual)" : ""}">
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
      <div class="form-acciones"><span class="bajada"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> para guardar</span><button class="btn-n primario" type="submit"><svg aria-hidden="true"><use href="#i-check"/></svg>Guardar gestión</button></div>
    </form>`;
}

function pintarFicha(c: Phoenix.DetalleCliente, nueva: boolean): void {
  const saldo = Math.max(0, c.deuda - c.montoRecuperado);
  const pctRec = c.deuda > 0 ? Math.min(100, (c.montoRecuperado / c.deuda) * 100) : 0;
  const tono = tonoDe(c.estado);
  const validos = c.telefonos.filter((t) => t.valido);
  const llamadas = c.gestiones.filter((g) => g.tipo === "llamada");
  const contestadas = llamadas.filter((g) => g.motivoLlamada === "contestada" || g.resultado === "contestada").length;
  const nivel = { alta: "Prioridad alta", media: "Prioridad media", baja: "Prioridad baja" }[c.nivelPrioridad];
  const rut = rutCompleto(c.rut, c.dv);

  $("ficha-cuerpo").innerHTML = `
    <header class="fn-cab ${nueva ? "entrando" : ""}">
      <div class="fn-avatar tono-${esc(tono)}">${esc(iniciales(c.nombre))}</div>
      <div class="fn-titulo">
        <h2 id="ficha-titulo" tabindex="-1">${esc(c.nombre)}</h2>
        <p><button class="copiable" data-copiar="${esc(rut)}" data-que="RUT" title="Copiar RUT">${esc(rut)}<svg aria-hidden="true"><use href="#i-copiar"/></svg></button>${c.comuna ? `<span>${esc(c.comuna)}</span>` : ""}</p>
        <div class="fn-etiquetas">${etiquetaEstado(c.estado)}<span class="chip-nivel p-${c.nivelPrioridad}">${nivel}</span>${c.categoriaImportada ? `<span class="chip-suave" title="Categoría del archivo importado">${esc(c.categoriaImportada)}</span>` : ""}</div>
      </div>
      <div class="fn-prioridad" title="Puntaje de prioridad ${c.prioridad} de 100">${anilloAvance(c.prioridad, { tamano: 76, grosor: 7, centro: String(c.prioridad), sub: "prioridad", clase: `p-${c.nivelPrioridad}` })}</div>
    </header>

    <div class="fn-acciones">
      ${validos.length ? `<button class="btn-n primario" data-llamar="${esc(validos[0].numero)}">${ICONO_TEL}Llamar ${esc(validos[0].numero)}</button>` : `<button class="btn-n primario" disabled>${ICONO_TEL}Sin teléfono válido</button>`}
      ${c.estado !== "EN_COLA" ? `<button class="btn-n secundario" data-enviar-cola><svg aria-hidden="true"><use href="#i-mas"/></svg>Enviar a la cola</button>` : `<span class="chip-suave en-cola">En la cola de llamadas</span>`}
      ${validos.length ? `<button class="icono-btn" data-copiar="${esc(validos[0].numero)}" data-que="Teléfono" aria-label="Copiar teléfono" title="Copiar teléfono"><svg aria-hidden="true"><use href="#i-copiar"/></svg></button>` : ""}
      ${c.correos.length ? `<button class="icono-btn" data-copiar="${esc(c.correos[0])}" data-que="Correo" aria-label="Copiar correo" title="Copiar correo"><svg aria-hidden="true"><use href="#i-correo"/></svg></button>` : ""}
    </div>

    ${c.estado === "COMPROMISO" && c.fechaCompromiso ? `<p class="banda-ficha ${c.compromisoVencido ? "vencido" : "compromiso"}"><svg aria-hidden="true"><use href="#i-calendario"/></svg><span>${c.compromisoVencido ? "Compromiso vencido" : "Compromiso de pago"}: ${fechaCalendario(c.fechaCompromiso)}${c.montoCompromiso ? ` por ${pesos(c.montoCompromiso)}` : ""}</span></p>` : ""}
    ${avisoRecordatorioFicha(c.id)}

    <div class="fn-cuerpo">
      <aside class="fn-lado">
        <dl class="fn-cifras">
          <div><dt>Deuda</dt><dd>${pesos(c.deuda)}</dd></div>
          <div><dt>Saldo</dt><dd>${pesos(saldo)}</dd></div>
          <div><dt>Mora</dt><dd>${c.diasMora === null ? "—" : `${numero(c.diasMora)} días`}</dd><small>${esc(c.tramo ?? "")}</small></div>
          <div><dt>Cuotas pagadas</dt><dd>${c.pctRecuperacion === null ? "—" : `${numero(c.pctRecuperacion, 1)} %`}</dd></div>
        </dl>
        <div class="fn-recupero">
          <p><span>Recuperado este mes</span><b class="positivo">${pesos(c.montoRecuperado)}</b></p>
          <span class="fn-barra"><i style="--p:${pctRec}%"></i></span>
          <small>${numero(pctRec, 1)} % de la deuda</small>
        </div>
        <dl class="fn-mini">
          <div><dt>Gestiones</dt><dd>${numero(c.totalGestiones)}</dd></div>
          <div><dt>Llamadas</dt><dd>${numero(llamadas.length)}</dd></div>
          <div><dt>Contestó</dt><dd>${numero(contestadas)}</dd></div>
          <div><dt>Última</dt><dd>${esc(c.ultimaGestion ? haceDias(c.diasSinGestion) : "nunca")}</dd></div>
        </dl>

        <section class="fn-seccion">
          <h3>Teléfonos</h3>
          <ul class="lista-telefonos">${
            c.telefonos
              .map(
                (t) => `<li class="${t.valido ? "" : "invalido"}">
                  <div><span class="tel-numero">${esc(t.numero)}</span>
                  <span class="tel-estado">${t.valido ? (t.intentos ? `${t.intentos} ${t.intentos === 1 ? "intento" : "intentos"}${t.estadoLlamada === "CONTACTADO" ? ", contestó" : t.estadoLlamada === "NO_CONTESTA" ? ", no contestó" : ""}` : "Sin llamar") : "Marcado como erróneo"}</span></div>
                  ${t.valido ? `<button class="icono-btn llamar" data-llamar="${esc(t.numero)}" aria-label="Llamar a ${esc(t.numero)}" title="Llamar">${ICONO_TEL}</button>` : ""}
                  <button class="btn-n texto pequeño" data-telefono="${esc(t.id)}" data-valido="${t.valido ? "0" : "1"}">${t.valido ? "Erróneo" : "Válido"}</button>
                </li>`
              )
              .join("") || `<li class="bajada">Sin teléfonos registrados.</li>`
          }</ul>
        </section>
        ${
          c.correos.length || c.direcciones.some((d) => d.direccion) || c.vehiculos.length
            ? `<section class="fn-seccion"><h3>Datos de contacto</h3><ul class="datos-contacto">
                ${c.correos.map((m) => `<li><svg aria-hidden="true"><use href="#i-correo"/></svg><span>${esc(m)}</span></li>`).join("")}
                ${c.direcciones.filter((d) => d.direccion).map((d) => `<li><svg aria-hidden="true"><use href="#i-pin"/></svg><span>${esc(d.direccion)}${d.comuna ? `, ${esc(d.comuna)}` : ""}</span></li>`).join("")}
                ${c.vehiculos.map((v) => `<li><svg aria-hidden="true"><use href="#i-auto"/></svg><span>${esc([v.marca, v.modelo].filter(Boolean).join(" ") || "Vehículo")}${v.patente ? ` · ${esc(v.patente)}` : ""}</span></li>`).join("")}
              </ul></section>`
            : ""
        }
      </aside>

      <div class="fn-principal">
        <div class="fn-tabs" role="tablist" aria-label="Ficha">
          <button role="tab" data-ficha-tab="gestion" aria-selected="${pestanaFicha === "gestion"}"><svg aria-hidden="true"><use href="#i-lapiz"/></svg>Registrar gestión</button>
          <button role="tab" data-ficha-tab="historial" aria-selected="${pestanaFicha === "historial"}"><svg aria-hidden="true"><use href="#i-reloj"/></svg>Historial <small>${numero(c.gestiones.length)}</small></button>
          <button role="tab" data-ficha-tab="operaciones" aria-selected="${pestanaFicha === "operaciones"}"><svg aria-hidden="true"><use href="#i-reportes"/></svg>Operaciones <small>${numero(c.operaciones.length)}</small></button>
        </div>
        <div class="fn-panel" data-ficha-panel="gestion" ${pestanaFicha === "gestion" ? "" : "hidden"}>${formularioGestion(c)}</div>
        <div class="fn-panel" data-ficha-panel="historial" id="ficha-historial" ${pestanaFicha === "historial" ? "" : "hidden"}>${historialFicha(c)}</div>
        <div class="fn-panel" data-ficha-panel="operaciones" ${pestanaFicha === "operaciones" ? "" : "hidden"}>${
          c.operaciones.length
            ? `<div class="tabla-n"><table class="tabla-compacta">
                <thead><tr><th>N°</th><th class="num">Deuda</th><th class="num">Cuota</th><th class="num">Pagadas</th><th class="num">Morosas</th><th>Vence</th><th>Últ. pago</th></tr></thead>
                <tbody>${c.operaciones
                  .map((o) => `<tr><td>${esc(o.numero)}</td><td class="num">${pesos(o.deuda)}</td><td class="num">${pesos(o.cuota)}</td>
                    <td class="num">${o.cuotasPagadas ?? "—"}${o.cuotasPactadas ? ` / ${o.cuotasPactadas}` : ""}</td><td class="num">${o.cuotasMorosas ?? "—"}</td>
                    <td>${o.fechaVencimiento ? fechaCalendario(o.fechaVencimiento) : "—"}</td><td>${o.fechaUltimoPago ? fechaCalendario(o.fechaUltimoPago) : "—"}</td></tr>`)
                  .join("")}</tbody></table></div>`
            : `<p class="sin-datos">El archivo importado no trae operaciones para este cliente.</p>`
        }</div>
      </div>
    </div>`;

  prepararFormGestion(c);
}

function elegirPestanaFicha(id: typeof pestanaFicha): void {
  pestanaFicha = id;
  document.querySelectorAll<HTMLElement>("[data-ficha-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.fichaTab === id)));
  document.querySelectorAll<HTMLElement>("[data-ficha-panel]").forEach((p) => {
    p.hidden = p.dataset.fichaPanel !== id;
    if (!p.hidden) {
      p.classList.remove("entrando");
      void p.offsetWidth;
      p.classList.add("entrando");
    }
  });
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
      await Promise.all([abrirFicha(c.id), vistaActual === "clientes" ? cargarClientes() : Promise.resolve()]);
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
  aplicarVistaCartera();
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
  ["vista-tabla", "vista-tarjetas"].forEach((id) =>
    $(id).addEventListener("click", () => {
      vistaCartera = id === "vista-tarjetas" ? "tarjetas" : "tabla";
      guardarLocal("nova-vista-cartera", vistaCartera);
      aplicarVistaCartera();
      if (vistaCartera === "tarjetas") {
        const rejilla = $("grid-clientes");
        rejilla.classList.remove("animar");
        void rejilla.offsetWidth;
        rejilla.classList.add("animar");
      }
    })
  );

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

  // Tabla y tarjetas: selección, llamar, abrir ficha.
  const alClic = (ev: Event) => {
    const t = ev.target as HTMLElement;
    const llamar = t.closest<HTMLButtonElement>(".btn-llamar");
    if (llamar) return void llamarCliente(llamar.dataset.numero!, llamar.dataset.cliente!, llamar);
    const item = t.closest<HTMLElement>("[data-id]");
    if (!item) return;
    const id = item.dataset.id!;
    if (t.closest(".col-check, .tc-check")) {
      const cb = item.querySelector<HTMLInputElement>(".sel-fila")!;
      if (t.tagName !== "INPUT") cb.checked = !cb.checked;
      alternarSeleccion(id, cb.checked);
      return;
    }
    void abrirFicha(id);
  };
  $("tabla-clientes").addEventListener("click", alClic);
  $("grid-clientes").addEventListener("click", alClic);
  $("grid-clientes").addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement;
    if ((ev.key === "Enter" || ev.key === " ") && t.classList.contains("tarjeta-cliente")) {
      ev.preventDefault();
      void abrirFicha(t.dataset.id!);
    }
  });
  $input("sel-pagina").addEventListener("change", (ev) => {
    const marcar = (ev.target as HTMLInputElement).checked;
    for (const f of ultimaPagina?.filas ?? []) alternarSeleccion(f.id, marcar);
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
  $("velo-ficha").addEventListener("click", cerrarFicha);
  $("ficha-anterior").addEventListener("click", () => moverFicha(-1));
  $("ficha-siguiente").addEventListener("click", () => moverFicha(1));
  $("ficha-cuerpo").addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-ficha-tab]");
    if (tab) return elegirPestanaFicha(tab.dataset.fichaTab as typeof pestanaFicha);
    const hist = t.closest<HTMLElement>("[data-historial]");
    if (hist && fichaActual) {
      filtroHistorial = (hist.dataset.historial ?? "") as typeof filtroHistorial;
      $("ficha-historial").innerHTML = historialFicha(fichaActual);
      return;
    }
    const copiar = t.closest<HTMLElement>("[data-copiar]");
    if (copiar) return void copiarTexto(copiar.dataset.copiar!, copiar.dataset.que ?? "Dato");
    const llamar = t.closest<HTMLButtonElement>("[data-llamar]");
    if (llamar && fichaActual) {
      await llamarCliente(llamar.dataset.llamar!, fichaActual.id, llamar);
      if (fichaActual) void abrirFicha(fichaActual.id);
      return;
    }
    if (t.closest("[data-enviar-cola]") && fichaActual) {
      const c = fichaActual;
      const b = t.closest<HTMLButtonElement>("[data-enviar-cola]");
      if (await intentar(() => Api.gestionar({ clienteIds: [c.id], estado: "EN_COLA" }), b)) {
        aviso(`${c.nombre} quedó en la cola de llamadas.`, "ok", { texto: "Ir a la cola", fn: () => irA("cola") });
        await Promise.all([abrirFicha(c.id), vistaActual === "clientes" ? cargarClientes() : Promise.resolve()]);
      }
      return;
    }
    const tel = t.closest<HTMLButtonElement>("[data-telefono]");
    if (tel && fichaActual) {
      const ok = await intentar(() => Api.marcarTelefono(tel.dataset.telefono!, tel.dataset.valido === "1"), tel);
      if (ok && fichaActual) {
        aviso(tel.dataset.valido === "1" ? "Teléfono marcado como válido." : "Teléfono marcado como erróneo: ya no entra a la cola.", "ok");
        await Promise.all([abrirFicha(fichaActual.id), vistaActual === "clientes" ? cargarClientes() : Promise.resolve()]);
      }
    }
  });
  document.addEventListener("keydown", (ev) => {
    const fichaAbierta = !$("ficha").hidden;
    const enCampo = !!(ev.target as HTMLElement).closest("input, textarea, select");
    if (ev.key === "Escape" && fichaAbierta && !document.querySelector("dialog[open]") && !$("panel-recordatorios").classList.contains("abierto")) cerrarFicha();
    if (fichaAbierta && ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault();
      moverFicha(ev.key === "ArrowUp" ? -1 : 1);
    }
    if (ev.key === "/" && vistaActual === "clientes" && !enCampo) {
      ev.preventDefault();
      $input("buscar-cliente").focus();
    }
  });
}

/** Al entrar a la vista. */
function entrarClientes(): void {
  animarTarjetas = true;
  aplicarVistaCartera();
  void cargarOpcionesFiltro();
  sincronizarControles();
  void cargarClientes();
}
