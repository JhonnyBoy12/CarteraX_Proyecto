/**
 * @file vista-telefono.ts
 * @description Vinculación con Phoenix Mobile (RF-28, RF-29) y llamada manual.
 */

function pintarEstadoMovil(estado: Phoenix.EstadoMovil | null): void {
  const ficha = $("ficha-movil");
  const lateral = $("estado-telefono");
  const texto = lateral.querySelector(".estado-texto")!;
  if (!estado) {
    ficha.dataset.estado = "desconocido";
    $("movil-titulo").textContent = "Sin vincular";
    $("movil-detalle").textContent = "Escribe la IP que muestra Phoenix Mobile y prueba la conexión.";
    lateral.dataset.estado = "";
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
        ? `${estado.ip}:${estado.puerto}. Listo para la cola automática.`
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
  if (estado.conectado) aviso("Teléfono vinculado. La IP quedó guardada.", "ok");
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
