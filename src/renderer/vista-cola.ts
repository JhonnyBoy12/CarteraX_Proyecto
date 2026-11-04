/**
 * @file vista-cola.ts
 * @description Cola progresiva de llamadas (RF-30 a RF-32, RNF-22).
 * Llama uno a uno a los clientes «En cola»; cuando el cliente contesta, la
 * cola espera a que el ejecutivo registre el resultado y el comentario.
 */

const ETIQUETAS_PROCESO: Record<Phoenix.ProcesoCola, string> = {
  DETENIDA: "Detenida",
  MARCANDO: "Marcando",
  EN_LLAMADA: "En llamada",
  ESPERANDO_FIN: "Llamando",
  ESPERANDO_RESULTADO: "Registra el resultado",
  PAUSADA: "En pausa",
  FINALIZADA: "Terminada",
  ERROR: "Detenida por un error",
};

let estadoCola: Phoenix.EstadoColaLlamadas | null = null;
let temporizadorCola: number | null = null;
/** Cliente para el que ya se dibujó el formulario de resultado. */
let formularioResultadoDe: string | null = null;

function enCurso(e: Phoenix.EstadoColaLlamadas | null): boolean {
  return !!e && e.activa && ["MARCANDO", "ESPERANDO_FIN", "EN_LLAMADA"].includes(e.proceso);
}

function programarSondeo(): void {
  if (estadoCola?.activa && temporizadorCola === null) {
    temporizadorCola = window.setInterval(() => void sondearCola(), 1500);
  } else if (!estadoCola?.activa && temporizadorCola !== null) {
    clearInterval(temporizadorCola);
    temporizadorCola = null;
  }
}

async function sondearCola(): Promise<void> {
  try {
    const anterior = estadoCola?.proceso;
    const e = enCurso(estadoCola) ? await Api.colaActualizar() : await Api.cola();
    mostrarCola(e);
    if (anterior !== e.proceso && e.proceso === "ESPERANDO_RESULTADO" && vistaActual !== "cola") {
      aviso(`${e.actual?.nombre ?? "El cliente"} contestó: registra el resultado para seguir con la cola.`, "info", {
        texto: "Ir a la cola",
        fn: () => irA("cola"),
      });
    }
    if (anterior && anterior !== e.proceso && !e.activa) void cargarLlamadasCola();
  } catch {
    /* el siguiente sondeo reintenta */
  }
}

function mostrarCola(e: Phoenix.EstadoColaLlamadas): void {
  estadoCola = e;
  programarSondeo();

  // Indicador en el menú lateral.
  const insignia = $("insignia-cola");
  insignia.hidden = !e.activa;
  insignia.className = `insignia-cola ${e.proceso === "ESPERANDO_RESULTADO" ? "atencion" : ""}`;

  const v = $("vista-cola-contenido");
  if (!v.isConnected) return;

  $("cola-proceso").textContent = ETIQUETAS_PROCESO[e.proceso];
  $("cola-proceso").dataset.proceso = e.proceso;
  $("cola-mensaje").textContent = e.mensaje ?? (e.activa ? "" : "Pulsa «Iniciar cola» para empezar a llamar.");

  $boton("cola-iniciar").hidden = e.activa;
  $boton("cola-iniciar").disabled = e.pendientes === 0 && !e.actual;
  $boton("cola-pausar").hidden = !e.activa || e.pausada;
  $boton("cola-reanudar").hidden = !e.activa || !e.pausada;
  $boton("cola-detener").hidden = !e.activa;

  $("cola-sesion").innerHTML = `
    <div><dt>Llamadas</dt><dd>${numero(e.sesion.llamadas)}</dd></div>
    <div><dt>Contestadas</dt><dd>${numero(e.sesion.contestadas)}</dd></div>
    <div><dt>Sin respuesta</dt><dd>${numero(e.sesion.noContesta)}</dd></div>
    <div><dt>Gestionados</dt><dd>${numero(e.sesion.gestionados)}</dd></div>`;

  // Llamada actual.
  const actual = e.actual;
  const tarjeta = $("cola-actual");
  tarjeta.dataset.proceso = e.proceso;
  if (!actual) {
    formularioResultadoDe = null;
    tarjeta.innerHTML = `<div class="cola-vacia">
      <h2>${e.proceso === "FINALIZADA" ? "Cola terminada" : e.activa ? "Buscando el siguiente cliente…" : "Sin llamada en curso"}</h2>
      <p>${
        e.pendientes
          ? `${numero(e.pendientes)} ${e.pendientes === 1 ? "cliente espera" : "clientes esperan"} en la cola.`
          : "No hay clientes «En cola» con teléfonos pendientes. Envíalos desde Clientes: selecciona y pulsa «Enviar a la cola»."
      }</p>
      ${e.pendientes ? "" : `<button class="btn secundario" data-ir-clientes-pendientes>Elegir clientes para la cola</button>`}
    </div>`;
  } else if (e.proceso === "ESPERANDO_RESULTADO") {
    if (formularioResultadoDe !== actual.clienteId) {
      formularioResultadoDe = actual.clienteId;
      tarjeta.innerHTML = cabeceraLlamada(actual, e) + formularioResultado(actual, e.duracionUltima);
      prepararFormResultado();
    }
  } else {
    formularioResultadoDe = null;
    const error = e.proceso === "ERROR";
    tarjeta.innerHTML = cabeceraLlamada(actual, e) + `
      ${e.terminoSinDatos ? `<p class="cola-sin-datos">${ICONO.aviso}El teléfono colgó sin informar si contestaron. Indica cómo terminó la llamada.</p>` : ""}
      <div class="cola-botones">
        <span class="bajada">${error ? "Revisa el teléfono y pulsa «Reanudar»." : e.terminoSinDatos ? "Resultado de la llamada:" : "¿El teléfono no informa el término? Márcalo aquí:"}</span>
        ${error ? "" : `<button class="btn primario" id="cola-contesto">Contestó</button><button class="btn secundario" id="cola-no-contesto">No contestó</button>`}
        <button class="btn texto" id="cola-saltar">Saltar cliente</button>
        ${
          error
            ? ""
            : `<div class="motivos"><span>Sin respuesta por otro motivo:</span>${MOTIVOS_SIN_RESPUESTA.map(
                (m) => `<button class="chip" data-cola-motivo="${m}">${esc(MOTIVOS[m].nombre)}</button>`
              ).join("")}</div>`
        }
      </div>`;
  }

  // Último intento sin respuesta: se puede corregir el motivo sin detener la cola.
  const u = e.activa ? e.ultimoIntento : null;
  const intento = $("cola-intento");
  intento.hidden = !u;
  if (u) {
    intento.innerHTML = `<span>Último intento: <b>${esc(u.nombre)}</b> · ${esc(u.numero)} · ${esc(MOTIVOS[u.motivo].nombre.toLowerCase())}</span>
      <div class="motivos"><span>¿Fue otro motivo?</span>${(["no_contesta", ...MOTIVOS_SIN_RESPUESTA] as Phoenix.MotivoLlamada[])
        .filter((m) => m !== u.motivo)
        .map((m) => `<button class="chip" data-corregir-intento="${m}">${esc(MOTIVOS[m].nombre)}</button>`)
        .join("")}</div>`;
  }

  // Próximos.
  $("cola-proximos").innerHTML = e.proximos.length
    ? e.proximos
        .map(
          (p, i) => `<li><span class="cp-orden">${i + 1}</span>
            <span class="cp-nombre">${esc(p.nombre)}<small>${esc(p.numero)}${p.telefonosPendientes > 1 ? ` y ${p.telefonosPendientes - 1} más` : ""}</small></span>
            <span class="cp-deuda">${pesosCorto(p.deuda)}<small>prioridad ${p.prioridad}</small></span></li>`
        )
        .join("")
    : `<li class="sin-datos">Nadie más en la cola.</li>`;
  $("cola-pendientes").textContent = `${numero(e.pendientes)} en espera`;
  $("cola-sin-telefono").hidden = e.sinTelefono === 0;
  $("cola-sin-telefono").textContent = `${numero(e.sinTelefono)} ${e.sinTelefono === 1 ? "cliente «En cola» no tiene" : "clientes «En cola» no tienen"} teléfonos pendientes y se omiten.`;
}

function cabeceraLlamada(a: Phoenix.ItemColaLlamadas, e: Phoenix.EstadoColaLlamadas): string {
  return `<header class="cola-cliente">
      <div>
        <p class="cola-numero"><span class="pulso" data-proceso="${e.proceso}"></span>${esc(a.numero)}</p>
        <h2>${esc(a.nombre)}</h2>
        <p class="bajada">${esc(rutCompleto(a.rut, a.dv))}${a.telefonosPendientes > 1 ? ` · quedan ${a.telefonosPendientes - 1} teléfonos más` : ""}</p>
      </div>
      <dl class="cola-cifras">
        <div><dt>Deuda</dt><dd>${pesos(a.deuda)}</dd></div>
        <div><dt>Mora</dt><dd>${a.diasMora === null ? "—" : `${numero(a.diasMora)} días`}</dd></div>
        <div><dt>Prioridad</dt><dd>${a.prioridad}</dd></div>
      </dl>
    </header>
    ${a.ultimoComentario ? `<p class="cola-ultimo"><span>Última gestión</span>${esc(a.ultimoComentario)}</p>` : ""}
    <button class="btn texto pequeño" data-ficha="${esc(a.clienteId)}">Abrir ficha completa</button>`;
}

function formularioResultado(a: Phoenix.ItemColaLlamadas, duracion: number | null): string {
  const opciones = App.estados.filter((e) => !["EN_COLA", "PENDIENTE"].includes(e.codigo));
  return `<form class="form-resultado" id="form-resultado">
      <h3>¿Cómo terminó la llamada con ${esc(a.nombre.split(" ")[0])}?</h3>
      <fieldset class="estados-grilla">
        ${opciones
          .map((e, i) => `<label class="estado-opcion tono-${e.tono}" title="${esc(e.descripcion)}"><input type="radio" name="estado" value="${e.codigo}" ${i === 0 ? "checked" : ""}><span><i></i>${esc(e.nombre)}</span></label>`)
          .join("")}
      </fieldset>
      <div class="campos-condicionales">
        <label class="campo" id="cr-fecha" hidden><span>Fecha del compromiso</span><input type="date" name="fecha" min="${hoyLocal()}"></label>
        <label class="campo" id="cr-monto" hidden><span>Monto</span><input type="text" name="monto" inputmode="numeric" placeholder="$ 0"></label>
        <label class="campo"><span>Próxima gestión</span><input type="date" name="proxima" min="${hoyLocal()}"></label>
        <div class="campo"><span>Duración de la llamada</span>
          <div class="campo-duracion">
            <label class="campo-en-linea"><input type="number" name="dur-min" min="0" max="360" value="${duracion ? Math.floor(duracion / 60) : ""}" aria-label="Minutos"> min</label>
            <label class="campo-en-linea"><input type="number" name="dur-seg" min="0" max="59" value="${duracion ? duracion % 60 : ""}" aria-label="Segundos"> s</label>
          </div>
        </div>
      </div>
      ${campoRecordatorio()}
      <label class="campo"><span>Comentario</span><textarea name="comentario" rows="3" maxlength="2000" placeholder="Qué dijo el cliente y qué sigue."></textarea></label>
      <div class="frases-rapidas">${FRASES_RAPIDAS.map((f) => `<button type="button" class="chip" data-frase="${esc(f)}">${esc(f)}</button>`).join("")}</div>
      <p class="form-error" id="cr-error" hidden></p>
      <div class="form-acciones"><span class="bajada">Ctrl + Enter para guardar</span>
        <button type="button" class="btn texto" id="cola-saltar">Saltar sin registrar</button>
        <button class="btn primario" type="submit">Guardar y llamar al siguiente</button></div>
    </form>`;
}

function prepararFormResultado(): void {
  const form = $("form-resultado") as HTMLFormElement;
  const comentario = form.elements.namedItem("comentario") as HTMLTextAreaElement;
  const valor = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value || null;
  const refrescarRecordatorio = conectarRecordatorio(
    form,
    () => form.querySelector<HTMLInputElement>("input[name=estado]:checked")?.value || null,
    () => valor("fecha"),
    () => valor("proxima")
  );
  const actualizar = () => {
    const e = App.porCodigo.get(form.querySelector<HTMLInputElement>("input[name=estado]:checked")?.value ?? "");
    $("cr-fecha").hidden = !e?.pideFecha;
    $("cr-monto").hidden = !e?.pideMonto;
    refrescarRecordatorio();
  };
  form.addEventListener("change", actualizar);
  form.querySelector(".frases-rapidas")!.addEventListener("click", (ev) => {
    const f = (ev.target as HTMLElement).closest<HTMLElement>("[data-frase]")?.dataset.frase;
    if (f) comentario.value = comentario.value.trim() ? `${comentario.value.trim()}. ${f}` : f;
  });
  form.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) form.requestSubmit();
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = new FormData(form);
    const montoTexto = String(d.get("monto") ?? "");
    const monto = leerMonto(montoTexto);
    const error = $("cr-error");
    error.hidden = true;
    if (montoTexto.trim() && monto === null) {
      error.textContent = "El monto no es válido.";
      error.hidden = false;
      return;
    }
    const min = String(d.get("dur-min") ?? "");
    const seg = String(d.get("dur-seg") ?? "");
    try {
      form.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = true;
      const nuevo = await Api.colaResultado({
        estado: String(d.get("estado")) as Phoenix.CodigoEstado,
        comentario: String(d.get("comentario") ?? ""),
        monto,
        fechaCompromiso: String(d.get("fecha") ?? "") || null,
        proximaGestion: String(d.get("proxima") ?? "") || null,
        recordatorio: leerRecordatorio(form),
        duracion: min || seg ? Number(min || 0) * 60 + Number(seg || 0) : null,
      });
      aviso("Resultado guardado.", "ok");
      mostrarCola(nuevo);
      void cargarLlamadasCola();
      void cargarRecordatorios();
    } catch (e) {
      error.textContent = (e as Error).message;
      error.hidden = false;
      const b = form.querySelector<HTMLButtonElement>("button[type=submit]");
      if (b) b.disabled = false;
    }
  });
  actualizar();
  comentario.focus();
}

async function cargarLlamadasCola(): Promise<void> {
  const cuerpo = document.querySelector("#tabla-llamadas-cola tbody");
  if (!cuerpo) return;
  try {
    const filas = await Api.llamadas();
    // La llamada que la cola tiene abierta no se corrige desde la tabla.
    const abierta = enCurso(estadoCola) || estadoCola?.proceso === "ESPERANDO_RESULTADO";
    cuerpo.innerHTML = filas.length
      ? filas
          .slice(0, 15)
          .map((l, i) => filaLlamada(l, abierta && i === 0 && l.cliente_id === estadoCola?.actual?.clienteId))
          .join("")
      : filaVacia(5, "Todavía no hay llamadas este mes.");
  } catch (e) {
    cuerpo.innerHTML = filaVacia(5, (e as Error).message);
  }
}

async function accionCola(fn: () => Promise<Phoenix.EstadoColaLlamadas>, boton?: HTMLButtonElement | null): Promise<void> {
  const e = await intentar(fn, boton);
  if (e) mostrarCola(e);
}

function prepararCola(): void {
  $("cola-iniciar").addEventListener("click", (ev) => void accionCola(Api.colaIniciar, ev.currentTarget as HTMLButtonElement));
  $("cola-pausar").addEventListener("click", (ev) => void accionCola(Api.colaPausar, ev.currentTarget as HTMLButtonElement));
  $("cola-reanudar").addEventListener("click", (ev) => void accionCola(Api.colaReanudar, ev.currentTarget as HTMLButtonElement));
  $("cola-detener").addEventListener("click", async (ev) => {
    if (await confirmar("Detener la cola", "Los clientes que no alcanzaste a llamar siguen «En cola» para la próxima vez.", "Detener")) {
      await accionCola(Api.colaDetener, ev.currentTarget as HTMLButtonElement);
      void cargarLlamadasCola();
    }
  });
  $("cola-actual").addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest("#cola-contesto")) return void accionCola(() => Api.colaFinalizar("contestada"));
    if (t.closest("#cola-no-contesto")) return void accionCola(() => Api.colaFinalizar("no_contesta"));
    const motivo = t.closest<HTMLElement>("[data-cola-motivo]")?.dataset.colaMotivo as Phoenix.MotivoLlamada | undefined;
    if (motivo) return void accionCola(() => Api.colaFinalizar(motivo));
    if (t.closest("#cola-saltar")) return void accionCola(Api.colaSaltar);
    const ficha = t.closest<HTMLElement>("[data-ficha]")?.dataset.ficha;
    if (ficha) return void abrirFicha(ficha);
    if (t.closest("[data-ir-clientes-pendientes]")) irAClientes({ estados: ["PENDIENTE"], orden: "prioridad" });
  });
  $("cola-intento").addEventListener("click", async (ev) => {
    const m = (ev.target as HTMLElement).closest<HTMLElement>("[data-corregir-intento]")?.dataset.corregirIntento as Phoenix.MotivoLlamada | undefined;
    if (!m) return;
    const e = await intentar(() => Api.colaCorregirIntento(m));
    if (e) {
      aviso(m === "inexistente" ? "Corregido. Ese número salió de la cola." : "Motivo corregido.", "ok");
      mostrarCola(e);
      void cargarLlamadasCola();
    }
  });
  conectarCorreccionLlamadas($("tabla-llamadas-cola"), () => void cargarLlamadasCola());
}

function entrarCola(): void {
  formularioResultadoDe = null;
  void Api.cola().then(mostrarCola).catch((e) => aviso((e as Error).message, "error"));
  void cargarLlamadasCola();
}
