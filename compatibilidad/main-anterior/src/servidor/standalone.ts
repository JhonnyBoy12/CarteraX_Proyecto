/**
 * @file standalone.ts
 * @description Punto de entrada del backend como SERVIDOR INDEPENDIENTE
 * (sin ventana). Útil para:
 *  - Montar el backend en un PC central y que otros PC usen la interfaz
 *    desde el navegador (http://IP-DEL-SERVIDOR:3737).
 *  - Probar la API con Postman / curl / Thunder Client.
 *
 * Se ejecuta con `npm run servidor`, que usa el Node interno de Electron
 * (`ELECTRON_RUN_AS_NODE=1`) para que `better-sqlite3` funcione sin
 * recompilar (ver `scripts/servidor.js`).
 *
 * Variables de entorno:
 *  - `PHOENIX_PUERTO`   Puerto (por defecto 3737)
 *  - `PHOENIX_RED`      `1` = escuchar en toda la red local (por defecto 1)
 *  - `PHOENIX_DB`       Ruta de la base (por defecto ./datos/phoenix_local.db)
 *  - `PHOENIX_TOKEN`    Si se define, la API exige `Authorization: Bearer <token>`
 *
 * @since 0.2.0
 */
import * as path from "path";

import { obtenerConexion, cerrarConexion } from "../db/conexion";
import { iniciarServidor } from "./servidorHttp";

/** Arranca el servidor y registra el cierre ordenado con Ctrl+C. */
async function principal(): Promise<void> {
  const rutaDb = process.env.PHOENIX_DB ?? path.resolve(process.cwd(), "datos", "phoenix_local.db");
  const puerto = Number(process.env.PHOENIX_PUERTO ?? 3737);
  const accesoRed = (process.env.PHOENIX_RED ?? "1") === "1";

  const db = obtenerConexion(rutaDb);
  const srv = await iniciarServidor(db, { puerto, accesoRed, modo: "standalone", token: process.env.PHOENIX_TOKEN });

  console.log("");
  console.log("  ERS Phoenix — servidor backend");
  console.log("  ───────────────────────────────");
  console.log(`  Base de datos : ${rutaDb}`);
  console.log(`  Token API     : ${process.env.PHOENIX_TOKEN ? "requerido" : "no (sólo cabecera X-Phoenix-Cliente)"}`);
  for (const u of srv.estado().urls) console.log(`  Abrir         : ${u}`);
  console.log("  Ctrl+C para detener.\n");

  const salir = async () => {
    await srv.detener();
    cerrarConexion();
    process.exit(0);
  };
  process.on("SIGINT", salir);
  process.on("SIGTERM", salir);
}

principal().catch((e) => {
  console.error("No se pudo iniciar el servidor:", (e as Error).message);
  process.exit(1);
});
