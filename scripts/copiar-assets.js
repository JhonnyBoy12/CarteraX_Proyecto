/**
 * Copia a dist/ los archivos que no son TypeScript (esquema SQL, HTML,
 * estilos, fuentes e íconos). Se ejecuta después de `tsc` en `npm run build`.
 */
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
const copias = [
  ["src/db/schema.sql", "dist/db/schema.sql"],
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/styles.css", "dist/renderer/styles.css"],
  ["src/renderer/assets", "dist/renderer/assets"],
  // Interfaz Nova (el JS lo genera tsconfig.nova.json en dist/nova/nova.js).
  ["src/nova/index.html", "dist/nova/index.html"],
  ["src/nova/nova.css", "dist/nova/nova.css"],
  ["src/renderer/assets", "dist/nova/assets"],
];

// fs.cpSync de Node 22 falla al sobrescribir en carpetas de OneDrive
// (unlink con código vacío); copyFileSync sobrescribe sin borrar antes.
function copiar(o, d) {
  if (fs.statSync(o).isDirectory()) {
    fs.mkdirSync(d, { recursive: true });
    for (const n of fs.readdirSync(o)) copiar(path.join(o, n), path.join(d, n));
  } else {
    fs.copyFileSync(o, d);
  }
}

for (const [origen, destino] of copias) {
  const o = path.join(raiz, origen);
  const d = path.join(raiz, destino);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  copiar(o, d);
  console.log(`  copiado ${origen} → ${destino}`);
}
