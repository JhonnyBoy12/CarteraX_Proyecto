/**
 * @file vista-importar.ts
 * @description Importación de cartera (RF-07 a RF-15) con vista previa y
 * elección del mes al que pertenece el archivo.
 */

let archivoElegido: { nombre: string; ruta: string } | null = null;
let previaActual: Phoenix.PreviaArchivo | null = null;
/** Archivo cuyas observaciones se pueden descargar (sigue disponible tras importar). */
let rutaObservaciones: string | null = null;

function nombreSeparador(sep?: string): string {
  return ({ ";": "punto y coma", ",": "coma", "\t": "tabulador", "|": "barra vertical" } as Record<string, string>)[sep ?? ""] ?? sep ?? "";
}

async function seleccionarArchivo(a: { nombre: string; ruta: string }): Promise<void> {
  archivoElegido = a;
  rutaObservaciones = a.ruta;
  $("resultado-importacion").hidden = true;
  $("previa").hidden = false;
  $("zona-carga").classList.add("compacta");
  $("previa-nombre").textContent = a.nombre;
  $("previa-meta").textContent = "Leyendo archivo…";
  $("previa-pestanas").innerHTML = "";
  $("previa-hoja").innerHTML = "";
  $boton("btn-confirmar-importacion").disabled = true;
  try {
    previaActual = await Api.previsualizar(a.ruta);
    mostrarPrevia(previaActual);
  } catch (e) {
    $("previa-meta").textContent = "";
    $("previa-hoja").innerHTML = `<p class="form-error">${esc((e as Error).message)}</p>`;
  }
}

function mostrarPrevia(p: Phoenix.PreviaArchivo): void {
  const totalFilas = p.hojas.reduce((s, h) => s + h.totalFilas, 0);
  const sinRut = p.hojas.reduce((s, h) => s + h.filasSinRut, 0);
  const partes = [p.formato.toUpperCase()];
  if (p.separador) partes.push(`separado por ${nombreSeparador(p.separador)}`);
  if (p.codificacion) partes.push(`codificación ${p.codificacion}`);
  partes.push(`${numero(totalFilas)} filas en ${p.hojas.length} ${p.hojas.length === 1 ? "tabla" : "hojas"}`);
  $("previa-meta").textContent = partes.join(", ");

  // Lo que realmente se cargará: sin las filas que la revisión rechaza.
  const rechazadas = p.hojas.reduce((s, h) => s + (h.validacion?.filasRechazadas ?? h.filasSinRut), 0);
  const aCargar = totalFilas - Math.max(sinRut, rechazadas);
  const boton = $boton("btn-confirmar-importacion");
  boton.disabled = aCargar <= 0;
  boton.textContent = aCargar > 0 ? `Importar ${numero(aCargar)} ${aCargar === 1 ? "fila" : "filas"}` : "No hay filas con RUT";

  $("previa-pestanas").innerHTML = p.hojas
    .map((h, i) => `<button class="pestana ${i === 0 ? "activa" : ""}" role="tab" data-indice="${i}">${esc(h.hoja)}<small>${numero(h.totalFilas)}</small></button>`)
    .join("");
  if (p.hojas.length) pintarHojaPrevia(p.hojas[0]);
  else $("previa-hoja").innerHTML = `<p class="bajada">El archivo no contiene filas con datos.</p>`;
}

function pintarHojaPrevia(h: Phoenix.PreviaHoja): void {
  const reconocidas = h.columnas.filter((c) => c.campo).length;
  const tieneRut = h.columnas.some((c) => c.campo === "rut");
  const avisoRut = tieneRut
    ? h.filasSinRut > 0 ? `<span><b>${numero(h.filasSinRut)}</b> filas sin RUT se omitirán</span>` : ""
    : `<span class="texto-alerta">No se encontró una columna de RUT: esta hoja no cargará clientes</span>`;
  const v = h.validacion;
  const rechazos = new Set<number>(
    (v?.observaciones ?? []).filter((o) => o.nivel === "rechazo").flatMap((o) => o.filas.map((f) => f.fila))
  );
  const encabezados = `<th class="col-fila">Fila</th>` + h.columnas.map((c) => `<th>${esc(c.original)}</th>`).join("");
  const filas = h.muestra
    .map((f, i) => {
      const n = i + 2;
      const marcas = new Set(v?.marcas[n] ?? []);
      return `<tr class="${rechazos.has(n) ? "fila-rechazo" : ""}"><td class="col-fila">${n}</td>${h.columnas
        .map((c) => `<td class="${marcas.has(c.original) ? "celda-marca" : ""}">${esc(f[c.original])}</td>`)
        .join("")}</tr>`;
    })
    .join("");
  $("previa-hoja").innerHTML = `
    <div class="resumen-hoja"><span><b>${numero(h.totalFilas)}</b> filas</span><span><b>${reconocidas}</b> de ${h.columnas.length} columnas reconocidas</span>${avisoRut}</div>
    <div class="columnas">${h.columnas
      .map((c) => (c.campo ? `<span class="columna reconocida" title="Se carga como ${esc(c.campo)}">${esc(c.original)}</span>` : `<span class="columna ignorada" title="No se carga">${esc(c.original)}</span>`))
      .join("")}</div>
    ${v ? panelRevision(v, h.totalFilas) : ""}
    <h3 class="titulo-muestra">Primeras ${numero(h.muestra.length)} filas del archivo</h3>
    <div class="tabla-envoltura"><table class="tabla-muestra"><thead><tr>${encabezados}</tr></thead><tbody>${filas}</tbody></table></div>`;
}

/** Panel «Revisión de datos»: qué no se carga, qué se carga con observaciones y qué hacer. */
function panelRevision(v: Phoenix.ValidacionHoja, total: number): string {
  const cifra = (clase: string, valor: number, texto: string, icono: string) =>
    `<div class="${clase}" ${valor === 0 ? "data-cero" : ""}>${icono}<dd>${numero(valor)}</dd><dt>${texto}</dt></div>`;
  const cuerpo = v.observaciones.length
    ? `<ul class="observaciones">${v.observaciones
        .map((o) => {
          const filas = o.filas
            .slice(0, 50)
            .map(
              (f) => `<tr><td class="num">${f.fila}</td><td class="sin-corte">${esc(f.rut ?? "—")}</td><td>${esc(f.nombre ?? "—")}</td>
                <td>${esc(f.campo ?? "")}</td><td class="valor">${f.valor === null ? "<em>vacío</em>" : esc(f.valor)}</td></tr>`
            )
            .join("");
          const resto = o.total - Math.min(o.filas.length, 50);
          return `<li class="ob-${o.nivel}"><details>
              <summary>${o.nivel === "rechazo" ? ICONO.rechazo : ICONO.aviso}<span class="ob-titulo">${esc(o.titulo)}</span>
                <span class="ob-total">${numero(o.total)} ${o.total === 1 ? "fila" : "filas"}</span>${ICONO.flecha}
                <span class="ob-efecto">${esc(o.efecto)}</span></summary>
              <div class="ob-cuerpo">
                <p class="ob-accion"><b>Qué hacer</b><span>${esc(o.accion)}</span></p>
                <div class="tabla-envoltura ob-filas"><table class="tabla-compacta">
                  <thead><tr><th class="num">Fila</th><th>RUT</th><th>Nombre</th><th>Columna</th><th>Valor en el archivo</th></tr></thead>
                  <tbody>${filas}</tbody></table></div>
                ${resto > 0 ? `<p class="ob-mas">y ${numero(resto)} filas más en la descarga de observaciones.</p>` : ""}
              </div></details></li>`;
        })
        .join("")}</ul>`
    : `<p class="revision-limpia">${ICONO.ok}Todas las filas se cargan sin observaciones.</p>`;
  return `<section class="revision" aria-label="Revisión de datos">
      <header class="revision-cab">
        <div><h3>Revisión de datos</h3><p>Así quedará cada fila al importar. Nada se ha guardado todavía.</p></div>
        ${v.observaciones.length ? `<button class="btn secundario pequeño" type="button" data-descargar-observaciones>Descargar observaciones (Excel)</button>` : ""}
      </header>
      <dl class="revision-cifras">
        ${cifra("rc-ok", v.filasValidas, `de ${numero(total)} se cargan sin observaciones`, ICONO.ok)}
        ${cifra("rc-aviso", v.filasConAvisos, "se cargan con observaciones", ICONO.aviso)}
        ${cifra("rc-rechazo", v.filasRechazadas, "no se cargan", ICONO.rechazo)}
      </dl>
      ${cuerpo}
    </section>`;
}

async function descargarObservaciones(ruta: string, boton?: HTMLButtonElement | null): Promise<void> {
  const r = await intentar(() => Api.exportarObservaciones(ruta), boton);
  avisoArchivo(r, "Observaciones guardadas");
}

async function confirmarImportacion(): Promise<void> {
  if (!archivoElegido) return;
  const mes = $input("importar-mes").value;
  if (!/^\d{4}-\d{2}$/.test(mes)) return aviso("Elige el mes al que corresponde la cartera.", "error");
  const boton = $boton("btn-confirmar-importacion");
  boton.disabled = true;
  boton.textContent = "Importando…";
  try {
    const { resultado: r, contexto } = await Api.importar(archivoElegido.ruta, mes);
    const cargados = r.hojas.reduce((s, h) => s + h.cargados, 0);
    const errores = r.hojas.reduce((s, h) => s + h.conError, 0);
    const conAvisos = previaActual?.hojas.reduce((s, h) => s + (h.validacion?.filasConAvisos ?? 0), 0) ?? 0;
    const observaciones =
      errores || conAvisos
        ? `<p class="bajada">${[
            errores ? `${numero(errores)} ${errores === 1 ? "fila no se cargó" : "filas no se cargaron"}` : "",
            conAvisos ? `${numero(conAvisos)} se cargaron con observaciones` : "",
          ]
            .filter(Boolean)
            .join(" y ")}. Descarga el detalle para corregirlas en el archivo de origen.</p>`
        : "";
    aplicarContexto(contexto);
    $("previa").hidden = true;
    $("zona-carga").classList.remove("compacta");
    const res = $("resultado-importacion");
    res.hidden = false;
    res.innerHTML = `<section class="bloque resultado-ok">
        <h2>${esc(r.archivo)} quedó en la cartera de ${esc(contexto.periodo.nombre)}</h2>
        <p class="bajada">${numero(cargados)} filas cargadas${errores ? `, ${numero(errores)} con error u omitidas` : ""}. Los clientes que ya tenías conservan su estado y sus gestiones.</p>
        <div class="tabla-envoltura"><table class="tabla-compacta">
          <thead><tr><th>Hoja</th><th class="num">Cargadas</th><th class="num">Normalizadas</th><th class="num">Con error</th></tr></thead>
          <tbody>${r.hojas.map((h) => `<tr><td>${esc(h.hoja)}</td><td class="num">${numero(h.cargados)}</td><td class="num">${numero(h.corregidos)}</td><td class="num">${numero(h.conError)}</td></tr>`).join("")}</tbody>
        </table></div>
        ${observaciones}
        <div class="acciones"><button class="btn primario" data-ir="dashboard">Ver dashboard</button><button class="btn secundario" data-ir="clientes">Ver clientes</button>${
          observaciones ? `<button class="btn texto" data-descargar-observaciones>Descargar observaciones (Excel)</button>` : ""
        }</div>
      </section>`;
    aviso(`Importadas ${numero(cargados)} filas.`, "ok");
    archivoElegido = null;
    previaActual = null;
    void cargarHistorialImportaciones();
  } catch (e) {
    aviso(`No se pudo importar: ${(e as Error).message}`, "error");
    boton.disabled = false;
    boton.textContent = "Reintentar importación";
  }
}

async function cargarHistorialImportaciones(): Promise<void> {
  const cuerpo = document.querySelector("#tabla-historial tbody")!;
  try {
    const h = await Api.historialImportaciones();
    cuerpo.innerHTML = h.length
      ? h
          .map((f) => `<tr><td class="sin-corte">${fechaHora(f.fecha)}</td><td>${esc(f.periodo)}</td><td>${esc(f.archivo_nombre)}</td><td>${esc(f.hoja_nombre)}</td>
            <td class="num">${numero(f.registros_cargados)}</td><td class="num">${numero(f.registros_con_error)}</td></tr>`)
          .join("")
      : filaVacia(6, "Aún no se ha importado ningún archivo.");
  } catch (e) {
    cuerpo.innerHTML = filaVacia(6, (e as Error).message);
  }
}

function prepararImportar(): void {
  const zona = $("zona-carga");
  const elegir = async () => {
    const ruta = await intentar(() => Api.elegirArchivo());
    if (ruta) void seleccionarArchivo({ nombre: ruta.split(/[\\/]/).pop() ?? ruta, ruta });
  };
  zona.addEventListener("click", () => void elegir());
  zona.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void elegir();
    }
  });
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("encima");
  });
  window.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) zona.classList.remove("encima");
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    zona.classList.remove("encima");
    const f = e.dataTransfer?.files?.[0];
    if (!f || !App.contexto) return;
    if (vistaActual !== "importar") irA("importar");
    void seleccionarArchivo({ nombre: f.name, ruta: Api.rutaDeArchivo(f) });
  });
  $("btn-confirmar-importacion").addEventListener("click", () => void confirmarImportacion());
  $("btn-cancelar-previa").addEventListener("click", () => {
    archivoElegido = null;
    $("previa").hidden = true;
    $("zona-carga").classList.remove("compacta");
  });
  ["previa-hoja", "resultado-importacion"].forEach((id) =>
    $(id).addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-descargar-observaciones]");
      if (b && rutaObservaciones) void descargarObservaciones(rutaObservaciones, b);
    })
  );
  $("previa-pestanas").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".pestana");
    if (!b || !previaActual) return;
    document.querySelectorAll(".pestana").forEach((p) => p.classList.toggle("activa", p === b));
    pintarHojaPrevia(previaActual.hojas[Number(b.dataset.indice)]);
  });
}

function entrarImportar(): void {
  const mes = $input("importar-mes");
  if (!mes.value && App.contexto) mes.value = App.contexto.periodo.id;
  void cargarHistorialImportaciones();
}
