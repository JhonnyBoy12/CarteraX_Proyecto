/**
 * @file manejadoresIpc.ts
 * @description Canales IPC entre la ventana (renderer) y el backend (main).
 * La interfaz NUNCA toca la base de datos directamente: todo pasa por aquí
 * y de aquí a la capa `servicios/`.
 *
 * v0.2.0: los 4 canales originales se movieron desde `main.ts` a este
 * archivo SIN cambiar su nombre ni la forma de su respuesta:
 *   - dialogo:elegir-excel      (ahora también acepta .csv/.tsv/.txt/.ods)
 *   - importacion:ejecutar      → { ok, resultado } | { ok:false, error }
 *   - resumen:obtener           → ResumenCartera (campos nuevos opcionales)
 *   - importaciones:historial   → ImportacionHistorial[]
 *
 * Canales nuevos (responden `{ ok, datos } | { ok:false, error }`):
 *   - importacion:previsualizar, clientes:listar, clientes:categorias
 *   - movil:obtener, movil:probar, movil:llamar, movil:llamadas
 *   - servidor:estado, servidor:configurar
 *   - sistema:abrir-externo
 *
 * @since 0.2.0
 */
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import Database from "better-sqlite3";

import * as cartera from "../servicios/servicioCartera";
import * as movil from "../servicios/servicioMovil";
import * as cola from "../servicios/servicioColaLlamadas";
import { configurarServidor, estadoServidor } from "../servidor/gestorServidor";
import { EXTENSIONES_EXCEL, EXTENSIONES_SOPORTADAS, EXTENSIONES_TEXTO } from "../importacion/lectorArchivos";

/**
 * Ejecuta una función y la envuelve en `{ ok, datos }` / `{ ok:false, error }`.
 * Evita que una excepción del backend llegue cruda a la interfaz.
 * @param fn Función síncrona o asíncrona del servicio.
 */
async function envolver<T>(fn: () => T | Promise<T>): Promise<Phoenix.Respuesta<T>> {
  try {
    return { ok: true, datos: await fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Registra todos los manejadores IPC. Se llama UNA vez desde `main.ts`.
 *
 * @param obtenerDb Función que devuelve la conexión SQLite abierta.
 * @param obtenerVentana Función que devuelve la ventana principal (para diálogos).
 */
export function registrarManejadoresIpc(
  obtenerDb: () => Database.Database,
  obtenerVentana: () => BrowserWindow | null
): void {
  // ------------------------- Canales originales v0.1.0 -------------------------

  ipcMain.handle("dialogo:elegir-excel", async () => {
    const ventana = obtenerVentana();
    const opciones: Electron.OpenDialogOptions = {
      title: "Selecciona el archivo de cartera (Excel o CSV)",
      filters: [
        { name: "Cartera (Excel o CSV)", extensions: EXTENSIONES_SOPORTADAS },
        { name: "Excel", extensions: [...EXTENSIONES_EXCEL] },
        { name: "CSV / texto", extensions: [...EXTENSIONES_TEXTO] },
      ],
      properties: ["openFile"],
    };
    const resultado = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones);
    if (resultado.canceled || resultado.filePaths.length === 0) return null;
    return resultado.filePaths[0];
  });

  ipcMain.handle("importacion:ejecutar", async (_evento, rutaArchivo: string) => {
    try {
      const resultado = cartera.importar(obtenerDb(), rutaArchivo);
      return { ok: true, resultado };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("resumen:obtener", async () => cartera.obtenerResumen(obtenerDb()));

  ipcMain.handle("importaciones:historial", async () => cartera.obtenerHistorial(obtenerDb()));

  ipcMain.handle("importaciones:borrar-datos", () => envolver(() => {
    cola.detenerCola(obtenerDb());
    return cartera.borrarDatosImportados(obtenerDb());
  }));

  // ------------------------------ Canales v0.2.0 ------------------------------

  ipcMain.handle("importacion:previsualizar", (_e, ruta: string) => envolver(() => cartera.previsualizar(ruta)));

  ipcMain.handle("clientes:listar", (_e, filtro: Phoenix.FiltroClientes) =>
    envolver(() => cartera.buscarClientes(obtenerDb(), filtro))
  );

  ipcMain.handle("clientes:categorias", () => envolver(() => cartera.obtenerCategorias(obtenerDb())));

  ipcMain.handle("movil:obtener", () => envolver(() => ({ ip: movil.obtenerIpMovil(obtenerDb()) })));

  ipcMain.handle("movil:probar", (_e, ip?: string) => envolver(() => movil.probarMovil(obtenerDb(), ip)));

  ipcMain.handle("movil:llamar", (_e, numero: string, clienteId?: string | null) =>
    envolver(() => movil.llamar(obtenerDb(), numero, clienteId ?? null))
  );

  ipcMain.handle("movil:llamadas", () => envolver(() => movil.obtenerLlamadas(obtenerDb())));

  ipcMain.handle("cola:estado", () => envolver(() => cola.obtenerEstadoCola(obtenerDb())));

  ipcMain.handle("cola:llamar-siguiente", () => envolver(() => cola.llamarSiguiente(obtenerDb())));
  ipcMain.handle("cola:iniciar", () => envolver(() => cola.iniciarCola(obtenerDb())));
  ipcMain.handle("cola:actualizar", () => envolver(() => cola.actualizarCola(obtenerDb())));
  ipcMain.handle("cola:detener", () => envolver(() => cola.detenerCola(obtenerDb())));

  ipcMain.handle("servidor:estado", () => envolver(() => estadoServidor(obtenerDb())));

  ipcMain.handle("servidor:configurar", (_e, config: Partial<Phoenix.ConfigServidor>) =>
    envolver(() => configurarServidor(obtenerDb(), config))
  );

  // Sólo se permiten URLs http(s) para no abrir rutas locales arbitrarias.
  ipcMain.handle("sistema:abrir-externo", (_e, url: string) =>
    envolver(async () => {
      if (!/^https?:\/\//i.test(url)) throw new Error("URL no permitida");
      await shell.openExternal(url);
      return true;
    })
  );
}
