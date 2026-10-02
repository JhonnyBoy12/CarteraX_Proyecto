/**
 * @file preload.ts
 * @description Puente seguro entre la ventana (renderer) y el backend (main).
 * Expone `window.phoenixAPI` con `contextBridge` (contextIsolation activo).
 *
 * v0.2.0: se mantienen los 4 métodos originales con el mismo nombre y se
 * agregan los nuevos. `elegirArchivoExcel` / `importarExcel` siguen
 * existiendo y ahora también aceptan CSV.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("phoenixAPI", {
  login: (email: string, password: string) => ipcRenderer.invoke("auth:login", email, password),
  obtenerSesion: () => ipcRenderer.invoke("auth:sesion"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  // ------------------------- Métodos originales v0.1.0 -------------------------

  /** Abre el selector de archivos (Excel o CSV). Devuelve la ruta o null. */
  elegirArchivoExcel: (): Promise<string | null> => ipcRenderer.invoke("dialogo:elegir-excel"),

  /** Importa un archivo (Excel o CSV) por su ruta. */
  importarExcel: (rutaExcel: string) => ipcRenderer.invoke("importacion:ejecutar", rutaExcel),

  /** Resumen de cartera para el panel. */
  obtenerResumen: () => ipcRenderer.invoke("resumen:obtener"),

  /** Historial de importaciones. */
  obtenerHistorial: () => ipcRenderer.invoke("importaciones:historial"),

  // ------------------------------ Métodos v0.2.0 ------------------------------

  /** Alias con nombre neutro de `elegirArchivoExcel`. */
  elegirArchivoCartera: (): Promise<string | null> => ipcRenderer.invoke("dialogo:elegir-excel"),

  /** Alias con nombre neutro de `importarExcel`. */
  importarArchivo: (ruta: string) => ipcRenderer.invoke("importacion:ejecutar", ruta),

  /** Vista previa sin importar. */
  previsualizarArchivo: (ruta: string) => ipcRenderer.invoke("importacion:previsualizar", ruta),

  /**
   * Ruta en disco de un archivo arrastrado a la ventana (drag & drop).
   * Usa `webUtils.getPathForFile` (reemplazo oficial de `File.path`).
   */
  rutaDeArchivo: (archivo: File): string => webUtils.getPathForFile(archivo),

  listarClientes: (filtro: unknown) => ipcRenderer.invoke("clientes:listar", filtro),
  listarCategorias: () => ipcRenderer.invoke("clientes:categorias"),

  obtenerMovil: () => ipcRenderer.invoke("movil:obtener"),
  probarMovil: (ip?: string) => ipcRenderer.invoke("movil:probar", ip),
  llamarMovil: (numero: string, clienteId?: string | null) => ipcRenderer.invoke("movil:llamar", numero, clienteId),
  listarLlamadas: () => ipcRenderer.invoke("movil:llamadas"),
  estadoCola: () => ipcRenderer.invoke("cola:estado"),
  llamarSiguienteCola: () => ipcRenderer.invoke("cola:llamar-siguiente"),
  iniciarCola: () => ipcRenderer.invoke("cola:iniciar"),
  actualizarCola: () => ipcRenderer.invoke("cola:actualizar"),
  detenerCola: () => ipcRenderer.invoke("cola:detener"),

  estadoServidor: () => ipcRenderer.invoke("servidor:estado"),
  configurarServidor: (config: unknown) => ipcRenderer.invoke("servidor:configurar", config),

  abrirExterno: (url: string) => ipcRenderer.invoke("sistema:abrir-externo", url),
});
