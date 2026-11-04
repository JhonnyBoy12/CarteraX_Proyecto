/**
 * @file generar-documento.js
 * @description Genera el documento de arquitectura 4+1 en PDF y exporta los
 * diagramas SVG a PNG (doble resolución). Usa el Electron del proyecto, así
 * que no necesita otras dependencias.
 *
 *   npx electron docs/arquitectura/generar-documento.js
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const DIR_IMG = path.join(DIR, "img");
const DIR_PNG = path.join(DIR_IMG, "png");
const FUENTE = path.join(DIR, "..", "..", "src", "renderer", "assets", "fuentes", "archivo-variable.woff2");
const SALIDA_PDF = path.join(DIR, "CarteraX_Arquitectura_4+1.pdf");

const PIE = `<div style="width:100%;font-family:'Segoe UI',sans-serif;font-size:8px;color:#515C77;padding:0 19mm;display:flex;justify-content:space-between">
  <span>CarteraX Phoenix · Documento de arquitectura 4+1 · v1.0</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

/** Espera a que carguen las fuentes y las imágenes de la página. */
function esperarRecursos(ventana) {
  return ventana.webContents.executeJavaScript(`
    document.fonts.ready.then(() => Promise.all([...document.images].map((i) =>
      i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; }))))`);
}

async function generarPdf(svgs) {
  let html = fs.readFileSync(path.join(DIR, "documento.html"), "utf8");
  for (const archivo of svgs) {
    const marca = `<!--SVG:${path.basename(archivo, ".svg")}-->`;
    html = html.replace(marca, fs.readFileSync(path.join(DIR_IMG, archivo), "utf8"));
  }
  const temporal = path.join(DIR, "_documento.generado.html");
  fs.writeFileSync(temporal, html);
  const ventana = new BrowserWindow({ show: false, width: 1240, height: 1754 });
  try {
    await ventana.loadFile(temporal);
    await esperarRecursos(ventana);
    const pdf = await ventana.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      // Las márgenes de @page mandan: la portada (@page :first) va a sangre.
      preferCSSPageSize: true,
      margins: { top: 0.7, bottom: 0.8, left: 0.75, right: 0.75 },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: PIE,
    });
    fs.writeFileSync(SALIDA_PDF, pdf);
  } finally {
    ventana.destroy();
    fs.unlinkSync(temporal);
  }
}

async function generarPngs(svgs) {
  fs.mkdirSync(DIR_PNG, { recursive: true });
  // Cada SVG se dibuja en un canvas a doble resolución, con la fuente
  // incrustada en el propio SVG (una imagen SVG no ve las fuentes de la página).
  const fuente = fs.readFileSync(FUENTE).toString("base64");
  const estilo = `<style>@font-face{font-family:"Archivo";src:url(data:font/woff2;base64,${fuente}) format("woff2");font-weight:100 900}</style>`;
  const ventana = new BrowserWindow({ show: false });
  try {
    await ventana.loadURL("about:blank");
    for (const archivo of svgs) {
      const svg = fs.readFileSync(path.join(DIR_IMG, archivo), "utf8").replace(/(<svg[^>]*>)/, `$1${estilo}`);
      const [, ancho, alto] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg).map(Number);
      const png = await ventana.webContents.executeJavaScript(`(async () => {
        const url = URL.createObjectURL(new Blob([${JSON.stringify(svg)}], { type: "image/svg+xml" }));
        const img = new Image();
        img.src = url;
        await img.decode();
        await new Promise((r) => setTimeout(r, 150));
        const lienzo = document.createElement("canvas");
        lienzo.width = ${ancho * 2};
        lienzo.height = ${alto * 2};
        const g = lienzo.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, lienzo.width, lienzo.height);
        g.drawImage(img, 0, 0, lienzo.width, lienzo.height);
        URL.revokeObjectURL(url);
        return lienzo.toDataURL("image/png");
      })()`);
      fs.writeFileSync(path.join(DIR_PNG, archivo.replace(/\.svg$/, ".png")), Buffer.from(png.split(",")[1], "base64"));
    }
  } finally {
    ventana.destroy();
  }
}

// Sin esto Electron se cierra al destruir la ventana del PDF.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  try {
    const svgs = fs.readdirSync(DIR_IMG).filter((f) => f.endsWith(".svg")).sort();
    await generarPdf(svgs);
    console.log(`PDF: ${SALIDA_PDF}`);
    await generarPngs(svgs);
    console.log(`PNG: ${svgs.length} imágenes en ${DIR_PNG}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
