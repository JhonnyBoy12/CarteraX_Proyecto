/**
 * @file servicioExportacion.ts
 * @description Genera los archivos descargables (RF-25):
 *  - Excel (.xlsx) del reporte mensual: Resumen, Estados, Tramos, Rangos,
 *    Actividad, Clientes y Alertas.
 *  - Excel/CSV del listado de clientes filtrado.
 *  - HTML imprimible del reporte, que el proceso principal convierte a PDF.
 *
 * No toca la base ni Electron: recibe datos y devuelve bytes o texto.
 * @since 0.3.0
 */
import * as XLSX from "xlsx";

import { estadoPorCodigo } from "../dominio/estados";
import { desdeUtcSqlite } from "./fechas";

const FORMATO_PESOS = '"$"#,##0';

const pesos = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString("es-CL");
const numero = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : n.toLocaleString("es-CL"));
const nombreEstado = (c: string): string => {
  try {
    return estadoPorCodigo(c).nombre;
  } catch {
    return c;
  }
};
const fechaHora = (t: string | null): string => {
  if (!t) return "";
  const d = desdeUtcSqlite(t);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
};
const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Hoja a partir de filas de objetos, con anchos y formato de pesos en las
 * columnas indicadas.
 */
function hoja(filas: Array<Record<string, unknown>>, columnasPesos: string[] = []): XLSX.WorkSheet {
  const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ "": "Sin datos" }]);
  const encabezados = filas.length ? Object.keys(filas[0]) : [""];
  ws["!cols"] = encabezados.map((h) => ({
    wch: Math.min(60, Math.max(h.length + 2, ...filas.slice(0, 200).map((f) => String(f[h] ?? "").length + 2))),
  }));
  const rango = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  encabezados.forEach((h, c) => {
    if (!columnasPesos.includes(h)) return;
    for (let r = 1; r <= rango.e.r; r++) {
      const celda = ws[XLSX.utils.encode_cell({ r, c })];
      if (celda && celda.t === "n") celda.z = FORMATO_PESOS;
    }
  });
  return ws;
}

/** Filas de clientes para Excel/CSV. */
function filasClientes(clientes: Phoenix.ClienteReporte[]): Array<Record<string, unknown>> {
  return clientes.map((c) => ({
    RUT: c.dv ? `${c.rut}-${c.dv}` : c.rut,
    Nombre: c.nombre,
    Estado: nombreEstado(c.estado),
    Deuda: c.deuda,
    Recuperado: c.recuperado,
    "Días mora": c.diasMora ?? "",
    Tramo: c.tramo ?? "",
    Prioridad: c.prioridad,
    "Fecha compromiso": c.fechaCompromiso ?? "",
    "Monto compromiso": c.montoCompromiso ?? "",
    "Última gestión": fechaHora(c.ultimaGestion),
    "Último comentario": c.ultimoComentario ?? "",
    Teléfonos: c.telefonos,
  }));
}

/** Convierte una fila de cartera en fila de reporte. */
export function aClienteReporte(f: Phoenix.ClienteFila): Phoenix.ClienteReporte {
  return {
    rut: f.rut,
    dv: f.dv,
    nombre: f.nombre,
    deuda: f.deuda,
    diasMora: f.diasMora,
    tramo: f.tramo,
    estado: f.estado,
    recuperado: f.montoRecuperado,
    prioridad: f.prioridad,
    ultimaGestion: f.ultimaGestion,
    ultimoComentario: f.ultimoComentario,
    fechaCompromiso: f.fechaCompromiso,
    montoCompromiso: f.montoCompromiso,
    telefonos: f.telefonos.filter((t) => t.valido).map((t) => t.numero).join(" / "),
  };
}

/** Excel completo de un reporte mensual. */
export function excelReporte(r: Phoenix.ReporteDetalle): Buffer {
  const d = r.dashboard;
  const k = d.kpis;
  const libro = XLSX.utils.book_new();

  const resumen: Array<[string, string | number]> = [
    ["Reporte", r.titulo],
    ["Período", r.periodoNombre],
    ["Generado", fechaHora(r.generadoEn)],
    ["Tipo", r.automatico ? "Cierre automático" : "Guardado por el ejecutivo"],
    ["Notas", r.notas ?? ""],
    ["", ""],
    ["Clientes en cartera", k.clientes],
    ["Deuda total", k.deudaTotal],
    ["Recuperado", k.recuperado],
    ["% recuperado", k.pctRecuperado / 100],
    ["Deuda pendiente", k.deudaPendiente],
    ["Meta mensual", k.metaMensual],
    ["Avance de meta", k.pctMeta === null ? "Sin meta" : k.pctMeta / 100],
    ["Compromisos vigentes", k.compromisosVigentes],
    ["Monto en compromisos", k.montoCompromisos],
    ["Compromisos vencidos", k.compromisosVencidos],
    ["Clientes gestionados", k.gestionados],
    ["% gestionados", k.pctGestionados / 100],
    ["Mora promedio (días)", k.moraPromedio ?? ""],
    ["Llamadas del período", k.llamadasPeriodo],
    ["Llamadas contestadas", k.contactadasPeriodo],
    ["Contactabilidad", k.pctContactabilidad === null ? "" : k.pctContactabilidad / 100],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet([["Indicador", "Valor"], ...resumen]);
  wsResumen["!cols"] = [{ wch: 26 }, { wch: 40 }];
  resumen.forEach(([etiqueta, valor], i) => {
    const celda = wsResumen[XLSX.utils.encode_cell({ r: i + 1, c: 1 })];
    if (!celda || typeof valor !== "number") return;
    if (/Deuda|Recuperado|Meta mensual|Monto/.test(etiqueta)) celda.z = FORMATO_PESOS;
    if (/%|Avance|Contactabilidad/.test(etiqueta)) celda.z = "0.0%";
  });
  XLSX.utils.book_append_sheet(libro, wsResumen, "Resumen");

  XLSX.utils.book_append_sheet(
    libro,
    hoja(d.porEstado.map((s) => ({ Estado: nombreEstado(s.estado), Clientes: s.clientes, Deuda: s.deuda })), ["Deuda"]),
    "Por estado"
  );
  XLSX.utils.book_append_sheet(
    libro,
    hoja(d.porTramo.map((s) => ({ Tramo: s.tramo, Clientes: s.clientes, Deuda: s.deuda })), ["Deuda"]),
    "Por tramo"
  );
  XLSX.utils.book_append_sheet(
    libro,
    hoja(d.porRango.map((s) => ({ "Rango de deuda": s.rango, Clientes: s.clientes, Deuda: s.deuda })), ["Deuda"]),
    "Por rango"
  );
  XLSX.utils.book_append_sheet(
    libro,
    hoja(
      d.actividad.map((a) => ({ Fecha: a.fecha, Gestiones: a.gestiones, Llamadas: a.llamadas, "Cambios de estado": a.cambios, Recuperado: a.recuperado })),
      ["Recuperado"]
    ),
    "Actividad diaria"
  );
  XLSX.utils.book_append_sheet(
    libro,
    hoja(filasClientes(r.clientesDetalle), ["Deuda", "Recuperado", "Monto compromiso"]),
    "Clientes"
  );
  XLSX.utils.book_append_sheet(
    libro,
    hoja(d.alertas.map((a) => ({ Nivel: a.nivel, RUT: a.rut, Nombre: a.nombre, Detalle: a.detalle }))),
    "Alertas"
  );

  return XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Excel o CSV de una lista de clientes. */
export function archivoClientesReporte(clientes: Phoenix.ClienteReporte[], formato: "xlsx" | "csv"): Buffer {
  const ws = hoja(filasClientes(clientes), ["Deuda", "Recuperado", "Monto compromiso"]);
  if (formato === "csv") {
    // BOM + punto y coma: Excel en español lo abre bien con doble clic.
    return Buffer.from("\uFEFF" + XLSX.utils.sheet_to_csv(ws, { FS: ";" }), "utf-8");
  }
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, ws, "Clientes");
  return XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * Excel con las filas observadas en la revisión previa a importar: una fila
 * por problema, con qué pasa y qué hacer, para corregir el archivo de origen.
 * @since 0.3.1
 */
export function archivoObservaciones(items: Array<{ hoja: string; observacion: Phoenix.ObservacionImportacion }>): Buffer {
  const filas = items.flatMap(({ hoja: nombreHoja, observacion: o }) =>
    o.filas.map((f) => ({
      Hoja: nombreHoja,
      Fila: f.fila,
      Resultado: o.nivel === "rechazo" ? "No se carga" : "Se carga con observación",
      Problema: o.titulo,
      Columna: f.campo ?? "",
      "Valor en el archivo": f.valor ?? "",
      RUT: f.rut ?? "",
      Nombre: f.nombre ?? "",
      "Qué pasa": o.efecto,
      "Qué hacer": o.accion,
    }))
  );
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja(filas), "Observaciones");
  return XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Excel o CSV del listado de clientes (filtrado). */
export function archivoClientes(filas: Phoenix.ClienteFila[], formato: "xlsx" | "csv"): Buffer {
  return archivoClientesReporte(filas.map(aClienteReporte), formato);
}

/** Barra horizontal simple para el PDF (sin JavaScript). */
function barras(items: Array<{ etiqueta: string; valor: number; texto: string; color?: string }>): string {
  const max = Math.max(1, ...items.map((i) => i.valor));
  return `<table class="barras">${items
    .map(
      (i) => `<tr><td class="et">${esc(i.etiqueta)}</td>
      <td class="pista"><div style="width:${Math.max(0.5, (i.valor / max) * 100)}%;background:${i.color ?? "#e8630a"}"></div></td>
      <td class="val">${esc(i.texto)}</td></tr>`
    )
    .join("")}</table>`;
}

const COLORES_TONO: Record<string, string> = {
  gris: "#9aa3ab", azul: "#2563eb", celeste: "#0891b2", ambar: "#d97706", violeta: "#7c3aed",
  naranja: "#e8630a", "verde-claro": "#65a30d", verde: "#15803d", rojo: "#dc2626",
  "rojo-fuerte": "#991b1b", pizarra: "#475569", negro: "#1f2937",
};

/** HTML imprimible del reporte (A4). El proceso principal lo pasa a PDF. */
export function htmlReporte(r: Phoenix.ReporteDetalle, ejecutivo: string): string {
  const d = r.dashboard;
  const k = d.kpis;
  const tarjeta = (titulo: string, valor: string, nota = "") =>
    `<div class="kpi"><span>${esc(titulo)}</span><b>${esc(valor)}</b>${nota ? `<small>${esc(nota)}</small>` : ""}</div>`;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(r.titulo)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #1e2b33; font-size: 10.5px; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #e8630a; padding-bottom: 8px; margin-bottom: 14px; }
  header h1 { margin: 0; font-size: 20px; } header p { margin: 2px 0 0; color: #5b6770; }
  .marca { font-weight: 700; color: #e8630a; font-size: 13px; letter-spacing: .04em; text-align: right; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .kpi { border: 1px solid #e3e6e9; border-radius: 6px; padding: 8px 10px; }
  .kpi span { display: block; color: #5b6770; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
  .kpi b { display: block; font-size: 16px; margin-top: 2px; } .kpi small { color: #5b6770; }
  h2 { font-size: 12.5px; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #e3e6e9; }
  .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 5px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
  th { background: #f6f4f1; font-size: 9.5px; text-transform: uppercase; letter-spacing: .03em; color: #5b6770; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  .barras td { border: 0; padding: 2px 4px; } .barras .et { width: 34%; } .barras .val { width: 24%; text-align: right; white-space: nowrap; }
  .barras .pista { background: #f3f4f6; border-radius: 3px; } .barras .pista div { height: 10px; border-radius: 3px; }
  .meta { height: 10px; background: #f3f4f6; border-radius: 5px; overflow: hidden; margin-top: 4px; }
  .meta div { height: 100%; background: #e8630a; }
  .notas { background: #fdf3ea; border-left: 3px solid #e8630a; padding: 6px 10px; margin-bottom: 12px; }
  tr { page-break-inside: avoid; } .salto { page-break-before: always; }
  footer { margin-top: 18px; color: #8a949c; font-size: 9px; text-align: center; }
</style></head><body>
<header>
  <div><h1>${esc(r.titulo)}</h1><p>${esc(r.periodoNombre)} · ${esc(ejecutivo)} · generado ${esc(fechaHora(r.generadoEn))}${r.automatico ? " · cierre automático" : ""}</p></div>
  <div class="marca">CARTERAX<br>PHOENIX</div>
</header>
${r.notas ? `<div class="notas">${esc(r.notas)}</div>` : ""}
<div class="kpis">
  ${tarjeta("Deuda total", pesos(k.deudaTotal), `${numero(k.clientes)} clientes`)}
  ${tarjeta("Recuperado", pesos(k.recuperado), `${k.pctRecuperado.toLocaleString("es-CL")}% de la deuda`)}
  ${tarjeta("Deuda pendiente", pesos(k.deudaPendiente))}
  ${tarjeta("Compromisos vigentes", numero(k.compromisosVigentes), `${pesos(k.montoCompromisos)} · ${k.compromisosVencidos} vencidos`)}
  ${tarjeta("Gestionados", `${k.pctGestionados.toLocaleString("es-CL")}%`, `${numero(k.gestionados)} de ${numero(k.clientes)}`)}
  ${tarjeta("Mora promedio", k.moraPromedio === null ? "—" : `${numero(k.moraPromedio)} días`)}
  ${tarjeta("Llamadas", numero(k.llamadasPeriodo), `${numero(k.contactadasPeriodo)} contestadas`)}
  ${tarjeta("Contactabilidad", k.pctContactabilidad === null ? "—" : `${k.pctContactabilidad.toLocaleString("es-CL")}%`)}
</div>
${
  k.metaMensual > 0
    ? `<div><b>Avance de meta:</b> ${pesos(k.recuperado)} de ${pesos(k.metaMensual)} (${(k.pctMeta ?? 0).toLocaleString("es-CL")}%)
       <div class="meta"><div style="width:${Math.min(100, k.pctMeta ?? 0)}%"></div></div></div>`
    : ""
}
<div class="dos">
  <section><h2>Deuda por estado de cobranza</h2>${barras(
    d.porEstado.map((s) => {
      let color = "#e8630a";
      try { color = COLORES_TONO[estadoPorCodigo(s.estado).tono] ?? color; } catch { /* estado antiguo */ }
      return { etiqueta: `${nombreEstado(s.estado)} (${s.clientes})`, valor: s.deuda, texto: pesos(s.deuda), color };
    })
  )}</section>
  <section><h2>Deuda por tramo de mora</h2>${barras(
    d.porTramo.map((s) => ({ etiqueta: `${s.tramo} (${s.clientes})`, valor: s.deuda, texto: pesos(s.deuda) }))
  )}</section>
</div>
<div class="dos">
  <section><h2>Clientes por rango de deuda</h2>${barras(
    d.porRango.map((s) => ({ etiqueta: s.rango, valor: s.clientes, texto: `${s.clientes} · ${pesos(s.deuda)}`, color: "#b5470a" }))
  )}</section>
  <section><h2>Mayores deudas</h2><table><thead><tr><th>Cliente</th><th>Estado</th><th class="n">Deuda</th></tr></thead><tbody>${d.topDeuda
    .slice(0, 8)
    .map((c) => `<tr><td>${esc(c.nombre)}<br><small>${esc(c.rut)}${c.dv ? "-" + esc(c.dv) : ""}</small></td><td>${esc(nombreEstado(c.estado))}</td><td class="n">${pesos(c.deuda)}</td></tr>`)
    .join("")}</tbody></table></section>
</div>
${
  d.alertas.length
    ? `<h2>Alertas al cierre (${d.alertas.length})</h2><table><thead><tr><th>Nivel</th><th>Cliente</th><th>Detalle</th></tr></thead><tbody>${d.alertas
        .slice(0, 25)
        .map((a) => `<tr><td>${esc(a.nivel)}</td><td>${esc(a.nombre)} · ${esc(a.rut)}</td><td>${esc(a.detalle)}</td></tr>`)
        .join("")}</tbody></table>`
    : ""
}
<h2 class="salto">Detalle de clientes (${r.clientesDetalle.length})</h2>
<table><thead><tr><th>RUT</th><th>Nombre</th><th>Estado</th><th class="n">Deuda</th><th class="n">Recuperado</th><th class="n">Mora</th><th>Compromiso</th><th>Último comentario</th></tr></thead><tbody>
${r.clientesDetalle
  .map(
    (c) => `<tr><td>${esc(c.rut)}${c.dv ? "-" + esc(c.dv) : ""}</td><td>${esc(c.nombre)}</td><td>${esc(nombreEstado(c.estado))}</td>
    <td class="n">${pesos(c.deuda)}</td><td class="n">${c.recuperado ? pesos(c.recuperado) : ""}</td><td class="n">${c.diasMora ?? ""}</td>
    <td>${c.fechaCompromiso ? esc(c.fechaCompromiso) + (c.montoCompromiso ? " · " + pesos(c.montoCompromiso) : "") : ""}</td>
    <td>${esc((c.ultimoComentario ?? "").slice(0, 120))}</td></tr>`
  )
  .join("")}
</tbody></table>
<footer>CarteraX Phoenix · reporte generado localmente · ${esc(new Date().toLocaleString("es-CL"))}</footer>
</body></html>`;
}
