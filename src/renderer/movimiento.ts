/**
 * @file movimiento.ts
 * @description Capa de movimiento de la interfaz (sólo presentación).
 * Observa el DOM que pintan las vistas y le agrega:
 *  - el indicador del menú que se desliza hasta la sección activa,
 *  - las cifras del dashboard que cuentan hasta su valor,
 *  - el foco de la franja: al pasar por un estado se atenúan los demás.
 * No llama a la API ni cambia datos. Respeta «reducir movimiento».
 */

const MOVIMIENTO_REDUCIDO = window.matchMedia("(prefers-reduced-motion: reduce)");

// ============================ Indicador del menú ============================

function prepararIndicadorMenu(): void {
  const menu = document.querySelector<HTMLElement>(".menu");
  if (!menu) return;
  const indicador = document.createElement("span");
  indicador.className = "menu-indicador";
  indicador.setAttribute("aria-hidden", "true");
  menu.prepend(indicador);

  const mover = () => {
    const activo = menu.querySelector<HTMLElement>(".menu-item.activo");
    indicador.classList.toggle("visible", !!activo);
    if (!activo) return;
    indicador.style.transform = `translateY(${activo.offsetTop}px)`;
    indicador.style.height = `${activo.offsetHeight}px`;
  };
  new MutationObserver(mover).observe(menu, { subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", mover);
  mover();
}

// ============================ Cifras que cuentan ============================

/** Primer número de un texto en formato es-CL ("$1.254", "94,5 %", "12,8 M"). */
const RE_CIFRA = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/;

function contar(el: HTMLElement): void {
  const nodo = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && RE_CIFRA.test(n.textContent ?? "")) as Text | undefined;
  if (!nodo) return;
  const original = nodo.textContent!;
  const m = original.match(RE_CIFRA)!;
  const decimales = m[0].includes(",") ? m[0].split(",")[1].length : 0;
  const objetivo = Number(m[0].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(objetivo) || objetivo === 0) return;
  const formato = (v: number) =>
    original.replace(m[0], v.toLocaleString("es-CL", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }));
  const inicio = performance.now();
  const duracion = 750;
  const paso = (t: number) => {
    const p = Math.min(1, (t - inicio) / duracion);
    const suave = 1 - Math.pow(1 - p, 4);
    nodo.textContent = p < 1 ? formato(objetivo * suave) : original;
    if (p < 1 && nodo.isConnected) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

function prepararCifras(contenedorId: string): void {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;
  new MutationObserver(() => {
    if (MOVIMIENTO_REDUCIDO.matches) return;
    cont.querySelectorAll<HTMLElement>(".d-total dd, .d-par dd, .d-indicadores dd, .cifras-linea dd").forEach(contar);
  }).observe(cont, { childList: true });
}

// ============================ Foco de la franja ============================

function prepararFocoFranja(): void {
  const foco = (ev: Event, activo: boolean) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".franja-seg[data-estado], .franja-leyenda [data-estado]");
    const zona = el?.closest<HTMLElement>(".d-distribucion");
    if (!el || !zona) return;
    zona.querySelectorAll<HTMLElement>("[data-estado]").forEach((x) => x.classList.toggle("foco", activo && x.dataset.estado === el.dataset.estado));
    zona.classList.toggle("con-foco", activo);
  };
  document.addEventListener("mouseover", (ev) => foco(ev, true));
  document.addEventListener("mouseout", (ev) => foco(ev, false));
  document.addEventListener("focusin", (ev) => foco(ev, true));
  document.addEventListener("focusout", (ev) => foco(ev, false));
}

prepararIndicadorMenu();
prepararCifras("dashboard-contenido");
prepararCifras("reporte-detalle");
prepararFocoFranja();
