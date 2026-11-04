/**
 * Ejecuta un script de Node con el runtime de Electron (ELECTRON_RUN_AS_NODE).
 *
 * better-sqlite3 se compila para Electron en `npm install` (postinstall), así
 * que las pruebas que tocan la base deben correr con el Node de Electron y no
 * con el Node del sistema. Funciona igual en Windows, macOS y Linux.
 *
 * Uso: node scripts/ejecutar-con-electron.js pruebas/servicios.prueba.js
 */
const { spawnSync } = require("child_process");
const electron = require("electron");

const r = spawnSync(electron, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
process.exit(r.status ?? 1);
