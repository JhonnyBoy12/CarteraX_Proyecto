/**
 * @file manejadoresIpc.ts
 * @description Registra los canales de `rutas.ts` en `ipcMain` e implementa
 * las operaciones que dependen de Electron (diálogos, PDF, reinicio).
 *
 * Cada canal responde `{ ok: true, datos }` o `{ ok: false, error }`, así
 * una excepción del backend nunca llega cruda a la interfaz.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { cerrarConexion, rutaDbActual } from "../db/conexion";
import { EXTENSIONES_EXCEL, EXTENSIONES_SOPORTADAS, EXTENSIONES_TEXTO } from "../importacion/lectorArchivos";
import { crearRutas, Plataforma } from "./rutas";

/** Envuelve el resultado en `{ ok, datos }` / `{ ok:false, error }`. */
async function envolver<T>(fn: () => T | Promise<T>): Promise<Phoenix.Respuesta<T>> {
  try {
    return { ok: true, datos: await fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Convierte HTML en PDF con una ventana oculta (A4, con fondos). */
async function htmlAPdf(html: string): Promise<Buffer> {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "carterax-pdf-"));
  const archivo = path.join(carpeta, "reporte.html");
  fs.writeFileSync(archivo, html, "utf-8");
  const ventana = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await ventana.loadFile(archivo);
    return await ventana.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    ventana.destroy();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
}

/**
 * Registra todos los canales. Se llama UNA vez desde `main.ts`.
 * @returns Función para cerrar la sesión activa al salir.
 */
export function registrarManejadoresIpc(
  obtenerDb: () => Database.Database,
  obtenerVentana: () => BrowserWindow | null
): () => void {
  const conVentana = <T>(fn: (v: BrowserWindow | undefined) => Promise<T>) => fn(obtenerVentana() ?? undefined);

  const plataforma: Plataforma = {
    version: app.getVersion(),

    elegirArchivoCartera: () =>
      conVentana(async (v) => {
        const opciones: Electron.OpenDialogOptions = {
          title: "Selecciona el archivo de cartera (Excel o CSV)",
          filters: [
            { name: "Cartera (Excel o CSV)", extensions: EXTENSIONES_SOPORTADAS },
            { name: "Excel", extensions: [...EXTENSIONES_EXCEL] },
            { name: "CSV / texto", extensions: [...EXTENSIONES_TEXTO] },
          ],
          properties: ["openFile"],
        };
        const r = v ? await dialog.showOpenDialog(v, opciones) : await dialog.showOpenDialog(opciones);
        return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
      }),

    elegirArchivoRespaldo: () =>
      conVentana(async (v) => {
        const opciones: Electron.OpenDialogOptions = {
          title: "Selecciona el respaldo a restaurar",
          filters: [{ name: "Respaldo CarteraX", extensions: ["db", "sqlite", "sqlite3"] }],
          properties: ["openFile"],
        };
        const r = v ? await dialog.showOpenDialog(v, opciones) : await dialog.showOpenDialog(opciones);
        return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
      }),

    guardarArchivo: (nombre, filtros, datos) =>
      conVentana(async (v) => {
        const opciones: Electron.SaveDialogOptions = {
          title: "Guardar archivo",
          defaultPath: path.join(app.getPath("downloads"), nombre),
          filters: filtros,
        };
        const r = v ? await dialog.showSaveDialog(v, opciones) : await dialog.showSaveDialog(opciones);
        if (r.canceled || !r.filePath) return null;
        fs.writeFileSync(r.filePath, datos);
        return r.filePath;
      }),

    elegirDestinoRespaldo: (nombre) =>
      conVentana(async (v) => {
        const opciones: Electron.SaveDialogOptions = {
          title: "Guardar respaldo de la base de datos",
          defaultPath: path.join(app.getPath("documents"), nombre),
          filters: [{ name: "Respaldo CarteraX", extensions: ["db"] }],
        };
        const r = v ? await dialog.showSaveDialog(v, opciones) : await dialog.showSaveDialog(opciones);
        return r.canceled || !r.filePath ? null : r.filePath;
      }),

    generarPdf: htmlAPdf,

    mostrarEnCarpeta: (ruta) => shell.showItemInFolder(ruta),

    restaurarYReiniciar: async (origen) => {
      const destino = rutaDbActual();
      if (!destino) throw new Error("No hay una base de datos abierta.");
      // Copia de seguridad de la base actual antes de reemplazarla.
      const carpeta = path.join(app.getPath("userData"), "respaldos");
      fs.mkdirSync(carpeta, { recursive: true });
      await obtenerDb().backup(path.join(carpeta, `antes_de_restaurar_${Date.now()}.db`));
      cerrarConexion();
      for (const sufijo of ["-wal", "-shm"]) fs.rmSync(destino + sufijo, { force: true });
      fs.copyFileSync(origen, destino);
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 300);
    },
  };

  const { rutas, cerrarSesion } = crearRutas(obtenerDb, plataforma);
  for (const [canal, manejador] of Object.entries(rutas)) {
    ipcMain.handle(canal, (_evento, ...args: unknown[]) => envolver(() => manejador(...args)));
  }
  return () => cerrarSesion("salida de la aplicación");
}
