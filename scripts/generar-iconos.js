/**
 * Genera todos los íconos de CarteraX y Phoenix Mobile desde
 * src/renderer/assets/logo.svg, usando Electron para rasterizar (no hace
 * falta ImageMagick):
 *  - src/renderer/assets/icono.png (512)   ícono de la ventana
 *  - build/icon.png (512) y build/icon.ico (16–256)   instaladores
 *  - Android: mipmap-*dpi/ic_launcher.png y drawable-xxxhdpi/ic_launcher_foreground.png
 *
 * Uso: npx electron scripts/generar-iconos.js
 * Los íconos anteriores quedaron respaldados en docs/logo-anterior/.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();

const raiz = path.join(__dirname, "..");
const svg = fs.readFileSync(path.join(raiz, "src", "renderer", "assets", "logo.svg"), "utf-8");
// Para el ícono adaptable de Android: sólo el trazo, el fondo lo pone el sistema.
const svgSinFondo = svg.replace(/<rect[^>]*\/>/, "");
const res = path.join(raiz, "movil", "android", "app", "src", "main", "res");

async function rasterizar(win, fuente, lado) {
  win.setContentSize(lado, lado);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    ${fuente.replace("<svg ", `<svg width="${lado}" height="${lado}" `)}</body></html>`;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 150));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: lado, height: lado });
  return img.resize({ width: lado, height: lado }).toPNG();
}

/** ICO con imágenes PNG embebidas (Windows Vista en adelante). */
function ico(pngs) {
  const cab = Buffer.alloc(6 + 16 * pngs.length);
  cab.writeUInt16LE(0, 0);
  cab.writeUInt16LE(1, 2);
  cab.writeUInt16LE(pngs.length, 4);
  let desplazamiento = cab.length;
  pngs.forEach(({ lado, datos }, i) => {
    const e = 6 + 16 * i;
    cab.writeUInt8(lado >= 256 ? 0 : lado, e);
    cab.writeUInt8(lado >= 256 ? 0 : lado, e + 1);
    cab.writeUInt16LE(1, e + 4);
    cab.writeUInt16LE(32, e + 6);
    cab.writeUInt32LE(datos.length, e + 8);
    cab.writeUInt32LE(desplazamiento, e + 12);
    desplazamiento += datos.length;
  });
  return Buffer.concat([cab, ...pngs.map((p) => p.datos)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, backgroundColor: "#00000000", useContentSize: true });
  try {
    const escribir = (destino, datos) => {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, datos);
      console.log("  ✔", path.relative(raiz, destino));
    };

    const p512 = await rasterizar(win, svg, 512);
    escribir(path.join(raiz, "src", "renderer", "assets", "icono.png"), p512);
    escribir(path.join(raiz, "build", "icon.png"), p512);

    const tamanosIco = [16, 24, 32, 48, 64, 128, 256];
    const pngsIco = [];
    for (const lado of tamanosIco) pngsIco.push({ lado, datos: await rasterizar(win, svg, lado) });
    escribir(path.join(raiz, "build", "icon.ico"), ico(pngsIco));

    const densidades = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const [d, lado] of Object.entries(densidades)) {
      escribir(path.join(res, `mipmap-${d}`, "ic_launcher.png"), await rasterizar(win, svg, lado));
    }
    escribir(path.join(res, "drawable-xxxhdpi", "ic_launcher_foreground.png"), await rasterizar(win, svgSinFondo, 432));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
