/**
 * @file main.ts
 * @description Proceso principal de Electron (BACKEND de la app de escritorio).
 *
 * Responsabilidades:
 *  1. Abrir la base SQLite local del usuario.
 *  2. Crear la ventana principal (FRONTEND / renderer).
 *  3. Registrar los canales IPC (`ipc/manejadoresIpc.ts`).
 *  4. Iniciar el servidor HTTP embebido (`servidor/gestorServidor.ts`) para
 *     la arquitectura cliente-servidor (navegador / otros PC).
 *
 * Cambios v0.2.0:
 *  - Los handlers IPC se movieron a `ipc/manejadoresIpc.ts` (mismos canales).
 *  - Se inicia el servidor HTTP embebido (si falla, la app sigue por IPC).
 *  - Ventana más amplia (1280×800, mínimo 1024×680) para el nuevo diseño.
 *  - Modo servidor sin ventana: `"ERS Phoenix.exe" --servidor` (o
 *    `electron . --servidor`). Sirve para dejar un PC como servidor central
 *    usando el MISMO instalador. Escucha en la red local en el puerto
 *    configurado (3737 por defecto, o `--puerto=NNNN`).
 */
import { app, BrowserWindow } from "electron";
import * as path from "path";
import Database from "better-sqlite3";

import { obtenerConexion, cerrarConexion } from "./db/conexion";
import { registrarManejadoresIpc } from "./ipc/manejadoresIpc";
import { arrancarSegunConfig, detenerServidor, leerConfigServidor } from "./servidor/gestorServidor";
import { iniciarServidor } from "./servidor/servidorHttp";
import { asegurarUsuarioInicial } from "./servicios/servicioAuth";

/** `true` si la app se abrió con `--servidor` (sin ventana). */
const MODO_SOLO_SERVIDOR = process.argv.includes("--servidor");

/**
 * Lee `--puerto=NNNN` de la línea de comandos.
 * @returns Puerto indicado o `null` si no viene.
 */
function puertoDeArgumentos(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--puerto="));
  const p = arg ? Number(arg.split("=")[1]) : NaN;
  return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : null;
}

/**
 * Arranca sólo el backend HTTP, sin ventana, visible en la red local.
 * Si el puerto está ocupado informa el error y cierra la app.
 */
async function arrancarSoloServidor(): Promise<void> {
  const puerto = puertoDeArgumentos() ?? leerConfigServidor(obtenerDb()).puerto;
  try {
    const srv = await iniciarServidor(obtenerDb(), {
      puerto,
      accesoRed: true,
      modo: "standalone",
      token: process.env.PHOENIX_TOKEN,
    });
    console.log("[ERS Phoenix] Modo servidor. Base:", rutaBaseDatos());
    srv.estado().urls.forEach((u) => console.log("[ERS Phoenix] Abrir:", u));
  } catch (e) {
    console.error("[ERS Phoenix] No se pudo iniciar el servidor:", (e as Error).message);
    app.exit(1);
  }
}

let ventanaPrincipal: BrowserWindow | null = null;
let db: Database.Database | null = null;

/**
 * Ruta de la base local del usuario. `app.getPath('userData')` apunta a una
 * carpeta propia de la app (ej. %APPDATA%/ers-phoenix en Windows), que
 * persiste entre ejecuciones y es distinta para cada usuario/PC — esto es
 * justo lo que RNF-13/RNF-18 piden: cada usuario con su copia local.
 */
function rutaBaseDatos(): string {
  return path.join(app.getPath("userData"), "carterax_fusion.db");
}

/** Devuelve la conexión abierta (la abre si hiciera falta). */
function obtenerDb(): Database.Database {
  if (!db) db = obtenerConexion(rutaBaseDatos());
  return db;
}

/** Crea la ventana principal y carga la interfaz. */
function crearVentana(): void {
  ventanaPrincipal = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: "CarteraX",
    backgroundColor: "#f6f4f1",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ventanaPrincipal.loadFile(path.join(__dirname, "renderer", "index.html"));
  ventanaPrincipal.on("closed", () => (ventanaPrincipal = null));
}

app.whenReady().then(async () => {
  obtenerDb();
  asegurarUsuarioInicial(obtenerDb());

  if (MODO_SOLO_SERVIDOR) {
    await arrancarSoloServidor();
    return; // sin ventana: la app sigue viva mientras el servidor escuche
  }

  registrarManejadoresIpc(obtenerDb, () => ventanaPrincipal);
  crearVentana();

  // Servidor HTTP embebido (cliente-servidor). No bloquea la ventana.
  arrancarSegunConfig(obtenerDb()).then((e) => {
    if (e.activo) console.log("[servidor] Escuchando en", e.urls.join(", "));
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

app.on("window-all-closed", async () => {
  await detenerServidor();
  cerrarConexion();
  db = null;
  if (process.platform !== "darwin") app.quit();
});
