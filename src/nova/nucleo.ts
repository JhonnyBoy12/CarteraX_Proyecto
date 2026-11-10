/**
 * @file nucleo.ts (Nova)
 * @description Arranque de la interfaz Nova: sesión (RF-01, RF-03), login,
 * selector de mes, navegación, tema, menú de perfil, paleta de búsqueda y
 * cierre por inactividad (RNF-07). Se compila al final del paquete.
 */

let vistaActual = "dashboard";

const ENTRADAS: Record<string, () => void> = {
  dashboard: () => void cargarDashboard(),
  clientes: entrarClientes,
  cola: entrarCola,
  reportes: () => void cargarReportes(),
  importar: entrarImportar,
  telefono: entrarTelefono,
  config: () => {
    void cargarConfig();
    sincronizarTemaAjustes();
  },
};

const NOMBRES_VISTA: Record<string, string> = {
  dashboard: "Inicio",
  clientes: "Cartera",
  cola: "Cola de llamadas",
  reportes: "Reportes",
  importar: "Importar cartera",
  telefono: "Teléfono",
  config: "Ajustes",
};

function irA(vista: string): void {
  if (!ENTRADAS[vista]) return;
  const cambia = vistaActual !== vista;
  vistaActual = vista;
  document.querySelectorAll<HTMLElement>(".vista").forEach((v) => {
    const visible = v.dataset.vista === vista;
    v.hidden = !visible;
    if (visible && cambia) {
      v.classList.remove("entrando");
      void v.offsetWidth;
      v.classList.add("entrando");
    }
  });
  document.querySelectorAll<HTMLElement>(".menu-item").forEach((b) => {
    const activo = b.dataset.ir === vista;
    b.classList.toggle("activo", activo);
    if (activo) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("miga-vista").textContent = NOMBRES_VISTA[vista] ?? vista;
  $("miga-extra").textContent = "";
  cerrarMenuPerfil();
  if (cambia) cerrarFicha();
  $("contenido").scrollTo({ top: 0 });
  ENTRADAS[vista]();
}

function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : p[0]?.[1] ?? "")).toUpperCase() || "··";
}

/** Aplica el contexto (usuario y mes) a toda la interfaz. */
function aplicarContexto(ctx: Phoenix.Contexto): void {
  const cambioMes = App.contexto?.periodo.id !== ctx.periodo.id;
  App.contexto = ctx;
  const nombre = `${ctx.usuario.nombre} ${ctx.usuario.apellido}`.trim();
  $("usuario-nombre").textContent = nombre;
  $("usuario-email").textContent = ctx.usuario.email;
  $("perfil-nombre-2").textContent = nombre;
  $("perfil-email-2").textContent = ctx.usuario.email;
  $("perfil-avatar").textContent = iniciales(nombre);
  $("perfil-avatar-2").textContent = iniciales(nombre);
  $("lateral-mes").textContent = ctx.periodo.nombre;
  $("nav-cuenta-clientes").textContent = ctx.periodo.clientes ? numero(ctx.periodo.clientes) : "";
  const sel = $select("selector-mes");
  sel.innerHTML = ctx.periodos
    .map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.esActual ? " · actual" : ""}${p.clientes ? ` · ${numero(p.clientes)} clientes` : ""}</option>`)
    .join("");
  sel.value = ctx.periodo.id;
  $("aviso-mes-cerrado").hidden = ctx.periodo.esActual;
  $("aviso-mes-cerrado").textContent = `Estás trabajando en ${ctx.periodo.nombre}, un mes anterior. Los cambios quedan en ese mes.`;
  if (cambioMes) {
    seleccion.clear();
    cerrarFicha();
    $input("importar-mes").value = ctx.periodo.id;
  }
}

// ============================ Tema ============================

function temaActual(): "oscuro" | "claro" {
  return document.documentElement.dataset.tema === "claro" ? "claro" : "oscuro";
}

function aplicarTema(tema: "oscuro" | "claro", guardar = true): void {
  document.documentElement.dataset.tema = tema;
  if (guardar) {
    try {
      localStorage.setItem("nova-tema", tema);
    } catch {
      /* sin almacenamiento local */
    }
  }
  const icono = tema === "oscuro" ? "#i-sol" : "#i-luna";
  $("btn-tema").innerHTML = `<svg aria-hidden="true"><use href="${icono}"/></svg>`;
  $("btn-tema").setAttribute("aria-label", tema === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
  $("btn-tema-menu").querySelector("span")!.textContent = tema === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  sincronizarTemaAjustes();
}

/** Cambia el tema con un fundido nativo cuando el navegador lo permite. */
function cambiarTemaSuave(tema: "oscuro" | "claro"): void {
  if (tema === temaActual()) return;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !REDUCIR_MOVIMIENTO.matches) doc.startViewTransition(() => aplicarTema(tema));
  else aplicarTema(tema);
}

function alternarTema(): void {
  cambiarTemaSuave(temaActual() === "oscuro" ? "claro" : "oscuro");
}

function sincronizarTemaAjustes(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-tema-elegir]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.temaElegir === temaActual())));
}

function cargarTemaGuardado(): void {
  let t: string | null = null;
  try {
    t = localStorage.getItem("nova-tema");
  } catch {
    /* sin almacenamiento local */
  }
  aplicarTema(t === "claro" ? "claro" : "oscuro", false);
}

// ============================ Menú de perfil ============================

function cerrarMenuPerfil(): void {
  $("menu-perfil").hidden = true;
  $("btn-perfil").setAttribute("aria-expanded", "false");
}

function abrirMenuPerfil(): void {
  const k = ultimoDashboard?.kpis;
  $("perfil-cifras").innerHTML = k
    ? `<div title="Gestiones registradas hoy"><dt>Gestiones</dt><dd>${numero(k.gestionesHoy)}</dd></div>
       <div title="Llamadas de hoy"><dt>Llamadas</dt><dd>${numero(k.llamadasHoy)}</dd></div>
       <div title="Avance de la meta de recuperación del mes"><dt>Meta</dt><dd>${k.pctMeta === null ? "—" : porcentaje(k.pctMeta)}</dd></div>`
    : "";
  $("menu-perfil").hidden = false;
  $("btn-perfil").setAttribute("aria-expanded", "true");
  $("menu-perfil").querySelector<HTMLElement>(".mp-item")?.focus();
}

// ============================ Paleta de búsqueda ============================

interface ItemPaleta {
  tipo: "cliente" | "accion";
  titulo: string;
  detalle: string;
  icono: string;
  hacer: () => void;
}

let itemsPaleta: ItemPaleta[] = [];
let indicePaleta = 0;
let consultaPaleta = 0;

function accionesPaleta(): ItemPaleta[] {
  const ir = (v: string, icono: string, detalle: string): ItemPaleta => ({ tipo: "accion", titulo: `Ir a ${NOMBRES_VISTA[v]}`, detalle, icono, hacer: () => irA(v) });
  return [
    ir("dashboard", "i-inicio", "Resumen, actividad, metas y categorías"),
    ir("clientes", "i-cartera", "Listado y filtros de la cartera"),
    ir("cola", "i-cola", "Llamar en cola con Phoenix Mobile"),
    ir("reportes", "i-reportes", "Reportes guardados del mes"),
    ir("importar", "i-importar", "Cargar un Excel o CSV"),
    ir("telefono", "i-telefono", "Vincular Phoenix Mobile"),
    ir("config", "i-ajustes", "Metas, contraseña y respaldo"),
    { tipo: "accion", titulo: "Abrir recordatorios", detalle: "Vueltas de gestión pendientes", icono: "i-campana", hacer: () => void abrirRecordatorios() },
    { tipo: "accion", titulo: "Guardar reporte del mes", detalle: "Fotografía de la cartera", icono: "i-guardar", hacer: () => abrirDialogoReporte() },
    { tipo: "accion", titulo: temaActual() === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro", detalle: "Apariencia", icono: temaActual() === "oscuro" ? "i-sol" : "i-luna", hacer: alternarTema },
    { tipo: "accion", titulo: "Editar metas personales", detalle: "Llamadas, gestiones y contactabilidad", icono: "i-meta", hacer: () => abrirDialogoMetas() },
  ];
}

function pintarPaleta(): void {
  const lista = $("paleta-lista");
  if (!itemsPaleta.length) {
    lista.innerHTML = `<li class="paleta-vacia">Sin resultados.</li>`;
    return;
  }
  let grupo = "";
  lista.innerHTML = itemsPaleta
    .map((it, i) => {
      const titulo = it.tipo === "cliente" ? "Clientes" : "Acciones";
      const cab = titulo !== grupo ? `<li class="paleta-grupo" role="presentation">${titulo}</li>` : "";
      grupo = titulo;
      return `${cab}<li role="option" id="po-${i}" class="paleta-item" data-i="${i}" aria-selected="${i === indicePaleta}">
        <span class="pi-icono ${it.tipo}">${it.tipo === "cliente" ? esc(iniciales(it.titulo)) : `<svg aria-hidden="true"><use href="#${it.icono}"/></svg>`}</span>
        <span class="pi-textos"><b>${esc(it.titulo)}</b><small>${it.detalle}</small></span>
        <svg class="pi-flecha" aria-hidden="true"><use href="#i-flecha"/></svg></li>`;
    })
    .join("");
  $input("paleta-texto").setAttribute("aria-activedescendant", `po-${indicePaleta}`);
  document.getElementById(`po-${indicePaleta}`)?.scrollIntoView({ block: "nearest" });
}

async function buscarPaleta(texto: string): Promise<void> {
  const consulta = ++consultaPaleta;
  const t = texto.trim().toLowerCase();
  const acciones = accionesPaleta().filter((a) => !t || a.titulo.toLowerCase().includes(t) || a.detalle.toLowerCase().includes(t));
  let clientes: ItemPaleta[] = [];
  if (t.length >= 2 && App.contexto) {
    try {
      const r = await Api.clientes({ texto, orden: "prioridad", porPagina: 7, pagina: 1 });
      clientes = r.filas.map((c) => ({
        tipo: "cliente" as const,
        titulo: c.nombre,
        detalle: `${esc(rutCompleto(c.rut, c.dv))} · ${pesos(c.deuda)} · ${esc(nombreEstado(c.estado))}`,
        icono: "",
        hacer: () => void abrirFicha(c.id),
      }));
    } catch {
      /* sin cartera */
    }
  }
  if (consulta !== consultaPaleta) return;
  itemsPaleta = [...clientes, ...acciones];
  indicePaleta = 0;
  pintarPaleta();
}

function abrirPaleta(): void {
  if (!App.contexto) return;
  cerrarMenuPerfil();
  const dlg = $("paleta") as HTMLDialogElement;
  if (dlg.open) return;
  $input("paleta-texto").value = "";
  void buscarPaleta("");
  dlg.showModal();
  $input("paleta-texto").focus();
}

function ejecutarPaleta(i: number): void {
  const it = itemsPaleta[i];
  if (!it) return;
  ($("paleta") as HTMLDialogElement).close();
  it.hacer();
}

function prepararPaleta(): void {
  $("btn-paleta").addEventListener("click", abrirPaleta);
  $("btn-paleta-menu").addEventListener("click", abrirPaleta);
  const entrada = $input("paleta-texto");
  entrada.addEventListener("input", debounce(() => void buscarPaleta(entrada.value), 160));
  entrada.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!itemsPaleta.length) return;
      indicePaleta = (indicePaleta + (ev.key === "ArrowDown" ? 1 : -1) + itemsPaleta.length) % itemsPaleta.length;
      pintarPaleta();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      ejecutarPaleta(indicePaleta);
    }
  });
  $("paleta-lista").addEventListener("click", (ev) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li) ejecutarPaleta(Number(li.dataset.i));
  });
  $("paleta").addEventListener("click", (ev) => {
    if (ev.target === ev.currentTarget) ($("paleta") as HTMLDialogElement).close();
  });
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
      ev.preventDefault();
      abrirPaleta();
    }
  });
}

// ============================ Sesión ============================

let temporizadorInactividad: number | undefined;

function reiniciarInactividad(): void {
  clearTimeout(temporizadorInactividad);
  if (!App.contexto) return;
  temporizadorInactividad = window.setTimeout(async () => {
    if (estadoCola?.activa) return reiniciarInactividad(); // no cortar una cola en marcha
    await Api.logout("inactividad").catch(() => undefined);
    mostrarLogin("Tu sesión se cerró por inactividad. Vuelve a ingresar.");
  }, Math.max(5, App.config.inactividadMinutos) * 60_000);
}

function correoRecordado(): string {
  try {
    return localStorage.getItem("nova-correo") ?? "";
  } catch {
    return "";
  }
}

function mostrarLogin(mensaje?: string): void {
  App.contexto = null;
  clearTimeout(temporizadorInactividad);
  detenerRecordatorios();
  cerrarLlamadaManual();
  cerrarFicha();
  if (temporizadorCola !== null) {
    clearInterval(temporizadorCola);
    temporizadorCola = null;
  }
  document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((d) => d.close());
  $("aplicacion").hidden = true;
  $("pantalla-login").hidden = false;
  $input("login-password").value = "";
  const recordado = correoRecordado();
  if (recordado) $input("login-email").value = recordado;
  $input("login-recordar").checked = !!recordado;
  const info = $("login-error");
  info.hidden = !mensaje;
  info.textContent = mensaje ?? "";
  (recordado ? $input("login-password") : $input("login-email")).focus();
}

async function entrarAplicacion(ctx: Phoenix.Contexto): Promise<void> {
  definirEstados(await Api.estados());
  App.config = await Api.config();
  App.contexto = null;
  aplicarContexto(ctx);
  $("pantalla-login").hidden = true;
  $("aplicacion").hidden = false;
  reiniciarInactividad();
  irA(ctx.periodo.clientes > 0 ? "dashboard" : "importar");
  void comprobarMovil();
  void Api.cola().then(mostrarCola).catch(() => undefined);
  iniciarRecordatorios();
}

function prepararSesion(): void {
  const form = $("form-login") as HTMLFormElement;
  const clave = $input("login-password");
  const boton = $boton("login-entrar");

  $("login-ver").addEventListener("click", () => {
    const ver = clave.type === "password";
    clave.type = ver ? "text" : "password";
    $("login-ver").setAttribute("aria-pressed", String(ver));
    $("login-ver").setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
    $("login-ver").innerHTML = `<svg aria-hidden="true"><use href="${ver ? "#i-ojo-no" : "#i-ojo"}"/></svg>`;
    clave.focus();
  });
  const mayus = (ev: KeyboardEvent) => {
    if (typeof ev.getModifierState === "function") $("login-mayus").hidden = !ev.getModifierState("CapsLock");
  };
  clave.addEventListener("keydown", mayus);
  clave.addEventListener("keyup", mayus);
  clave.addEventListener("blur", () => ($("login-mayus").hidden = true));

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const error = $("login-error");
    error.hidden = true;
    const email = $input("login-email").value.trim();
    if (!email || !clave.value) {
      error.textContent = "Escribe tu correo y tu contraseña.";
      error.hidden = false;
      form.classList.remove("sacudir");
      void form.offsetWidth;
      form.classList.add("sacudir");
      return;
    }
    boton.disabled = true;
    boton.classList.add("cargando");
    try {
      const ctx = await Api.login(email, clave.value);
      clave.value = "";
      try {
        if ($input("login-recordar").checked) localStorage.setItem("nova-correo", email);
        else localStorage.removeItem("nova-correo");
      } catch {
        /* sin almacenamiento local */
      }
      await entrarAplicacion(ctx);
      if (ctx.cierresGenerados > 0) {
        aviso(`Se guardó el cierre de ${ctx.cierresGenerados === 1 ? "1 mes terminado" : `${ctx.cierresGenerados} meses terminados`}.`, "ok", {
          texto: "Ver reportes",
          fn: () => irA("reportes"),
        });
      }
    } catch (e) {
      error.textContent = (e as Error).message;
      error.hidden = false;
      form.classList.remove("sacudir");
      void form.offsetWidth;
      form.classList.add("sacudir");
    } finally {
      boton.disabled = false;
      boton.classList.remove("cargando");
    }
  });

  $("btn-cerrar-sesion").addEventListener("click", async () => {
    cerrarMenuPerfil();
    if (estadoCola?.activa && !(await confirmar("Cerrar sesión", "La cola de llamadas está en marcha y se detendrá.", "Cerrar sesión"))) return;
    await Api.logout().catch(() => undefined);
    mostrarLogin();
  });

  alExpirarSesion = () => {
    if (App.contexto) mostrarLogin("Tu sesión expiró. Vuelve a ingresar.");
  };
  ["pointerdown", "keydown", "wheel"].forEach((t) => document.addEventListener(t, debounce(reiniciarInactividad, 1000), { passive: true }));
}

/** Indicador de fuerza de la nueva contraseña (sólo orientativo). */
function prepararFuerzaClave(): void {
  const entrada = $input("pwd-nueva");
  const caja = $("pwd-fuerza");
  entrada.addEventListener("input", () => {
    const v = entrada.value;
    const puntos = [v.length >= 8, /[a-záéíóúñ]/i.test(v) && /\d/.test(v), v.length >= 12, /[^a-z0-9áéíóúñ]/i.test(v)].filter(Boolean).length;
    caja.dataset.nivel = v ? String(puntos) : "";
    caja.querySelector("small")!.textContent = v ? ["Muy débil", "Débil", "Aceptable", "Buena", "Muy buena"][puntos] : "";
  });
  $("form-password").addEventListener("reset", () => {
    caja.dataset.nivel = "";
    caja.querySelector("small")!.textContent = "";
  });
}

// ============================ Inicio ============================

async function iniciar(): Promise<void> {
  cargarTemaGuardado();
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const destino = t.closest<HTMLElement>("[data-ir]");
    if (destino) irA(destino.dataset.ir!);
    if (!t.closest(".perfil-n")) cerrarMenuPerfil();
  });
  $select("selector-mes").addEventListener("change", async (ev) => {
    const ctx = await intentar(() => Api.cambiarPeriodo((ev.target as HTMLSelectElement).value));
    if (!ctx) return;
    aplicarContexto(ctx);
    aviso(`Ahora trabajas en ${ctx.periodo.nombre}.`);
    irA(vistaActual);
    iniciarRecordatorios();
  });
  $("btn-tema").addEventListener("click", alternarTema);
  $("btn-tema-menu").addEventListener("click", () => {
    alternarTema();
    cerrarMenuPerfil();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tema-elegir]").forEach((b) =>
    b.addEventListener("click", () => cambiarTemaSuave(b.dataset.temaElegir === "claro" ? "claro" : "oscuro"))
  );
  $("btn-perfil").addEventListener("click", () => ($("menu-perfil").hidden ? abrirMenuPerfil() : cerrarMenuPerfil()));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("menu-perfil").hidden) {
      cerrarMenuPerfil();
      $("btn-perfil").focus();
    }
  });

  prepararSesion();
  prepararDashboard();
  prepararClientes();
  prepararCola();
  prepararReportes();
  prepararImportar();
  prepararTelefono();
  prepararConfig();
  prepararFuerzaClave();
  prepararRecordatorios();
  prepararPaleta();
  prepararMovimientoNova();

  try {
    const ctx = await Api.sesion();
    if (ctx) await entrarAplicacion(ctx);
    else mostrarLogin();
  } catch (e) {
    mostrarLogin((e as Error).message);
  }

  // Mantiene al día el indicador del teléfono.
  setInterval(() => {
    if (App.contexto) void comprobarMovil();
  }, 30_000);
}

void iniciar();
