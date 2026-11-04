/**
 * Copia los archivos no-TypeScript a dist/ después de `tsc`.
 * Reemplaza el `node -e "..."` en línea que tenía el script "build" en la
 * v0.1.0 (misma función, ahora mantenible y con más archivos).
 *
 * @since 0.2.0
 */
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
const copias = [
  ["src/db/schema.sql", "dist/db/schema.sql"],
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/styles.css", "dist/renderer/styles.css"],
];

for (const [origen, destino] of copias) {
  const d = path.join(raiz, destino);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(path.join(raiz, origen), d);
  console.log(`  copiado ${origen} → ${destino}`);
}
