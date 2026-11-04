/**
 * @file preload.ts
 * @description Puente seguro ventana ↔ backend (contextIsolation activo).
 * Expone `window.phoenixAPI` con un único `invocar` restringido a los
 * canales conocidos, más la ruta de archivos arrastrados.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

/** Prefijos de canal permitidos (los canales viven en ipc/rutas.ts). */
const PERMITIDOS = /^(auth|contexto|catalogo|importacion|clientes|dashboard|reportes|movil|cola|config|respaldo|sistema|recordatorios):[a-z-]+$/;

contextBridge.exposeInMainWorld("phoenixAPI", {
  invocar: (canal: string, ...args: unknown[]) => {
    if (!PERMITIDOS.test(canal)) return Promise.resolve({ ok: false, error: `Canal no permitido: ${canal}` });
    return ipcRenderer.invoke(canal, ...args);
  },
  /** Ruta en disco de un archivo arrastrado a la ventana. */
  rutaDeArchivo: (archivo: File): string => webUtils.getPathForFile(archivo),
});
