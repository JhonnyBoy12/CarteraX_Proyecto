/**
 * Lanzador de `npm run servidor`.
 *
 * Ejecuta dist/servidor/standalone.js con el binario de Electron en modo
 * Node (ELECTRON_RUN_AS_NODE=1). Así se reutiliza el better-sqlite3 que
 * `postinstall` ya compiló para Electron, sin recompilar para Node.
 *
 * @since 0.2.0
 */
const { spawn } = require("child_process");
const path = require("path");
const electron = require("electron"); // en Node devuelve la ruta del ejecutable

const hijo = spawn(electron, [path.join(__dirname, "..", "dist", "servidor", "standalone.js")], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
hijo.on("exit", (codigo) => process.exit(codigo ?? 0));
process.on("SIGINT", () => hijo.kill("SIGINT"));
