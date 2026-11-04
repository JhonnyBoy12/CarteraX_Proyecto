/**
 * @file app.ts
 * @description Arranque de la interfaz: sesión (RF-01, RF-03), selector
 * de mes, navegación entre vistas y cierre por inactividad (RNF-07).
 * Se carga al final, después de todas las vistas.
 */

let vistaActual = "dashboard";

const ENTRADAS: Record<string, () => void> = {
  dashboard: () => void cargarDashboard(),
  clientes: entrarClientes,
  cola: entrarCola,
  reportes: () => void cargarReportes(),
  importar: entrarImportar,
  telefono: entrarTelefono,
  config: () => void cargarConfig(),
};

function irA(vista: string): void {
  if (!ENTRADAS[vista]) return;
  vistaActual = vista;
  document.querySelectorAll<HTMLElement>(".vista").forEach((v) => (v.hidden = v.dataset.vista !== vista));
  document.querySelectorAll<HTMLElement>(".menu-item").forEach((b) => {
    const activo = b.dataset.ir === vista;
    b.classList.toggle("activo", activo);
    if (activo) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (vista !== "clientes") $("ficha").hidden = true;
  $("contenido").scrollTo({ top: 0 });
  ENTRADAS[vista]();
}

/** Aplica el contexto (usuario y mes) a toda la interfaz. */
function aplicarContexto(ctx: Phoenix.Contexto): void {
  const cambioMes = App.contexto?.periodo.id !== ctx.periodo.id;
  App.contexto = ctx;
  $("usuario-nombre").textContent = `${ctx.usuario.nombre} ${ctx.usuario.apellido}`.trim();
  $("usuario-email").textContent = ctx.usuario.email;
  const sel = $select("selector-mes");
  sel.innerHTML = ctx.periodos
    .map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.esActual ? " (actual)" : ""}${p.clientes ? ` · ${numero(p.clientes)} clientes` : ""}</option>`)
    .join("");
  sel.value = ctx.periodo.id;
  $("aviso-mes-cerrado").hidden = ctx.periodo.esActual;
  $("aviso-mes-cerrado").textContent = `Estás trabajando en ${ctx.periodo.nombre}, un mes anterior.`;
  if (cambioMes) {
    seleccion.clear();
    fichaActual = null;
    $("ficha").hidden = true;
    $input("importar-mes").value = ctx.periodo.id;
  }
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

function mostrarLogin(mensaje?: string): void {
  App.contexto = null;
  clearTimeout(temporizadorInactividad);
  detenerRecordatorios();
  cerrarLlamadaManual();
  if (temporizadorCola !== null) {
    clearInterval(temporizadorCola);
    temporizadorCola = null;
  }
  ($("dialogo-confirmar") as HTMLDialogElement).close();
  document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((d) => d.close());
  $("aplicacion").hidden = true;
  $("pantalla-login").hidden = false;
  $input("login-password").value = "";
  const info = $("login-error");
  info.hidden = !mensaje;
  info.textContent = mensaje ?? "";
  $input("login-email").focus();
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
  $("form-login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const error = $("login-error");
    error.hidden = true;
    const boton = (ev.target as HTMLFormElement).querySelector("button")!;
    boton.disabled = true;
    try {
      const ctx = await Api.login($input("login-email").value, $input("login-password").value);
      $input("login-password").value = "";
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
    } finally {
      boton.disabled = false;
    }
  });

  $("btn-cerrar-sesion").addEventListener("click", async () => {
    if (estadoCola?.activa && !(await confirmar("Cerrar sesión", "La cola de llamadas está en marcha y se detendrá.", "Cerrar sesión"))) return;
    await Api.logout().catch(() => undefined);
    mostrarLogin();
  });

  alExpirarSesion = () => {
    if (App.contexto) mostrarLogin("Tu sesión expiró. Vuelve a ingresar.");
  };
  ["pointerdown", "keydown", "wheel"].forEach((t) => document.addEventListener(t, debounce(reiniciarInactividad, 1000), { passive: true }));
}

// ============================ Inicio ============================

async function iniciar(): Promise<void> {
  document.addEventListener("click", (e) => {
    const destino = (e.target as HTMLElement).closest<HTMLElement>("[data-ir]");
    if (destino) irA(destino.dataset.ir!);
  });
  $select("selector-mes").addEventListener("change", async (ev) => {
    const ctx = await intentar(() => Api.cambiarPeriodo((ev.target as HTMLSelectElement).value));
    if (!ctx) return;
    aplicarContexto(ctx);
    aviso(`Ahora trabajas en ${ctx.periodo.nombre}.`);
    irA(vistaActual);
    iniciarRecordatorios();
  });

  prepararSesion();
  prepararDashboard();
  prepararClientes();
  prepararCola();
  prepararReportes();
  prepararImportar();
  prepararTelefono();
  prepararConfig();
  prepararRecordatorios();

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
