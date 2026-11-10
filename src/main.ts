/**
 * @file main.ts
 * @description Proceso principal de Electron (Phoenix Desktop).
 *
 *  1. Garantiza una sola instancia (dos ventanas no deben escribir la misma base).
 *  2. Abre la base SQLite local del usuario (RNF-14).
 *  3. Registra los canales IPC y crea la ventana.
 */
import { app, BrowserWindow, Menu, shell } from "electron";
import * as path from "path";
import Database from "better-sqlite3";

import { obtenerConexion, cerrarConexion } from "./db/conexion";
import { registrarManejadoresIpc } from "./ipc/manejadoresIpc";
import { asegurarUsuarioInicial } from "./servicios/servicioAuth";

let ventanaPrincipal: BrowserWindow | null = null;
let db: Database.Database | null = null;
let alSalir: (() => void) | null = null;

/**
 * La app abre siempre la interfaz moderna (dist/nova). La clásica
 * (dist/renderer) queda sólo para desarrollo: --clasica o CARTERAX_UI=clasica.
 */
type Interfaz = "renderer" | "nova";
let interfaz: Interfaz = "nova";

function interfazInicial(): Interfaz {
  if (process.argv.includes("--clasica") || process.env.CARTERAX_UI === "clasica") return "renderer";
  return "nova";
}

function fondoInterfaz(): string {
  return interfaz === "nova" ? "#0c1019" : "#f5f3f0";
}

/** Base local en la carpeta de datos del usuario (ej. %APPDATA%/CarteraX Phoenix). */
function rutaBaseDatos(): string {
  return path.join(app.getPath("userData"), "carterax_fusion.db");
}

function obtenerDb(): Database.Database {
  if (!db || !db.open) db = obtenerConexion(rutaBaseDatos());
  return db;
}

function crearMenu(): void {
  const plantilla: Electron.MenuItemConstructorOptions[] = [
    { label: "Archivo", submenu: [{ role: "quit", label: "Salir" }] },
    {
      label: "Editar",
      submenu: [
        { role: "undo", label: "Deshacer" },
        { role: "redo", label: "Rehacer" },
        { type: "separator" },
        { role: "cut", label: "Cortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Pegar" },
        { role: "selectAll", label: "Seleccionar todo" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "reload", label: "Recargar" },
        { type: "separator" },
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
        { role: "resetZoom", label: "Tamaño real" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pantalla completa" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools", label: "Herramientas de desarrollo" } as Electron.MenuItemConstructorOptions]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(plantilla));
}

function crearVentana(): void {
  ventanaPrincipal = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: "CarteraX Phoenix",
    backgroundColor: fondoInterfaz(),
    autoHideMenuBar: true,
    icon: path.join(__dirname, "renderer", "assets", "icono.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  ventanaPrincipal.loadFile(path.join(__dirname, interfaz, "index.html"));
  ventanaPrincipal.once("ready-to-show", () => {
    ventanaPrincipal?.maximize();
    ventanaPrincipal?.show();
  });
  // La app nunca navega fuera de index.html; los enlaces externos van al navegador.
  ventanaPrincipal.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  ventanaPrincipal.webContents.on("will-navigate", (e) => e.preventDefault());
  ventanaPrincipal.on("closed", () => (ventanaPrincipal = null));
}

// Interfaz en español de Chile (fechas dd-mm-aaaa en los campos de fecha).
app.commandLine.appendSwitch("lang", "es-CL");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (ventanaPrincipal) {
      if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
      ventanaPrincipal.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("cl.carterax.desktop");
    interfaz = interfazInicial();
    asegurarUsuarioInicial(obtenerDb());
    alSalir = registrarManejadoresIpc(obtenerDb, () => ventanaPrincipal);
    crearMenu();
    crearVentana();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });
  });

  app.on("before-quit", () => {
    try {
      alSalir?.();
    } catch {
      /* la base pudo cerrarse antes (restauración) */
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    cerrarConexion();
    db = null;
  });
}
