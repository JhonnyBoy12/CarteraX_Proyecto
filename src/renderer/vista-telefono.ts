/**
 * @file vista-telefono.ts
 * @description Vinculación con Phoenix Mobile (RF-28, RF-29) y llamada manual.
 *
 * v0.4: se busca el teléfono en la red y se vincula con el código de 6
 * dígitos que muestra Phoenix Mobile; desde entonces ese teléfono sólo
 * obedece a este computador. La IP a mano queda como alternativa.
 */

function pintarEstadoMovil(estado: Phoenix.EstadoMovil | null): void {
  const ficha = $("ficha-movil");
  const lateral = $("estado-telefono");
  const texto = lateral.querySelector(".estado-texto")!;
  $("btn-desvincular-movil").hidden = !estado?.vinculado;
  if (!estado) {
    ficha.dataset.estado = "desconocido";
    $("movil-titulo").textContent = "Sin vincular";
    $("movil-detalle").textContent = "Pulsa «Buscar teléfonos» y elige el tuyo.";
    lateral.dataset.estado = "";
    texto.textContent = "Teléfono sin vincular";
    return;
  }
  if (estado.conectado && estado.requiereVinculo) {
    ficha.dataset.estado = "error";
    $("movil-titulo").textContent = estado.vinculadoConOtro ? `${estado.dispositivo} está vinculado con otro computador` : `Falta vincular ${estado.dispositivo}`;
    $("movil-detalle").textContent = "Busca el teléfono y escribe el código de 6 dígitos que muestra.";
    lateral.dataset.estado = "error";
    texto.textContent = "Teléfono sin vincular";
    return;
  }
  if (estado.conectado) {
    const listo = estado.permisoLlamadas;
    ficha.dataset.estado = listo ? "ok" : "error";
    $("movil-titulo").textContent = `Conectado a ${estado.dispositivo}`;
    $("movil-detalle").textContent = !listo
      ? "Falta conceder el permiso de llamadas en Phoenix Mobile."
      : estado.seguimientoLlamadas
        ? `${estado.ip}:${estado.puerto}${estado.admiteVinculo ? " · vinculado con código" : " · versión sin código: actualiza Phoenix Mobile"}. Listo para la cola automática.`
        : `${estado.ip}:${estado.puerto}. El teléfono no informa cuándo termina la llamada: en la cola marcarás el resultado a mano.`;
    lateral.dataset.estado = listo ? "ok" : "error";
    texto.textContent = estado.dispositivo ?? "Teléfono conectado";
  } else {
    ficha.dataset.estado = "error";
    $("movil-titulo").textContent = "No responde";
    $("movil-detalle").textContent = estado.detalle ?? "";
    lateral.dataset.estado = "error";
    texto.textContent = "Teléfono no responde";
  }
}

async function comprobarMovil(): Promise<void> {
  try {
    const { ip } = await Api.movil();
    if (ip && !$input("movil-ip").value) $input("movil-ip").value = ip;
    pintarEstadoMovil(ip ? await Api.probarMovil() : null);
  } catch {
    /* sin sesión todavía */
  }
}

async function probarConexionMovil(): Promise<void> {
  const ip = $input("movil-ip").value.trim();
  if (!ip) return aviso("Escribe la IP que muestra Phoenix Mobile.", "error");
  $("ficha-movil").dataset.estado = "cargando";
  $("movil-titulo").textContent = "Probando conexión…";
  $("movil-detalle").textContent = "";
  const estado = await intentar(() => Api.probarMovil(ip), $boton("btn-probar-movil"));
  if (!estado) return;
  pintarEstadoMovil(estado);
  if (estado.conectado && estado.requiereVinculo) abrirCodigo(estado.ip ?? ip, estado.dispositivo ?? "el teléfono");
  else if (estado.conectado) aviso("Teléfono conectado. La IP quedó guardada.", "ok");
}

// ===================== Buscar y vincular con código (v0.4) =====================

let ipPorVincular: string | null = null;
let vinculando = false;

async function buscarTelefonos(): Promise<void> {
  const lista = $("lista-moviles");
  const boton = $boton("btn-buscar-movil");
  lista.hidden = false;
  lista.innerHTML = `<li class="lm-vacio">Buscando en tu red Wi‑Fi…</li>`;
  const encontrados = await intentar(() => Api.buscarMoviles(), boton);
  if (!encontrados) {
    lista.hidden = true;
    return;
  }
  if (!encontrados.length) {
    lista.innerHTML = `<li class="lm-vacio">No se encontró ningún teléfono. Revisa que Phoenix Mobile esté abierta y en la misma Wi‑Fi que este computador, o escribe la IP a mano.</li>`;
    return;
  }
  lista.innerHTML = encontrados
    .map((m, i) => {
      const estado = m.vinculado ? "Vinculado" : m.admiteVinculo ? "Elegir" : "Sin código";
      return `<li style="--i:${i}"><button type="button" class="movil-item" data-ip="${esc(m.ip)}" data-nombre="${esc(m.dispositivo)}" data-codigo="${m.admiteVinculo && !m.vinculado ? "1" : ""}">
        <span class="mi-icono" aria-hidden="true"><svg><use href="#i-telefono"/></svg></span>
        <span class="mi-texto"><strong>${esc(m.dispositivo)}</strong><small>${esc(m.ip)}${m.version && /^d/.test(m.version) ? ` · v${esc(m.version)}` : ""}</small></span>
        <span class="mi-estado${m.vinculado ? " ok" : ""}">${estado}</span>
      </button></li>`;
    })
    .join("");
}

function digitosCodigo(): HTMLInputElement[] {
  return Array.from($("otp").querySelectorAll("input"));
}

function abrirCodigo(ip: string, nombre: string): void {
  ipPorVincular = ip;
  $("codigo-titulo").textContent = `Escribe el código que muestra ${nombre}`;
  const panel = $("panel-codigo");
  panel.hidden = false;
  $("otp").classList.remove("error", "ok");
  for (const d of digitosCodigo()) {
    d.value = "";
    d.classList.remove("lleno");
  }
  digitosCodigo()[0].focus();
  panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function cerrarCodigo(): void {
  ipPorVincular = null;
  $("panel-codigo").hidden = true;
}

async function vincularConCodigo(): Promise<void> {
  const ip = ipPorVincular;
  const codigo = digitosCodigo().map((d) => d.value).join("");
  if (!ip || vinculando) return;
  if (codigo.length !== 6) {
    digitosCodigo().find((d) => !d.value)?.focus();
    return aviso("Faltan dígitos del código.", "error");
  }
  vinculando = true;
  const estado = await intentar(() => Api.vincularMovil(ip, codigo), $boton("btn-vincular-movil"));
  vinculando = false;
  const otp = $("otp");
  if (!estado) {
    otp.classList.remove("error");
    void otp.offsetWidth; // reinicia la sacudida
    otp.classList.add("error");
    for (const d of digitosCodigo()) {
      d.value = "";
      d.classList.remove("lleno");
    }
    digitosCodigo()[0].focus();
    return;
  }
  otp.classList.add("ok");
  pintarEstadoMovil(estado);
  aviso(`${estado.dispositivo ?? "Teléfono"} vinculado. Sólo este computador puede darle órdenes.`, "ok");
  window.setTimeout(() => {
    cerrarCodigo();
    $("lista-moviles").hidden = true;
  }, 450);
}

function prepararCodigo(): void {
  const digitos = digitosCodigo();
  digitos.forEach((d, i) => {
    d.addEventListener("input", () => {
      const solo = d.value.replace(/\D/g, "");
      if (solo.length > 1) {
        // Autocompletado o pegado en una casilla: se reparte.
        solo.split("").slice(0, 6 - i).forEach((c, j) => {
          digitos[i + j].value = c;
          digitos[i + j].classList.add("lleno");
        });
      } else {
        d.value = solo;
      }
      d.classList.toggle("lleno", Boolean(d.value));
      $("otp").classList.remove("error");
      const siguiente = digitos.find((x, j) => j > i && !x.value);
      if (d.value && siguiente) siguiente.focus();
      if (digitos.every((x) => x.value)) void vincularConCodigo();
    });
    d.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !d.value && i > 0) {
        digitos[i - 1].value = "";
        digitos[i - 1].classList.remove("lleno");
        digitos[i - 1].focus();
        e.preventDefault();
      } else if (e.key === "ArrowLeft" && i > 0) digitos[i - 1].focus();
      else if (e.key === "ArrowRight" && i < 5) digitos[i + 1].focus();
      else if (e.key === "Enter") void vincularConCodigo();
      else if (e.key === "Escape") cerrarCodigo();
    });
    d.addEventListener("paste", (e) => {
      const texto = (e.clipboardData?.getData("text") ?? "").replace(/\D/g, "").slice(0, 6);
      if (!texto) return;
      e.preventDefault();
      digitos.forEach((x, j) => {
        x.value = texto[j] ?? "";
        x.classList.toggle("lleno", Boolean(x.value));
      });
      (digitos.find((x) => !x.value) ?? digitos[5]).focus();
      if (texto.length === 6) void vincularConCodigo();
    });
    d.addEventListener("focus", () => d.select());
  });
  $("btn-vincular-movil").addEventListener("click", () => void vincularConCodigo());
  $("btn-cancelar-codigo").addEventListener("click", cerrarCodigo);
  $("btn-buscar-movil").addEventListener("click", () => void buscarTelefonos());
  $("lista-moviles").addEventListener("click", async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>(".movil-item");
    if (!b) return;
    const ip = b.dataset.ip!;
    if (b.dataset.codigo) return abrirCodigo(ip, b.dataset.nombre ?? "el teléfono");
    // Ya vinculado, o versión anterior sin código: basta con conectar.
    $input("movil-ip").value = ip;
    await probarConexionMovil();
  });
  $("btn-desvincular-movil").addEventListener("click", async () => {
    if (!(await confirmar("Desvincular el teléfono", "El teléfono dejará de recibir llamadas de este computador hasta que lo vuelvas a vincular con su código.", "Desvincular"))) return;
    if (await intentar(() => Api.desvincularMovil())) {
      $input("movil-ip").value = "";
      pintarEstadoMovil(null);
      aviso("Teléfono desvinculado.", "ok");
    }
  });
}

async function cargarLlamadasTelefono(): Promise<void> {
  const cuerpo = document.querySelector("#tabla-llamadas tbody")!;
  try {
    const filas = await Api.llamadas();
    cuerpo.innerHTML = filas.length ? filas.map((l) => filaLlamada(l)).join("") : filaVacia(5, "Todavía no hay llamadas registradas.");
  } catch (e) {
    cuerpo.innerHTML = filaVacia(5, (e as Error).message);
  }
}

function prepararTelefono(): void {
  $("btn-probar-movil").addEventListener("click", () => void probarConexionMovil());
  $input("movil-ip").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void probarConexionMovil();
  });
  $("form-llamada-manual").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const n = $input("movil-numero").value.trim();
    if (!n) return aviso("Escribe un número.", "error");
    const r = await intentar(() => Api.llamar(n, null), $boton("btn-llamar-manual"));
    if (r) aviso(`Llamando a ${r.numero} desde el teléfono.`, "ok");
    if (r?.seguimiento) mostrarLlamadaManual(r.seguimiento);
    void cargarLlamadasTelefono();
  });
  conectarCorreccionLlamadas($("tabla-llamadas"), () => void cargarLlamadasTelefono());
  prepararLlamadaManual();
  prepararCodigo();
}

// ===================== Llamada manual en curso (v0.3.1) =====================

let llamadaManual: Phoenix.SeguimientoLlamada | null = null;
let sondeoLlamadaManual: number | null = null;
let relojLlamadaManual: number | null = null;
let inicioLocalLlamada = 0;

/** Muestra la tarjeta de la llamada manual y empieza a seguirla. */
function mostrarLlamadaManual(s: Phoenix.SeguimientoLlamada): void {
  llamadaManual = s;
  inicioLocalLlamada = Date.now() - s.transcurrido * 1000;
  pintarLlamadaManual();
  if (sondeoLlamadaManual !== null) clearInterval(sondeoLlamadaManual);
  if (relojLlamadaManual !== null) clearInterval(relojLlamadaManual);
  sondeoLlamadaManual = window.setInterval(() => void sondearLlamadaManual(), 2000);
  relojLlamadaManual = window.setInterval(() => {
    const t = document.getElementById("lm-tiempo");
    if (t && llamadaManual && !llamadaManual.terminada) t.textContent = reloj(Math.round((Date.now() - inicioLocalLlamada) / 1000));
  }, 1000);
}

function reloj(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function pintarLlamadaManual(): void {
  const s = llamadaManual;
  const caja = $("llamada-manual");
  if (!s) {
    caja.hidden = true;
    return;
  }
  caja.hidden = false;
  const transcurrido = Math.round((Date.now() - inicioLocalLlamada) / 1000);
  let cuerpo: string;
  if (s.terminada && s.motivo) {
    const r = textoLlamada(s.motivo === "contestada" ? "contestada" : "no contesta", s.motivo, s.duracion);
    cuerpo = `<p class="lm-final">Registrada: <span class="resultado ${r.clase}">${esc(r.texto)}</span></p>
      <div class="lm-acciones"><button class="btn pequeño texto" data-lm-corregir>Corregir</button><button class="btn pequeño secundario" data-lm-cerrar>Listo</button></div>`;
  } else {
    cuerpo = `<p class="bajada">${
      s.automatico ? "El teléfono avisará cuando termine. Si no, indícalo aquí:" : "Este teléfono no informa el término. Indica cómo terminó:"
    }</p>
      <div class="lm-acciones">
        <button class="btn pequeño primario" data-lm-motivo="contestada">Contestó</button>
        <button class="btn pequeño secundario" data-lm-motivo="no_contesta">No contesta</button>
      </div>
      <div class="motivos"><span>Otro motivo:</span>${MOTIVOS_SIN_RESPUESTA.map((m) => `<button class="chip" data-lm-motivo="${m}">${esc(MOTIVOS[m].nombre)}</button>`).join("")}</div>`;
  }
  caja.innerHTML = `<button class="lm-cerrar" data-lm-cerrar aria-label="Cerrar">×</button>
    <div class="lm-cab"><span class="pulso" data-proceso="${s.terminada ? "FINALIZADA" : "EN_LLAMADA"}"></span>
      <div><strong>${esc(s.nombre ?? "Llamada manual")}</strong><small>${esc(s.numero)}</small></div>
      <span class="lm-tiempo" id="lm-tiempo">${s.terminada ? (s.duracion ? reloj(s.duracion) : "0:00") : reloj(transcurrido)}</span></div>
    <div class="lm-cuerpo">${cuerpo}</div>`;
}

async function sondearLlamadaManual(): Promise<void> {
  if (!llamadaManual || llamadaManual.terminada) return;
  try {
    const s = await Api.seguimientoLlamada();
    if (!s) return cerrarLlamadaManual();
    const cambio = s.terminada !== llamadaManual.terminada || s.automatico !== llamadaManual.automatico;
    llamadaManual = s;
    if (cambio) {
      pintarLlamadaManual();
      if (s.terminada) alTerminarLlamadaManual();
    }
  } catch {
    /* se reintenta */
  }
}

function alTerminarLlamadaManual(): void {
  if (sondeoLlamadaManual !== null) clearInterval(sondeoLlamadaManual);
  sondeoLlamadaManual = null;
  void cargarLlamadasTelefono();
  if (fichaActual && vistaActual === "clientes") void abrirFicha(fichaActual.id);
}

function cerrarLlamadaManual(): void {
  if (sondeoLlamadaManual !== null) clearInterval(sondeoLlamadaManual);
  if (relojLlamadaManual !== null) clearInterval(relojLlamadaManual);
  sondeoLlamadaManual = relojLlamadaManual = null;
  llamadaManual = null;
  $("llamada-manual").hidden = true;
}

function prepararLlamadaManual(): void {
  $("llamada-manual").addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const s = llamadaManual;
    if (!s) return;
    if (t.closest("[data-lm-cerrar]")) {
      if (!s.terminada && !(await confirmar("Cerrar sin registrar", "La llamada quedará «sin confirmar». Puedes corregirla después en Teléfono.", "Cerrar"))) return;
      void Api.descartarSeguimiento();
      return cerrarLlamadaManual();
    }
    if (t.closest("[data-lm-corregir]")) {
      const r = await preguntarResultadoLlamada(`Llamada a ${s.numero}.`, s.motivo, s.duracion);
      if (r && (await intentar(() => Api.corregirLlamada(s.gestionId, r.motivo, r.duracion)))) {
        llamadaManual = { ...s, motivo: r.motivo, duracion: r.duracion ?? s.duracion };
        pintarLlamadaManual();
        alTerminarLlamadaManual();
      }
      return;
    }
    const motivo = t.closest<HTMLElement>("[data-lm-motivo]")?.dataset.lmMotivo as Phoenix.MotivoLlamada | undefined;
    if (!motivo) return;
    const nuevo = await intentar(() => Api.terminarLlamada(motivo, null));
    if (nuevo) {
      llamadaManual = nuevo;
      pintarLlamadaManual();
      alTerminarLlamadaManual();
      aviso(
        motivo === "contestada" ? `Llamada registrada: ${segundos(nuevo.duracion ?? 0)} aproximados. Puedes ajustar la duración con «Corregir».` : "Resultado de la llamada registrado.",
        "ok"
      );
    }
  });
}

function entrarTelefono(): void {
  void comprobarMovil();
  void cargarLlamadasTelefono();
}
