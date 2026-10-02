/**
 * @file renderer.ts
 * @description Lógica de la interfaz (FRONTEND). Usa el objeto global `Api`
 * definido en `api.ts`, por lo que funciona igual dentro de Electron que en
 * un navegador conectado al servidor HTTP.
 *
 * Organización (cada bloque corresponde a una vista de index.html):
 *  - Utilidades: escape HTML, formatos, avisos, navegación.
 *  - Panel:      cargarResumen (v0.1.0, ampliada), pintarFranjaTramos.
 *  - Importar:   seleccionarArchivo, mostrarPrevia, confirmarImportacion.
 *  - Clientes:   cargarClientes, llamarCliente.
 *  - Teléfono:   cargarMovil, probarConexionMovil, cargarLlamadas.
 *  - Historial:  cargarHistorial (v0.1.0).
 *  - Servidor:   cargarServidor, guardarServidor.
 *
 * v0.2.0: reescrito para el nuevo diseño. Todo texto que viene de los
 * archivos importados pasa por `esc()` antes de insertarse en el HTML
 * (la v0.1.0 lo insertaba sin escapar).
 */

// =====================================================================
// Utilidades
// =====================================================================

/** Atajo para obtener un elemento por id (lanza si no existe). */
function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en index.html`);
  return el;
}

/**
 * Escapa texto para insertarlo de forma segura con innerHTML.
 * @param valor Cualquier valor (null/undefined → "").
 */
function esc(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formato peso chileno sin decimales: 1234567 → "$1.234.567". (v0.1.0 ampliada) */
function formatoMoneda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  return "$" + valor.toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

/** Formato numérico chileno: 12345 → "12.345". */
function formatoNumero(valor: number | null | undefined, decimales = 0): string {
  if (valor === null || valor === undefined) return "—";
  return valor.toLocaleString("es-CL", { maximumFractionDigits: decimales, minimumFractionDigits: 0 });
}

/** Monto abreviado para la cifra grande: 1.250.000.000 → "$1.250 M". */
function formatoMontoCorto(valor: number): string {
  if (Math.abs(valor) >= 1_000_000) return "$" + formatoNumero(valor / 1_000_000, 1) + " M";
  return formatoMoneda(valor);
}

/**
 * Fecha SQLite UTC ("2026-09-03 20:01:44") → texto local "03-09-2026 17:01".
 * @param texto Fecha guardada por CURRENT_TIMESTAMP.
 */
function formatoFecha(texto: string | null): string {
  if (!texto) return "—";
  const d = new Date(texto.replace(" ", "T") + (texto.includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return texto;
  return d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Muestra un aviso temporal abajo a la derecha.
 * @param mensaje Texto a mostrar.
 * @param tipo "info" | "ok" | "error".
 */
function aviso(mensaje: string, tipo: "info" | "ok" | "error" = "info"): void {
  const el = document.createElement("div");
  el.className = `aviso ${tipo}`;
  el.textContent = mensaje;
  $("avisos").appendChild(el);
  setTimeout(() => el.remove(), tipo === "error" ? 7000 : 4000);
}

/** Fila de "sin datos" para una tabla. */
function filaVacia(columnas: number, texto: string): string {
  return `<tr><td class="vacio-tabla" colspan="${columnas}">${esc(texto)}</td></tr>`;
}

/** Vista visible actualmente. */
let vistaActual = "panel";

/**
 * Cambia de vista y carga sus datos.
 * @param vista Valor de `data-vista` de la sección destino.
 */
function irA(vista: string): void {
  vistaActual = vista;
  document.querySelectorAll<HTMLElement>(".vista").forEach((v) => v.classList.toggle("activa", v.dataset.vista === vista));
  document.querySelectorAll<HTMLElement>(".menu-item").forEach((b) => b.classList.toggle("activo", b.dataset.ir === vista));
  $("panel-datos").closest(".contenido")?.scrollTo({ top: 0 });

  const cargas: Record<string, () => unknown> = {
    panel: cargarResumen,
    clientes: cargarClientes,
    telefono: () => { cargarMovil(); cargarLlamadas(); cargarColaLlamadas(); },
    historial: cargarHistorial,
    servidor: cargarServidor,
  };
  cargas[vista]?.();
}

// =====================================================================
// Panel
// =====================================================================

/** Escala de la franja (de mora reciente a antigua). Mismos tonos que --mora-1..5 en styles.css. */
const ESCALA_MORA = ["#fbd9bc", "#f6a766", "#e8630a", "#b5470a", "#7a2e0b"];

/**
 * Color interpolado sobre ESCALA_MORA, para que cada tramo tenga un tono
 * propio aunque haya más de 5 tramos.
 * @param t Posición entre 0 (mora más reciente) y 1 (más antigua).
 */
function colorMora(t: number): string {
  const pos = Math.min(Math.max(t, 0), 1) * (ESCALA_MORA.length - 1);
  const i = Math.min(Math.floor(pos), ESCALA_MORA.length - 2);
  const f = pos - i;
  const a = ESCALA_MORA[i].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  const b = ESCALA_MORA[i + 1].match(/\w\w/g)!.map((h) => parseInt(h, 16));
  return "#" + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("");
}

/**
 * Ordena tramos de mora por el primer número que contienen
 * ("1-30" < "31-60" < "+360"); "(sin tramo)" queda al final.
 */
function ordenarTramos(tramos: Phoenix.TramoConteo[]): Phoenix.TramoConteo[] {
  const clave = (t: string) => {
    if (t === "(sin tramo)") return Number.MAX_SAFE_INTEGER;
    const m = t.match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER - 1;
  };
  return [...tramos].sort((a, b) => clave(a.tramo_mora) - clave(b.tramo_mora));
}

/**
 * Dibuja la franja de antigüedad de deuda y su leyenda.
 * @param tramos Deuda y clientes por tramo.
 */
function pintarFranjaTramos(tramos: Phoenix.TramoConteo[]): void {
  const ordenados = ordenarTramos(tramos);
  const conTramo = ordenados.filter((t) => t.tramo_mora !== "(sin tramo)");
  const usarDeuda = ordenados.some((t) => t.deuda > 0);
  const medida = (t: Phoenix.TramoConteo) => (usarDeuda ? t.deuda : t.total);
  const total = ordenados.reduce((s, t) => s + medida(t), 0) || 1;

  const color = (t: Phoenix.TramoConteo) => {
    if (t.tramo_mora === "(sin tramo)") return "#c9cfd4";
    const i = conTramo.indexOf(t);
    return colorMora(conTramo.length <= 1 ? 0.5 : i / (conTramo.length - 1));
  };

  $("franja-tramos").innerHTML = ordenados
    .map(
      (t) =>
        `<div class="franja-segmento" style="flex-grow:${medida(t) / total};background:${color(t)}"
              title="${esc(t.tramo_mora)}: ${formatoMoneda(t.deuda)} en ${t.total} clientes"></div>`
    )
    .join("");

  $("leyenda-tramos").innerHTML = ordenados
    .map(
      (t) =>
        `<li><i style="background:${color(t)}"></i>${esc(t.tramo_mora)}
           <b>${Math.round((medida(t) / total) * 100)}%</b></li>`
    )
    .join("");
}

/**
 * Carga KPIs, franja de mora, top de deuda y distribución por gestión.
 * (Nombre conservado de la v0.1.0.)
 */
async function cargarResumen(): Promise<void> {
  let resumen: Phoenix.ResumenCartera;
  try {
    resumen = await Api.resumen();
  } catch (e) {
    aviso(`No se pudo cargar el panel: ${(e as Error).message}`, "error");
    return;
  }

  const hayDatos = resumen.totalClientes > 0;
  $("panel-vacio").hidden = hayDatos;
  $("panel-datos").hidden = !hayDatos;
  if (!hayDatos) return;

  const k = resumen.indicadores;
  $("kpi-deuda").textContent = formatoMontoCorto(k?.deudaTotal ?? 0);
  $("kpi-deuda").title = formatoMoneda(k?.deudaTotal ?? 0);
  $("kpi-clientes").textContent = formatoNumero(resumen.totalClientes);
  $("kpi-mora").textContent = k?.moraPromedio != null ? `${formatoNumero(k.moraPromedio)} días` : "—";
  $("kpi-recuperacion").textContent = k?.recuperacionPromedio != null ? `${formatoNumero(k.recuperacionPromedio, 1)}%` : "—";
  $("kpi-telefono").textContent = formatoNumero(k?.clientesConTelefono ?? 0);
  $("kpi-llamadas").textContent = formatoNumero(k?.llamadasHoy ?? 0);
  $("panel-bajada").textContent = `${formatoNumero(resumen.totalClientes)} clientes de ${formatoNumero(k?.totalImportaciones ?? 0)} archivos importados.`;

  pintarFranjaTramos(resumen.tramos ?? []);

  document.querySelector("#tabla-top tbody")!.innerHTML = resumen.topDeuda
    .map(
      (c) => `
        <tr>
          <td class="sin-corte">${esc(c.rut)}</td>
          <td>${esc(c.nombre_cliente ?? "(sin nombre)")}</td>
          <td class="num sin-corte">${formatoMoneda(c.monto_deuda)}</td>
          <td class="num">${c.dias_mora ?? "—"}</td>
          <td>${etiquetaGestion(c.categoria_gestion)}</td>
        </tr>`
    )
    .join("");

  const maximo = Math.max(1, ...resumen.categorias.map((c) => c.total));
  $("barras-categorias").innerHTML = resumen.categorias
    .map(
      (c) => `
        <li>
          <span>${esc(c.categoria_gestion ?? "(sin categoría)")}</span>
          <span class="valor">${formatoNumero(c.total)}</span>
          <span class="pista"><span class="relleno" style="width:${(c.total / maximo) * 100}%"></span></span>
        </li>`
    )
    .join("");
}

/** Etiqueta de color según la categoría de gestión. */
function etiquetaGestion(categoria: string | null): string {
  const clase =
    categoria === "pago realizado" ? "ok" : categoria === "sin contacto" ? "error" : categoria === "en negociacion" ? "naranja" : "";
  return `<span class="etiqueta ${clase}">${esc(categoria ?? "—")}</span>`;
}

// =====================================================================
// Importar (cargador CSV / XLSX)
// =====================================================================

/** Archivo elegido y su vista previa, mientras el usuario decide importar. */
let archivoElegido: ArchivoSeleccionado | null = null;
let previaActual: Phoenix.PreviaArchivo | null = null;

/** Nombre legible del separador detectado. */
function nombreSeparador(sep?: string): string {
  return ({ ";": "punto y coma", ",": "coma", "\t": "tabulador", "|": "barra vertical" } as Record<string, string>)[sep ?? ""] ?? sep ?? "";
}

/**
 * Procesa el archivo elegido (botón o arrastrar): pide la vista previa.
 * @param archivo Archivo elegido.
 */
async function seleccionarArchivo(archivo: ArchivoSeleccionado): Promise<void> {
  archivoElegido = archivo;
  $("resultado-importacion").hidden = true;
  $("previa").hidden = false;
  $("zona-carga").classList.add("compacta");
  $("previa-nombre").textContent = archivo.nombre;
  $("previa-meta").textContent = "Leyendo archivo…";
  $("previa-pestanas").innerHTML = "";
  $("previa-hoja").innerHTML = "";
  ($("btn-confirmar-importacion") as HTMLButtonElement).disabled = true;

  try {
    previaActual = await Api.previsualizar(archivo);
    mostrarPrevia(previaActual);
  } catch (e) {
    $("previa-meta").textContent = "";
    $("previa-hoja").innerHTML = `<div class="ficha-movil" data-estado="error"><p class="ficha-titulo">No se pudo leer el archivo</p><p class="bajada">${esc((e as Error).message)}</p></div>`;
  }
}

/**
 * Muestra el resumen del archivo y las pestañas por hoja.
 * @param previa Resultado de `Api.previsualizar`.
 */
function mostrarPrevia(previa: Phoenix.PreviaArchivo): void {
  const totalFilas = previa.hojas.reduce((s, h) => s + h.totalFilas, 0);
  const sinRut = previa.hojas.reduce((s, h) => s + h.filasSinRut, 0);

  const partes = [previa.formato.toUpperCase()];
  if (previa.separador) partes.push(`separado por ${nombreSeparador(previa.separador)}`);
  if (previa.codificacion) partes.push(`codificación ${previa.codificacion}`);
  partes.push(`${formatoNumero(totalFilas)} filas en ${previa.hojas.length} ${previa.hojas.length === 1 ? "tabla" : "hojas"}`);
  $("previa-meta").textContent = partes.join(", ");

  const boton = $("btn-confirmar-importacion") as HTMLButtonElement;
  const aCargar = totalFilas - sinRut;
  boton.disabled = aCargar <= 0;
  boton.textContent = aCargar > 0 ? `Importar ${formatoNumero(aCargar)} clientes` : "No hay filas con RUT";

  $("previa-pestanas").innerHTML = previa.hojas
    .map(
      (h, i) =>
        `<button class="pestana ${i === 0 ? "activa" : ""}" role="tab" data-indice="${i}">${esc(h.hoja)}<small>${formatoNumero(h.totalFilas)}</small></button>`
    )
    .join("");

  if (previa.hojas.length === 0) {
    $("previa-hoja").innerHTML = `<p class="bajada">El archivo no contiene filas con datos.</p>`;
    return;
  }
  pintarHojaPrevia(previa.hojas[0]);
}

/**
 * Pinta columnas reconocidas y filas de muestra de una hoja.
 * @param hoja Hoja a mostrar.
 */
function pintarHojaPrevia(hoja: Phoenix.PreviaHoja): void {
  const reconocidas = hoja.columnas.filter((c) => c.campo).length;
  const tieneRut = hoja.columnas.some((c) => c.campo === "rut");

  const avisoRut = tieneRut
    ? hoja.filasSinRut > 0
      ? `<span><b>${formatoNumero(hoja.filasSinRut)}</b> filas sin RUT se omitirán</span>`
      : ""
    : `<span class="etiqueta error">No se encontró una columna de RUT: esta hoja no cargará clientes</span>`;

  const columnas = hoja.columnas
    .map((c) =>
      c.campo
        ? `<span class="columna reconocida">${esc(c.original)}<span class="campo-destino">${esc(c.campo)}</span></span>`
        : `<span class="columna ignorada">${esc(c.original)}</span>`
    )
    .join("");

  const encabezados = hoja.columnas.map((c) => `<th>${esc(c.original)}</th>`).join("");
  const filas = hoja.muestra
    .map((f) => `<tr>${hoja.columnas.map((c) => `<td>${esc(f[c.original])}</td>`).join("")}</tr>`)
    .join("");

  $("previa-hoja").innerHTML = `
    <div class="resumen-hoja">
      <span><b>${formatoNumero(hoja.totalFilas)}</b> filas</span>
      <span><b>${reconocidas}</b> de ${hoja.columnas.length} columnas reconocidas</span>
      ${avisoRut}
    </div>
    <p class="leyenda-columnas">En verde, las columnas que se cargan y el campo que alimentan. En gris, las que se ignoran (se pueden agregar en <code>mapeoColumnas.ts</code>).</p>
    <div class="columnas">${columnas}</div>
    <div class="tabla-envoltura"><table class="tabla-muestra"><thead><tr>${encabezados}</tr></thead><tbody>${filas}</tbody></table></div>`;
}

/** Importa el archivo de la vista previa y muestra el resultado. */
async function confirmarImportacion(): Promise<void> {
  if (!archivoElegido) return;
  const boton = $("btn-confirmar-importacion") as HTMLButtonElement;
  boton.disabled = true;
  boton.textContent = "Importando…";

  try {
    const r = await Api.importar(archivoElegido);
    const cargados = r.hojas.reduce((s, h) => s + h.cargados, 0);
    const errores = r.hojas.reduce((s, h) => s + h.conError, 0);

    $("previa").hidden = true;
    $("zona-carga").classList.remove("compacta");
    const res = $("resultado-importacion");
    res.hidden = false;
    res.innerHTML = `
      <section class="bloque">
        <h2>${esc(r.archivo)} importado</h2>
        <p class="bajada">${formatoNumero(cargados)} clientes cargados${errores ? `, ${formatoNumero(errores)} filas con error u omitidas` : ""}.</p>
        <div class="tabla-envoltura">
          <table>
            <thead><tr><th>Hoja</th><th class="num">Cargados</th><th class="num">Corregidos</th><th class="num">Con error</th></tr></thead>
            <tbody>${r.hojas
              .map((h) => `<tr><td>${esc(h.hoja)}</td><td class="num">${formatoNumero(h.cargados)}</td><td class="num">${formatoNumero(h.corregidos)}</td><td class="num">${formatoNumero(h.conError)}</td></tr>`)
              .join("")}</tbody>
          </table>
        </div>
        <p class="acciones-cabecera separado">
          <button class="btn primario" data-ir="panel">Ver panel</button>
          <button class="btn secundario" data-ir="clientes">Ver clientes</button>
        </p>
      </section>`;
    aviso(`Importados ${formatoNumero(cargados)} clientes`, "ok");
    cargarCategorias();
    archivoElegido = null;
    previaActual = null;
  } catch (e) {
    aviso(`No se pudo importar: ${(e as Error).message}`, "error");
    boton.disabled = false;
    boton.textContent = "Reintentar importación";
  }
}

/** Configura la zona de carga: clic, teclado y arrastrar y soltar. */
function prepararZonaCarga(): void {
  const zona = $("zona-carga");
  const elegir = async () => {
    const a = await Api.elegirArchivo();
    if (a) seleccionarArchivo(a);
  };
  zona.addEventListener("click", elegir);
  zona.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(); }
  });

  // Arrastrar y soltar en cualquier parte de la ventana lleva a "Importar".
  window.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("encima"); });
  window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) zona.classList.remove("encima"); });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    zona.classList.remove("encima");
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (vistaActual !== "importar") irA("importar");
    seleccionarArchivo(Api.desdeArchivoSoltado(f));
  });

  $("btn-confirmar-importacion").addEventListener("click", confirmarImportacion);
  $("btn-cancelar-previa").addEventListener("click", () => {
    archivoElegido = null;
    $("previa").hidden = true;
    $("zona-carga").classList.remove("compacta");
    elegir();
  });
  $("previa-pestanas").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".pestana");
    if (!b || !previaActual) return;
    document.querySelectorAll(".pestana").forEach((p) => p.classList.toggle("activa", p === b));
    pintarHojaPrevia(previaActual.hojas[Number(b.dataset.indice)]);
  });
}

// =====================================================================
// Clientes
// =====================================================================

const filtroClientes: Phoenix.FiltroClientes = { texto: "", categoria: "", pagina: 1, porPagina: 50 };
let totalPaginas = 1;

/** Carga la página actual de clientes según el filtro. */
async function cargarClientes(): Promise<void> {
  const cuerpo = document.querySelector("#tabla-clientes tbody")!;
  try {
    const r = await Api.clientes(filtroClientes);
    totalPaginas = Math.max(1, Math.ceil(r.total / r.porPagina));
    $("pag-info").textContent = `Página ${r.pagina} de ${totalPaginas}, ${formatoNumero(r.total)} clientes`;
    ($("pag-anterior") as HTMLButtonElement).disabled = r.pagina <= 1;
    ($("pag-siguiente") as HTMLButtonElement).disabled = r.pagina >= totalPaginas;

    cuerpo.innerHTML = r.filas.length
      ? r.filas
          .map(
            (c) => `
        <tr>
          <td class="sin-corte">${esc(c.rut)}${c.dv ? "-" + esc(c.dv) : ""}</td>
          <td>${esc(c.nombre_cliente ?? "(sin nombre)")}<br><small class="bajada">${esc(c.comuna ?? "")}</small></td>
          <td class="num">${formatoMoneda(c.monto_deuda)}</td>
          <td class="num">${c.dias_mora ?? "—"}</td>
          <td class="sin-corte">${esc(c.tramo_mora ?? "—")}</td>
          <td>${etiquetaGestion(c.categoria_gestion)}</td>
          <td>${
            c.telefonos.length
              ? c.telefonos.map((t) => `<button class="fono" data-numero="${esc(t)}" data-cliente="${c.id}" title="Llamar desde Phoenix Mobile">${esc(t)}</button>`).join("")
              : `<span class="bajada">Sin teléfono</span>`
          }</td>
        </tr>`
          )
          .join("")
      : filaVacia(7, filtroClientes.texto ? "Ningún cliente coincide con la búsqueda." : "No hay clientes cargados. Importa un archivo de cartera.");
  } catch (e) {
    cuerpo.innerHTML = filaVacia(7, `Error: ${(e as Error).message}`);
  }
}

/** Llena el selector de categorías de gestión. */
async function cargarCategorias(): Promise<void> {
  try {
    const cats = await Api.categorias();
    const sel = $("filtro-categoria") as HTMLSelectElement;
    const actual = sel.value;
    sel.innerHTML = `<option value="">Todos los estados</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join("");
    sel.value = actual;
  } catch { /* el filtro es opcional */ }
}

/**
 * Llama a un número de un cliente a través de Phoenix Mobile.
 * @param numero Número tal como está guardado.
 * @param clienteId Cliente al que se asocia la gestión.
 * @param boton Botón pulsado (se deshabilita mientras se envía).
 */
async function llamarCliente(numero: string, clienteId: string | null, boton?: HTMLButtonElement): Promise<void> {
  if (boton) boton.disabled = true;
  try {
    const r = await Api.llamar(numero, clienteId);
    aviso(`Llamando a ${r.numero} desde el teléfono`, "ok");
  } catch (e) {
    aviso((e as Error).message, "error");
  } finally {
    if (boton) boton.disabled = false;
  }
}

/** Eventos de la vista Clientes (búsqueda con espera, filtros, paginación, llamadas). */
function prepararClientes(): void {
  let espera: number | undefined;
  $("buscar-cliente").addEventListener("input", (e) => {
    clearTimeout(espera);
    espera = window.setTimeout(() => {
      filtroClientes.texto = (e.target as HTMLInputElement).value;
      filtroClientes.pagina = 1;
      cargarClientes();
    }, 250);
  });
  $("filtro-categoria").addEventListener("change", (e) => {
    filtroClientes.categoria = (e.target as HTMLSelectElement).value;
    filtroClientes.pagina = 1;
    cargarClientes();
  });
  $("pag-anterior").addEventListener("click", () => { filtroClientes.pagina = Math.max(1, (filtroClientes.pagina ?? 1) - 1); cargarClientes(); });
  $("pag-siguiente").addEventListener("click", () => { filtroClientes.pagina = Math.min(totalPaginas, (filtroClientes.pagina ?? 1) + 1); cargarClientes(); });
  $("tabla-clientes").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".fono");
    if (b) llamarCliente(b.dataset.numero!, b.dataset.cliente!, b);
  });
}

// =====================================================================
// Teléfono (Phoenix Mobile)
// =====================================================================

/**
 * Actualiza la ficha de estado y el indicador de la barra lateral.
 * @param estado Resultado del ping o `null` si no hay IP configurada.
 */
function pintarEstadoMovil(estado: Phoenix.EstadoMovil | null): void {
  const ficha = $("ficha-movil");
  const lateral = $("estado-telefono");
  const textoLateral = lateral.querySelector(".estado-texto")!;

  if (!estado) {
    ficha.dataset.estado = "desconocido";
    $("movil-titulo").textContent = "Sin configurar";
    $("movil-detalle").textContent = "Escribe la IP y prueba la conexión.";
    lateral.dataset.estado = "";
    textoLateral.textContent = "Teléfono sin configurar";
    return;
  }

  if (estado.conectado) {
    ficha.dataset.estado = estado.permisoLlamadas ? "ok" : "error";
    $("movil-titulo").textContent = `Conectado a ${estado.dispositivo}`;
    $("movil-detalle").textContent = estado.permisoLlamadas
      ? `${estado.ip}:${estado.puerto}. Permiso de llamadas concedido.`
      : "Falta conceder el permiso de llamadas en Phoenix Mobile.";
    lateral.dataset.estado = estado.permisoLlamadas ? "ok" : "error";
    textoLateral.textContent = estado.dispositivo ?? "Teléfono conectado";
  } else {
    ficha.dataset.estado = "error";
    $("movil-titulo").textContent = "No conectado";
    $("movil-detalle").textContent = estado.detalle ?? "";
    lateral.dataset.estado = "error";
    textoLateral.textContent = "Teléfono no responde";
  }
}

/** Carga la IP guardada y prueba la conexión en segundo plano. */
async function cargarMovil(): Promise<void> {
  try {
    const { ip } = await Api.movil();
    const input = $("movil-ip") as HTMLInputElement;
    if (ip && !input.value) input.value = ip;
    if (!ip) return pintarEstadoMovil(null);
    pintarEstadoMovil(await Api.probarMovil());
  } catch (e) {
    aviso((e as Error).message, "error");
  }
}

/** Prueba la IP escrita (y la guarda si responde). */
async function probarConexionMovil(): Promise<void> {
  const ip = ($("movil-ip") as HTMLInputElement).value.trim();
  if (!ip) return aviso("Escribe la IP que muestra Phoenix Mobile.", "error");
  $("ficha-movil").dataset.estado = "cargando";
  $("movil-titulo").textContent = "Probando conexión…";
  $("movil-detalle").textContent = "";
  try {
    const estado = await Api.probarMovil(ip);
    pintarEstadoMovil(estado);
    if (estado.conectado) aviso("Teléfono conectado. La IP quedó guardada.", "ok");
  } catch (e) {
    aviso((e as Error).message, "error");
  }
}

/** Carga la tabla de últimas llamadas. */
async function cargarLlamadas(): Promise<void> {
  const cuerpo = document.querySelector("#tabla-llamadas tbody")!;
  try {
    const filas = await Api.llamadas();
    cuerpo.innerHTML = filas.length
      ? filas
          .map(
            (l) => `<tr>
              <td class="sin-corte">${formatoFecha(l.fecha)}</td>
              <td>${esc(l.nombre_cliente ?? l.rut ?? "Manual")}</td>
              <td>${esc(l.texto_libre)}</td>
              <td><span class="etiqueta ${l.resultado === "enviada" ? "ok" : "error"}">${esc(l.resultado)}</span></td>
            </tr>`
          )
          .join("")
      : filaVacia(4, "Todavía no hay llamadas registradas.");
  } catch (e) {
    cuerpo.innerHTML = filaVacia(4, `Error: ${(e as Error).message}`);
  }
}

/** Temporizador utilizado mientras el modo cola está activo. */
let temporizadorCola: ReturnType<typeof setInterval> | null = null;

/** Actualiza la información visible del proceso de cola. */
function mostrarEstadoCola(estado: Phoenix.EstadoColaLlamadas): void {
  const estadoTexto = estado.estadoProceso ?? "DETENIDA";
  $("cola-titulo").textContent = estado.activa
    ? `Cola activa · ${estadoTexto.replace(/_/g, " ")}`
    : `${formatoNumero(estado.pendientes)} teléfono(s) pendiente(s)`;

  if (estado.actual) {
    $("cola-detalle").textContent = `${estado.mensaje ?? "Llamada en proceso"} · ${estado.actual.nombreCliente} · ${estado.actual.numero}`;
  } else if (estado.mensaje) {
    $("cola-detalle").textContent = estado.mensaje;
  } else {
    $("cola-detalle").textContent = estado.siguiente
      ? `Siguiente: ${estado.siguiente.nombreCliente} · ${estado.siguiente.numero} · estado importado: ${estado.siguiente.estadoImportado ?? "sin estado"}`
      : "No quedan teléfonos elegibles para llamar.";
  }

  ($("btn-iniciar-cola") as HTMLButtonElement).disabled = Boolean(estado.activa) || !estado.siguiente;
  ($("btn-detener-cola") as HTMLButtonElement).disabled = !estado.activa;
}

/** Consulta el estado general de la cola. */
async function cargarColaLlamadas(): Promise<void> {
  try {
    mostrarEstadoCola(await Api.estadoCola());
  } catch (e) {
    $("cola-titulo").textContent = "No se pudo consultar la cola";
    $("cola-detalle").textContent = (e as Error).message;
  }
}

/** Sincroniza periódicamente la cola con el estado de la llamada del Android. */
async function sincronizarCola(): Promise<void> {
  try {
    const estado = await Api.actualizarCola();
    mostrarEstadoCola(estado);
    await cargarLlamadas();
    if (!estado.activa && temporizadorCola) {
      clearInterval(temporizadorCola);
      temporizadorCola = null;
    }
  } catch (e) {
    aviso((e as Error).message, "error");
  }
}

/** Inicia el modo automático de cola de llamadas. */
async function iniciarColaLlamadas(): Promise<void> {
  try {
    const estado = await Api.iniciarCola();
    mostrarEstadoCola(estado);
    if (!temporizadorCola) temporizadorCola = setInterval(() => void sincronizarCola(), 1200);
    aviso("Cola de llamadas iniciada.", "ok");
  } catch (e) {
    aviso((e as Error).message, "error");
    await cargarColaLlamadas();
  }
}

/** Detiene el modo cola por decisión del ejecutivo. */
async function detenerColaLlamadas(): Promise<void> {
  try {
    mostrarEstadoCola(await Api.detenerCola());
    if (temporizadorCola) clearInterval(temporizadorCola);
    temporizadorCola = null;
    aviso("Cola detenida.", "ok");
  } catch (e) {
    aviso((e as Error).message, "error");
  }
}

/** Eventos de la vista Teléfono. */
function prepararTelefono(): void {
  $("btn-probar-movil").addEventListener("click", probarConexionMovil);
  $("btn-iniciar-cola").addEventListener("click", iniciarColaLlamadas);
  $("btn-detener-cola").addEventListener("click", detenerColaLlamadas);
  $("movil-ip").addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") probarConexionMovil(); });
  $("btn-llamar-manual").addEventListener("click", async () => {
    const numero = ($("movil-numero") as HTMLInputElement).value.trim();
    if (!numero) return aviso("Escribe un número.", "error");
    await llamarCliente(numero, null, $("btn-llamar-manual") as HTMLButtonElement);
    cargarLlamadas();
  });
}

// =====================================================================
// Historial
// =====================================================================

/** Carga el historial de importaciones. (Nombre conservado de la v0.1.0.) */
async function cargarHistorial(): Promise<void> {
  const cuerpo = document.querySelector("#tabla-historial tbody")!;
  try {
    const historial = await Api.historial();
    cuerpo.innerHTML = historial.length
      ? historial
          .map(
            (h) => `
        <tr>
          <td class="sin-corte">${formatoFecha(h.fecha)}</td>
          <td>${esc(h.archivo_nombre)}</td>
          <td>${esc(h.hoja_nombre)}</td>
          <td class="num">${formatoNumero(h.registros_cargados)}</td>
          <td class="num">${formatoNumero(h.registros_corregidos)}</td>
          <td class="num">${formatoNumero(h.registros_con_error)}</td>
        </tr>`
          )
          .join("")
      : filaVacia(6, "Aún no se ha importado ningún archivo.");
  } catch (e) {
    cuerpo.innerHTML = filaVacia(6, `Error: ${(e as Error).message}`);
  }
}


/** Configura el borrado completo de datos importados para pruebas. */
function prepararHistorial(): void {
  $("btn-borrar-importaciones").addEventListener("click", async () => {
    if (Api.modo !== "electron") {
      aviso("El borrado de datos de prueba sólo está disponible en la app de escritorio.", "error");
      return;
    }

    const confirmado = window.confirm(
      "Se eliminarán todos los clientes, teléfonos, operaciones, gestiones e importaciones cargadas. La configuración de CarteraX se conservará. ¿Deseas continuar?"
    );
    if (!confirmado) return;

    try {
      const resultado = await Api.borrarDatosImportados();
      aviso(`Datos eliminados: ${resultado.clientesEliminados} clientes y ${resultado.importacionesEliminadas} importaciones.`, "ok");
      await cargarHistorial();
      await cargarResumen();
      await cargarCategorias();
    } catch (e) {
      aviso((e as Error).message, "error");
    }
  });
}

// =====================================================================
// Servidor
// =====================================================================

/**
 * Pinta el estado del servidor en la vista y en la barra lateral.
 * @param e Estado devuelto por el backend.
 */
function pintarEstadoServidor(e: Phoenix.EstadoServidor): void {
  const ficha = $("ficha-servidor");
  ficha.dataset.estado = e.activo ? "ok" : e.error ? "error" : "desconocido";
  $("servidor-titulo").textContent = e.activo
    ? `Activo en el puerto ${e.puerto}${e.accesoRed ? ", visible en la red local" : ", sólo este equipo"}`
    : e.error
      ? `Detenido: ${e.error}`
      : "Detenido";
  $("servidor-urls").innerHTML = e.urls.map((u) => `<li><a data-url="${esc(u)}">${esc(u)}</a></li>`).join("");

  ($("srv-habilitado") as HTMLInputElement).checked = e.habilitado;
  ($("srv-red") as HTMLInputElement).checked = e.accesoRed;
  ($("srv-puerto") as HTMLInputElement).value = String(e.puerto);

  const lateral = $("estado-servidor");
  lateral.dataset.estado = e.activo ? "ok" : e.error ? "error" : "";
  lateral.querySelector(".estado-texto")!.textContent = e.activo ? `Servidor en :${e.puerto}` : "Servidor detenido";
}

/** Consulta el estado del servidor. */
async function cargarServidor(): Promise<void> {
  try {
    pintarEstadoServidor(await Api.servidor());
  } catch (e) {
    $("servidor-titulo").textContent = (e as Error).message;
  }
}

/** Eventos de la vista Servidor. */
function prepararServidor(): void {
  const web = Api.modo === "web";
  if (web) {
    $("form-servidor").querySelectorAll("input, button").forEach((el) => ((el as HTMLInputElement).disabled = true));
    $("srv-nota").textContent = "Estás conectado desde un navegador. La configuración sólo se cambia desde la app de escritorio.";
  }

  $("form-servidor").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const e = await Api.configurarServidor({
        habilitado: ($("srv-habilitado") as HTMLInputElement).checked,
        accesoRed: ($("srv-red") as HTMLInputElement).checked,
        puerto: Number(($("srv-puerto") as HTMLInputElement).value),
      });
      pintarEstadoServidor(e);
      aviso(e.activo ? "Servidor reiniciado" : e.error ?? "Servidor detenido", e.error ? "error" : "ok");
    } catch (err) {
      aviso((err as Error).message, "error");
    }
  });

  $("servidor-urls").addEventListener("click", (ev) => {
    const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a[data-url]");
    if (a) Api.abrirExterno(a.dataset.url!).catch((e) => aviso(e.message, "error"));
  });
}

// =====================================================================
// Inicio
// =====================================================================

/** Conecta la navegación y carga los datos iniciales. */
function iniciar(): void {
  // Cualquier elemento con data-ir navega (menú, botones, indicadores).
  document.addEventListener("click", (e) => {
    const destino = (e.target as HTMLElement).closest<HTMLElement>("[data-ir]");
    if (destino) irA(destino.dataset.ir!);
  });
  $("btn-actualizar").addEventListener("click", () => { cargarResumen(); aviso("Panel actualizado"); });

  $("modo-app").textContent = Api.modo === "electron" ? "App de escritorio" : `Navegador conectado a ${location.host}`;

  prepararZonaCarga();
  prepararClientes();
  prepararTelefono();
  prepararHistorial();
  prepararServidor();

  cargarResumen();
  cargarCategorias();
  cargarServidor();
  cargarMovil();

  // Re-verifica el teléfono cada 30 s para mantener el indicador al día.
  setInterval(() => {
    Api.movil()
      .then(({ ip }) => (ip ? Api.probarMovil().then(pintarEstadoMovil) : undefined))
      .catch(() => undefined);
  }, 30_000);
}

iniciar();
