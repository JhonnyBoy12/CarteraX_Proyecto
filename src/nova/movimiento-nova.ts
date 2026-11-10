/**
 * @file movimiento-nova.ts
 * @description Capa de movimiento de Nova (sólo presentación):
 *  - indicador del menú lateral que se desliza a la sección activa,
 *  - cifras del tablero que cuentan hasta su valor al cargar,
 *  - foco de la franja de estados.
 * No llama a la API. Todo se apaga con «reducir movimiento».
 */

const REDUCIR_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Primer número en formato es-CL ("$1.254", "94,5 %", "12,8 M"). */
const RE_NUMERO = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/;

function contarHasta(el: HTMLElement): void {
  const caminante = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let nodo: Text | null = null;
  while (caminante.nextNode()) {
    const n = caminante.currentNode as Text;
    if (RE_NUMERO.test(n.textContent ?? "")) {
      nodo = n;
      break;
    }
  }
  if (!nodo) return;
  const texto = nodo;
  const original = texto.textContent!;
  const m = original.match(RE_NUMERO)!;
  const decimales = m[0].includes(",") ? m[0].split(",")[1].length : 0;
  const objetivo = Number(m[0].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(objetivo) || objetivo === 0) return;
  const formato = (v: number) => original.replace(m[0], v.toLocaleString("es-CL", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }));
  const inicio = performance.now();
  const duracion = 700;
  const paso = (t: number) => {
    const p = Math.min(1, (t - inicio) / duracion);
    const suave = 1 - Math.pow(1 - p, 4);
    texto.textContent = p < 1 ? formato(objetivo * suave) : original;
    if (p < 1 && texto.isConnected) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

/** Anima las cifras visibles de un contenedor. */
function animarCifras(cont: HTMLElement): void {
  if (REDUCIR_MOVIMIENTO.matches) return;
  cont.querySelectorAll<HTMLElement>(".cifra-anim").forEach((el) => {
    if (el.offsetParent !== null) contarHasta(el);
  });
}

function prepararIndicadorNav(): void {
  const nav = $("nav-principal");
  const indicador = nav.querySelector<HTMLElement>(".nav-indicador")!;
  const mover = () => {
    const activo = nav.querySelector<HTMLElement>(".menu-item.activo");
    indicador.classList.toggle("visible", !!activo);
    if (!activo) return;
    indicador.style.transform = `translateY(${activo.offsetTop}px)`;
    indicador.style.height = `${activo.offsetHeight}px`;
  };
  new MutationObserver(mover).observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", mover);
  mover();
}

function prepararFocoFranjaNova(): void {
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

function prepararMovimientoNova(): void {
  prepararIndicadorNav();
  prepararFocoFranjaNova();
  // Las cifras cuentan desde pintarDashboard (tablero.ts) y al cambiar de pestaña.
}
