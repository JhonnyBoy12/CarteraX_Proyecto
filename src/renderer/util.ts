/**
 * @file util.ts (renderer)
 * @description Utilidades compartidas por las vistas: DOM, formatos
 * chilenos, avisos, diálogos y el catálogo de estados de cobranza.
 */

/** Elemento por id (lanza si no existe: error de maquetación). */
function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en index.html`);
  return el;
}
const $input = (id: string) => $(id) as HTMLInputElement;
const $select = (id: string) => $(id) as HTMLSelectElement;
const $boton = (id: string) => $(id) as HTMLButtonElement;

/** Escapa texto para insertarlo con innerHTML. */
function esc(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================== Formatos ==============================

function pesos(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return "$" + Math.round(n).toLocaleString("es-CL");
}

/** $1.250.000.000 → "$1.250 M"; $850.000 → "$850 mil". */
function pesosCorto(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return "$" + (n / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: a >= 100_000_000 ? 0 : 1 }) + " M";
  if (a >= 10_000) return "$" + Math.round(n / 1000).toLocaleString("es-CL") + " mil";
  return pesos(n);
}

function numero(n: number | null | undefined, decimales = 0): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("es-CL", { maximumFractionDigits: decimales });
}

function porcentaje(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${numero(n, n < 1 ? 2 : 1)} %`;
}

/** Marca UTC de SQLite → Date. */
function desdeUtc(texto: string): Date {
  return new Date(texto.includes("T") ? texto : texto.replace(" ", "T") + "Z");
}

function fechaHora(texto: string | null): string {
  if (!texto) return "—";
  const d = desdeUtc(texto);
  if (Number.isNaN(d.getTime())) return texto;
  return d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 'AAAA-MM-DD' → '30 dic 2026'. */
function fechaCalendario(texto: string | null): string {
  if (!texto) return "—";
  const [a, m, d] = texto.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}

/** Hoy en hora local 'AAAA-MM-DD'. */
function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "hace 3 días", "hoy", "nunca". */
function haceDias(dias: number | null): string {
  if (dias === null) return "nunca";
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

function segundos(s: number | null): string {
  if (s === null || s === undefined) return "";
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

function rutCompleto(rut: string, dv: string | null): string {
  const cuerpo = Number(rut).toLocaleString("es-CL");
  return dv ? `${cuerpo}-${dv}` : cuerpo;
}

/** Lee un monto escrito por el usuario ("1.500.000", "$ 250 mil" → número). */
function leerMonto(texto: string): number | null {
  const t = texto.trim().toLowerCase();
  if (!t) return null;
  const multiplicador = /\bm(m|illones?)?\b/.test(t) ? 1_000_000 : /\bmil\b/.test(t) ? 1000 : 1;
  const limpio = t.replace(/[^\d,]/g, "").replace(",", ".");
  const n = Number(limpio);
  return Number.isFinite(n) && limpio !== "" ? Math.round(n * multiplicador) : null;
}

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: number | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  };
}

// ============================== Avisos ==============================

/**
 * Aviso temporal abajo a la derecha.
 * @param accion Botón opcional dentro del aviso (ej. "Mostrar en carpeta").
 */
function aviso(mensaje: string, tipo: "info" | "ok" | "error" = "info", accion?: { texto: string; fn: () => void }): void {
  const el = document.createElement("div");
  el.className = `aviso ${tipo}`;
  el.setAttribute("role", tipo === "error" ? "alert" : "status");
  el.innerHTML = `<span>${esc(mensaje)}</span>`;
  if (accion) {
    const b = document.createElement("button");
    b.textContent = accion.texto;
    b.addEventListener("click", () => {
      accion.fn();
      el.remove();
    });
    el.appendChild(b);
  }
  $("avisos").appendChild(el);
  setTimeout(() => el.remove(), tipo === "error" ? 8000 : accion ? 7000 : 4000);
}

/** Aviso de archivo guardado con acceso directo a la carpeta. */
function avisoArchivo(r: Phoenix.ArchivoGuardado | null, texto = "Archivo guardado"): void {
  if (!r) return;
  aviso(`${texto}: ${r.ruta.split(/[\\/]/).pop()}`, "ok", { texto: "Mostrar en carpeta", fn: () => void Api.mostrarArchivo(r.ruta) });
}

/** Ejecuta una acción mostrando el error como aviso. Devuelve `null` si falló. */
async function intentar<T>(fn: () => Promise<T>, boton?: HTMLButtonElement | null): Promise<T | null> {
  if (boton) boton.disabled = true;
  try {
    return await fn();
  } catch (e) {
    aviso((e as Error).message, "error");
    return null;
  } finally {
    if (boton) boton.disabled = false;
  }
}

/** Diálogo de confirmación propio (no bloquea la ventana). */
function confirmar(titulo: string, detalle: string, textoAceptar = "Aceptar", peligro = false): Promise<boolean> {
  const dlg = $("dialogo-confirmar") as HTMLDialogElement;
  $("confirmar-titulo").textContent = titulo;
  $("confirmar-detalle").textContent = detalle;
  const aceptar = $boton("confirmar-aceptar");
  aceptar.textContent = textoAceptar;
  aceptar.className = `btn ${peligro ? "peligro" : "primario"}`;
  dlg.showModal();
  return new Promise((resolve) => {
    const cerrar = (valor: boolean) => {
      dlg.close();
      aceptar.removeEventListener("click", si);
      $("confirmar-cancelar").removeEventListener("click", no);
      resolve(valor);
    };
    const si = () => cerrar(true);
    const no = () => cerrar(false);
    aceptar.addEventListener("click", si);
    $("confirmar-cancelar").addEventListener("click", no);
    dlg.addEventListener("cancel", no, { once: true });
  });
}

// ============================ Estado global ============================

const App = {
  contexto: null as Phoenix.Contexto | null,
  estados: [] as Phoenix.EstadoCobranza[],
  porCodigo: new Map<string, Phoenix.EstadoCobranza>(),
  config: { metaMensual: 0, diasSinGestion: 7, inactividadMinutos: 30 } as Phoenix.ConfigApp,
};

function definirEstados(lista: Phoenix.EstadoCobranza[]): void {
  App.estados = lista;
  App.porCodigo = new Map(lista.map((e) => [e.codigo, e]));
}

function nombreEstado(codigo: string | null): string {
  return codigo ? App.porCodigo.get(codigo)?.nombre ?? codigo : "—";
}

/** Etiqueta de estado: punto de color + nombre. */
function etiquetaEstado(codigo: string | null, extra = ""): string {
  if (!codigo) return "";
  const e = App.porCodigo.get(codigo);
  return `<span class="estado-pill tono-${esc(e?.tono ?? "gris")}" title="${esc(e?.descripcion ?? "")}"><i></i>${esc(e?.nombre ?? codigo)}${extra}</span>`;
}

/** Barra de prioridad 0–100. */
function etiquetaPrioridad(score: number, nivel: Phoenix.NivelPrioridad): string {
  return `<span class="prioridad p-${nivel}" title="Prioridad ${score} de 100 (${nivel})"><b style="width:${score}%"></b><span>${score}</span></span>`;
}

/** Opciones <option> de estados (para selects). */
function opcionesEstados(seleccionado: string | null = null, excluir: string[] = []): string {
  return App.estados
    .filter((e) => !excluir.includes(e.codigo))
    .map((e) => `<option value="${e.codigo}" ${e.codigo === seleccionado ? "selected" : ""}>${esc(e.nombre)}</option>`)
    .join("");
}

function filaVacia(columnas: number, texto: string): string {
  return `<tr><td class="vacio-tabla" colspan="${columnas}">${esc(texto)}</td></tr>`;
}

// ============================ v0.3.1 ============================

/** Íconos SVG de la interfaz (un solo trazo, relleno con currentColor o clase). */
const ICONO = {
  rechazo: `<svg class="sev sev-rechazo" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 12.8-1.4 1.4L12 13.4l-2.8 2.8-1.4-1.4 2.8-2.8-2.8-2.8 1.4-1.4 2.8 2.8 2.8-2.8 1.4 1.4-2.8 2.8z"/></svg>`,
  aviso: `<svg class="sev sev-aviso" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 1 21h22zm1 15h-2v-2h2zm0-4h-2V9h2z"/></svg>`,
  ok: `<svg class="sev sev-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 14.5-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z"/></svg>`,
  flecha: `<svg class="ob-flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z"/></svg>`,
  campana: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg>`,
};

/** Cómo terminó una llamada: texto y color (gráfico del dashboard). */
const MOTIVOS: Record<Phoenix.MotivoLlamada, { nombre: string; color: string }> = {
  contestada: { nombre: "Contestó", color: "var(--positivo)" },
  no_contesta: { nombre: "No contesta", color: "var(--tono-ambar)" },
  ocupado: { nombre: "Ocupado / no estaba en línea", color: "var(--tono-celeste)" },
  rechazada: { nombre: "Rechazó la llamada", color: "var(--tono-violeta)" },
  apagado: { nombre: "Apagado o sin cobertura", color: "var(--tono-pizarra)" },
  inexistente: { nombre: "Número no existe", color: "var(--tono-rojo)" },
  cortada: { nombre: "Se cortó", color: "var(--tono-gris)" },
};
/** Motivos sin respuesta que el ejecutivo puede indicar. */
const MOTIVOS_SIN_RESPUESTA: Phoenix.MotivoLlamada[] = ["ocupado", "rechazada", "apagado", "inexistente"];

/** Texto y clase del resultado de una llamada registrada. */
function textoLlamada(resultado: string | null, motivo: Phoenix.MotivoLlamada | null, duracion: number | null): { texto: string; clase: string } {
  if (resultado === "error") return { texto: "no se pudo llamar", clase: "error" };
  if (!motivo && resultado === "enviada") return { texto: "sin confirmar", clase: "pendiente" };
  const m = motivo ?? (resultado === "contestada" ? "contestada" : resultado === "no contesta" ? "no_contesta" : null);
  if (!m) return { texto: resultado ?? "", clase: "" };
  const texto = m === "contestada" || m === "cortada" ? `${MOTIVOS[m].nombre.toLowerCase()}${duracion ? `, ${segundos(duracion)}` : ""}` : MOTIVOS[m].nombre.toLowerCase();
  // «advertencia» y no «aviso»: .aviso es la notificación flotante.
  return { texto, clase: m === "contestada" ? "ok" : m === "cortada" ? "cortada" : m === "inexistente" ? "error" : "advertencia" };
}

/** 'AAAA-MM-DDTHH:MM' local de una fecha. */
function fechaHoraLocalTexto(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 'AAAA-MM-DDTHH:MM' → "hoy 10:00", "mañana 10:00", "lun 2 nov, 10:00". */
function cuandoRecordatorio(fh: string): { dia: string; hora: string } {
  const [f, hora] = fh.split("T");
  const hoy = hoyLocal();
  const manana = fechaHoraLocalTexto(new Date(Date.now() + 86_400_000)).slice(0, 10);
  const ayer = fechaHoraLocalTexto(new Date(Date.now() - 86_400_000)).slice(0, 10);
  const [a, m, d] = f.split("-").map(Number);
  const dia = f === hoy ? "hoy" : f === manana ? "mañana" : f === ayer ? "ayer"
    : new Date(a, m - 1, d).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" });
  return { dia, hora };
}

/** Recordatorio sugerido por el estado (misma regla que el backend). */
function sugerirRecordatorio(estado: string | null, fechaCompromiso: string | null): Phoenix.NuevoRecordatorio | null {
  const regla = estado ? App.porCodigo.get(estado)?.recordatorio : undefined;
  if (!regla) return null;
  const ahora = new Date();
  if (regla.horas) return { fechaHora: fechaHoraLocalTexto(new Date(ahora.getTime() + regla.horas * 3_600_000)), motivo: regla.motivo };
  const base = regla.desde === "compromiso" && fechaCompromiso ? fechaCompromiso : hoyLocal();
  const [a, m, d] = base.split("-").map(Number);
  let fh = `${fechaHoraLocalTexto(new Date(a, m - 1, d + (regla.dias ?? 0))).slice(0, 10)}T${regla.hora ?? "10:00"}`;
  if (fh <= fechaHoraLocalTexto(ahora)) fh = fechaHoraLocalTexto(new Date(ahora.getTime() + 3_600_000));
  return { fechaHora: fh, motivo: regla.motivo };
}

/** Campo «Recordarme volver a gestionar» para los formularios de gestión. */
function campoRecordatorio(): string {
  return `<fieldset class="campo-recordatorio" data-recordatorio data-apagado>
      <label class="cr-activar"><input type="checkbox" name="rec-activo"> Recordarme volver a gestionar</label>
      <div class="cr-campos">
        <input type="datetime-local" name="rec-fecha" aria-label="Fecha y hora del recordatorio" min="${fechaHoraLocalTexto()}">
        <input type="text" name="rec-motivo" maxlength="200" aria-label="Qué hacer" placeholder="Qué hacer">
      </div>
      <p class="cr-nota" data-rec-nota>Sin estado nuevo no se agenda nada; puedes activarlo igual.</p>
    </fieldset>`;
}

/**
 * Conecta el campo de recordatorio: al cambiar el estado propone la hora
 * de la regla, salvo que el ejecutivo ya la haya cambiado.
 */
function conectarRecordatorio(
  form: HTMLFormElement,
  estado: () => string | null,
  compromiso: () => string | null,
  proxima: () => string | null = () => null
): () => void {
  const caja = form.querySelector<HTMLElement>("[data-recordatorio]")!;
  const activo = form.elements.namedItem("rec-activo") as HTMLInputElement;
  const fecha = form.elements.namedItem("rec-fecha") as HTMLInputElement;
  const motivo = form.elements.namedItem("rec-motivo") as HTMLInputElement;
  const nota = caja.querySelector<HTMLElement>("[data-rec-nota]")!;
  let tocado = false;
  fecha.addEventListener("input", () => (tocado = true));
  motivo.addEventListener("input", () => (tocado = true));
  activo.addEventListener("change", () => {
    tocado = true;
    caja.toggleAttribute("data-apagado", !activo.checked);
    if (activo.checked && !fecha.value) {
      const s = sugerirRecordatorio(estado(), compromiso()) ?? { fechaHora: fechaHoraLocalTexto(new Date(Date.now() + 86_400_000)).slice(0, 10) + "T10:00", motivo: "Volver a gestionar" };
      fecha.value = s.fechaHora;
      motivo.value = s.motivo ?? "";
    }
  });
  return () => {
    if (tocado) return;
    let s = sugerirRecordatorio(estado(), compromiso());
    const p = proxima();
    if (p) {
      const regla = App.porCodigo.get(estado() ?? "")?.recordatorio;
      s = { fechaHora: `${p}T${regla?.hora ?? "09:00"}`, motivo: s?.motivo ?? "Gestión agendada" };
    }
    activo.checked = !!s;
    caja.toggleAttribute("data-apagado", !s);
    fecha.value = s?.fechaHora ?? "";
    motivo.value = s?.motivo ?? "";
    const e = estado();
    nota.textContent = s
      ? `Sugerido para «${nombreEstado(e)}». Te avisaré a esa hora.`
      : e
        ? `«${nombreEstado(e)}» no requiere volver a gestionar; puedes activarlo igual.`
        : "Guardar una gestión da por cumplidos los recordatorios del cliente.";
  };
}

/**
 * Recordatorio a enviar: datos si está activo, `null` si el ejecutivo lo
 * desactivó. (Con el campo intacto también se envía lo que muestra.)
 */
function leerRecordatorio(form: HTMLFormElement): Phoenix.NuevoRecordatorio | null {
  const activo = (form.elements.namedItem("rec-activo") as HTMLInputElement | null)?.checked;
  const fecha = (form.elements.namedItem("rec-fecha") as HTMLInputElement | null)?.value ?? "";
  if (!activo || !fecha) return null;
  return { fechaHora: fecha.slice(0, 16), motivo: (form.elements.namedItem("rec-motivo") as HTMLInputElement).value || null };
}

/**
 * Diálogo «Cómo terminó la llamada». Devuelve el motivo y la duración en
 * segundos (null = no se indicó) o `null` si se canceló.
 */
function preguntarResultadoLlamada(
  detalle: string,
  inicial: Phoenix.MotivoLlamada | null,
  duracion: number | null
): Promise<{ motivo: Phoenix.MotivoLlamada; duracion: number | null } | null> {
  const dlg = $("dialogo-llamada") as HTMLDialogElement;
  const sel = $select("llamada-motivo");
  sel.innerHTML = (Object.keys(MOTIVOS) as Phoenix.MotivoLlamada[])
    .map((m) => `<option value="${m}" ${m === inicial ? "selected" : ""}>${esc(MOTIVOS[m].nombre)}</option>`)
    .join("");
  $("llamada-detalle").textContent = detalle;
  $input("llamada-min").value = duracion ? String(Math.floor(duracion / 60)) : "";
  $input("llamada-seg").value = duracion ? String(duracion % 60) : "";
  const sincronizar = () => {
    $("llamada-campo-duracion").hidden = !["contestada", "cortada"].includes(sel.value);
  };
  sel.onchange = sincronizar;
  sincronizar();
  dlg.showModal();
  return new Promise((resolve) => {
    const form = $("form-llamada") as HTMLFormElement;
    const cerrar = (valor: { motivo: Phoenix.MotivoLlamada; duracion: number | null } | null) => {
      form.removeEventListener("submit", enviar);
      $("llamada-cancelar").removeEventListener("click", cancelar);
      dlg.close();
      resolve(valor);
    };
    const enviar = (ev: Event) => {
      ev.preventDefault();
      const min = $input("llamada-min").value;
      const seg = $input("llamada-seg").value;
      const hablada = ["contestada", "cortada"].includes(sel.value);
      cerrar({
        motivo: sel.value as Phoenix.MotivoLlamada,
        duracion: hablada && (min || seg) ? Math.max(0, Number(min || 0) * 60 + Number(seg || 0)) : hablada ? null : 0,
      });
    };
    const cancelar = () => cerrar(null);
    form.addEventListener("submit", enviar);
    $("llamada-cancelar").addEventListener("click", cancelar);
    dlg.addEventListener("cancel", cancelar, { once: true });
  });
}

/**
 * Fila de la tabla de llamadas (cola y teléfono) con su corrección.
 * @param enCurso La llamada que la cola tiene abierta: no se corrige aquí.
 */
function filaLlamada(l: Phoenix.LlamadaRegistrada, enCurso = false): string {
  const r = enCurso ? { texto: "en curso", clase: "pendiente" } : textoLlamada(l.resultado, l.motivo_llamada, l.duracion);
  const corregible = l.resultado !== "error" && !enCurso;
  return `<tr><td class="sin-corte">${fechaHora(l.fecha)}</td><td>${esc(l.nombre_cliente ?? "Llamada manual")}</td>
    <td class="sin-corte">${esc(l.telefono ?? "")}</td>
    <td><span class="resultado ${r.clase}">${esc(r.texto)}</span>${
      corregible
        ? `<button class="btn-corregir" data-corregir-llamada="${esc(l.id)}" data-motivo="${esc(l.motivo_llamada ?? "")}" data-duracion="${l.duracion ?? ""}" data-numero="${esc(l.telefono ?? "")}" title="Corregir cómo terminó">Corregir</button>`
        : ""
    }</td>
    <td class="num">${l.duracion ? segundos(l.duracion) : ""}</td></tr>`;
}

/** Atiende los botones «Corregir» de una tabla de llamadas. */
function conectarCorreccionLlamadas(tabla: HTMLElement, alTerminar: () => void): void {
  tabla.addEventListener("click", async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-corregir-llamada]");
    if (!b) return;
    const r = await preguntarResultadoLlamada(
      `Llamada a ${b.dataset.numero || "este número"}.`,
      (b.dataset.motivo as Phoenix.MotivoLlamada) || null,
      b.dataset.duracion ? Number(b.dataset.duracion) : null
    );
    if (!r) return;
    const ok = await intentar(() => Api.corregirLlamada(b.dataset.corregirLlamada!, r.motivo, r.duracion));
    if (ok) {
      aviso(r.motivo === "inexistente" ? "Resultado corregido. Ese número salió de la cola." : "Resultado de la llamada corregido.", "ok");
      alTerminar();
    }
  });
}
