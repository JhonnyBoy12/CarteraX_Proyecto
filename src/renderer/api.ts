/**
 * @file api.ts (renderer)
 * @description Adaptador de acceso al backend para la interfaz.
 *
 * La MISMA interfaz funciona en dos modos:
 *  - **electron**: dentro de la app de escritorio → usa `window.phoenixAPI`
 *    (IPC expuesto por `preload.ts`).
 *  - **web**: abierta desde un navegador apuntando al servidor HTTP
 *    (`http://localhost:3737` u otro PC) → usa `fetch('/api/...')`.
 *
 * El resto del renderer sólo usa el objeto global `Api` y no sabe en qué
 * modo está corriendo. Todas las funciones lanzan `Error` si el backend
 * responde `{ ok: false }`, por lo que la interfaz usa try/catch.
 *
 * Nota técnica: este archivo es un *script* (sin import/export) para que
 * funcione en el navegador sin empaquetador; comparte el ámbito global con
 * `renderer.ts`, que se carga después.
 *
 * @since 0.2.0
 */

/** Métodos expuestos por `preload.ts` (modo electron). */
interface PhoenixAPI {
  login(email: string, password: string): Promise<Phoenix.Respuesta<Phoenix.UsuarioSesion>>;
  obtenerSesion(): Promise<Phoenix.Respuesta<Phoenix.UsuarioSesion | null>>;
  logout(): Promise<Phoenix.Respuesta<boolean>>;
  elegirArchivoExcel(): Promise<string | null>;
  importarExcel(ruta: string): Promise<{ ok: boolean; resultado?: Phoenix.ResultadoImportacion; error?: string }>;
  obtenerResumen(): Promise<Phoenix.ResumenCartera>;
  obtenerHistorial(): Promise<Phoenix.ImportacionHistorial[]>;
  previsualizarArchivo(ruta: string): Promise<Phoenix.Respuesta<Phoenix.PreviaArchivo>>;
  rutaDeArchivo(archivo: File): string;
  listarClientes(filtro: Phoenix.FiltroClientes): Promise<Phoenix.Respuesta<Phoenix.PaginaClientes>>;
  listarCategorias(): Promise<Phoenix.Respuesta<string[]>>;
  obtenerMovil(): Promise<Phoenix.Respuesta<{ ip: string | null }>>;
  probarMovil(ip?: string): Promise<Phoenix.Respuesta<Phoenix.EstadoMovil>>;
  llamarMovil(numero: string, clienteId?: string | null): Promise<Phoenix.Respuesta<Phoenix.ResultadoLlamada>>;
  listarLlamadas(): Promise<Phoenix.Respuesta<Phoenix.LlamadaRegistrada[]>>;
  estadoCola(): Promise<Phoenix.Respuesta<Phoenix.EstadoColaLlamadas>>;
  llamarSiguienteCola(): Promise<Phoenix.Respuesta<Phoenix.ResultadoColaLlamadas>>;
  iniciarCola(): Promise<Phoenix.Respuesta<Phoenix.EstadoColaLlamadas>>;
  actualizarCola(): Promise<Phoenix.Respuesta<Phoenix.EstadoColaLlamadas>>;
  detenerCola(): Promise<Phoenix.Respuesta<Phoenix.EstadoColaLlamadas>>;
  estadoServidor(): Promise<Phoenix.Respuesta<Phoenix.EstadoServidor>>;
  configurarServidor(config: Partial<Phoenix.ConfigServidor>): Promise<Phoenix.Respuesta<Phoenix.EstadoServidor>>;
  abrirExterno(url: string): Promise<Phoenix.Respuesta<boolean>>;
}

/**
 * Archivo elegido por el usuario. En Electron se trabaja con la `ruta`;
 * en web con el objeto `File` (se sube al servidor).
 */
interface ArchivoSeleccionado {
  nombre: string;
  ruta?: string;
  archivo?: File;
}

/** Contrato único que usa la interfaz, independiente del modo. */
interface ClienteBackend {
  login(email: string, password: string): Promise<Phoenix.UsuarioSesion>;
  sesion(): Promise<Phoenix.UsuarioSesion | null>;
  logout(): Promise<void>;
  modo: "electron" | "web";
  elegirArchivo(): Promise<ArchivoSeleccionado | null>;
  desdeArchivoSoltado(archivo: File): ArchivoSeleccionado;
  previsualizar(a: ArchivoSeleccionado): Promise<Phoenix.PreviaArchivo>;
  importar(a: ArchivoSeleccionado): Promise<Phoenix.ResultadoImportacion>;
  resumen(): Promise<Phoenix.ResumenCartera>;
  historial(): Promise<Phoenix.ImportacionHistorial[]>;
  clientes(filtro: Phoenix.FiltroClientes): Promise<Phoenix.PaginaClientes>;
  categorias(): Promise<string[]>;
  movil(): Promise<{ ip: string | null }>;
  probarMovil(ip?: string): Promise<Phoenix.EstadoMovil>;
  llamar(numero: string, clienteId?: string | null): Promise<Phoenix.ResultadoLlamada>;
  llamadas(): Promise<Phoenix.LlamadaRegistrada[]>;
  estadoCola(): Promise<Phoenix.EstadoColaLlamadas>;
  llamarSiguienteCola(): Promise<Phoenix.ResultadoColaLlamadas>;
  iniciarCola(): Promise<Phoenix.EstadoColaLlamadas>;
  actualizarCola(): Promise<Phoenix.EstadoColaLlamadas>;
  detenerCola(): Promise<Phoenix.EstadoColaLlamadas>;
  servidor(): Promise<Phoenix.EstadoServidor>;
  configurarServidor(config: Partial<Phoenix.ConfigServidor>): Promise<Phoenix.EstadoServidor>;
  abrirExterno(url: string): Promise<void>;
}

/** Extensiones que acepta el selector en modo web (igual que el backend). */
const ACEPTA_ARCHIVOS = ".xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt";

/**
 * Extrae `datos` de una respuesta `{ ok, datos, error }` o lanza el error.
 * @param r Respuesta del backend.
 */
function desenvolver<T>(r: Phoenix.Respuesta<T>): T {
  if (!r.ok) throw new Error(r.error ?? "Error desconocido del backend");
  return r.datos as T;
}

/**
 * Cliente para modo electron (IPC vía `window.phoenixAPI`).
 * @param ipc Objeto expuesto por preload.
 */
function crearClienteElectron(ipc: PhoenixAPI): ClienteBackend {
  return {
    login: async (email, password) => desenvolver(await ipc.login(email, password)),
    sesion: async () => desenvolver(await ipc.obtenerSesion()),
    logout: async () => void desenvolver(await ipc.logout()),
    modo: "electron",
    async elegirArchivo() {
      const ruta = await ipc.elegirArchivoExcel();
      return ruta ? { nombre: ruta.split(/[\\/]/).pop() ?? ruta, ruta } : null;
    },
    desdeArchivoSoltado: (archivo) => ({ nombre: archivo.name, ruta: ipc.rutaDeArchivo(archivo) }),
    previsualizar: async (a) => desenvolver(await ipc.previsualizarArchivo(a.ruta!)),
    async importar(a) {
      const r = await ipc.importarExcel(a.ruta!);
      if (!r.ok) throw new Error(r.error);
      return r.resultado!;
    },
    resumen: () => ipc.obtenerResumen(),
    historial: () => ipc.obtenerHistorial(),
    clientes: async (f) => desenvolver(await ipc.listarClientes(f)),
    categorias: async () => desenvolver(await ipc.listarCategorias()),
    movil: async () => desenvolver(await ipc.obtenerMovil()),
    probarMovil: async (ip) => desenvolver(await ipc.probarMovil(ip)),
    llamar: async (n, id) => desenvolver(await ipc.llamarMovil(n, id ?? null)),
    llamadas: async () => desenvolver(await ipc.listarLlamadas()),
    estadoCola: async () => desenvolver(await ipc.estadoCola()),
    llamarSiguienteCola: async () => desenvolver(await ipc.llamarSiguienteCola()),
    iniciarCola: async () => desenvolver(await ipc.iniciarCola()),
    actualizarCola: async () => desenvolver(await ipc.actualizarCola()),
    detenerCola: async () => desenvolver(await ipc.detenerCola()),
    servidor: async () => desenvolver(await ipc.estadoServidor()),
    configurarServidor: async (c) => desenvolver(await ipc.configurarServidor(c)),
    abrirExterno: async (url) => void desenvolver(await ipc.abrirExterno(url)),
  };
}

/**
 * Cliente para modo web (HTTP hacia `servidorHttp.ts`).
 * Envía siempre `X-Phoenix-Cliente` (protección CSRF) y, si la página se
 * abrió con `?token=...`, la cabecera `Authorization`.
 */
function crearClienteWeb(): ClienteBackend {
  const token = new URLSearchParams(location.search).get("token");

  /** Petición genérica a la API. */
  async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
    const cabeceras: Record<string, string> = { "X-Phoenix-Cliente": "web", ...(init.headers as Record<string, string>) };
    if (token) cabeceras.Authorization = `Bearer ${token}`;
    const res = await fetch(ruta, { ...init, headers: cabeceras });
    let cuerpo: Phoenix.Respuesta<T>;
    try {
      cuerpo = await res.json();
    } catch {
      throw new Error(`El servidor respondió HTTP ${res.status} sin JSON`);
    }
    return desenvolver(cuerpo);
  }

  /** POST con cuerpo JSON. */
  const postJson = <T>(ruta: string, datos: unknown) =>
    pedir<T>(ruta, { method: "POST", body: JSON.stringify(datos), headers: { "Content-Type": "application/json" } });

  /** POST subiendo el archivo crudo. */
  const subir = <T>(ruta: string, a: ArchivoSeleccionado) =>
    pedir<T>(ruta, {
      method: "POST",
      body: a.archivo!,
      headers: { "X-Nombre-Archivo": encodeURIComponent(a.nombre), "Content-Type": "application/octet-stream" },
    });

  return {
    login: () => Promise.reject(new Error("El inicio de sesión está disponible en la aplicación de escritorio.")),
    sesion: () => Promise.resolve(null),
    logout: () => Promise.resolve(),
    modo: "web",
    elegirArchivo() {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ACEPTA_ARCHIVOS;
        input.addEventListener("change", () => {
          const f = input.files?.[0];
          resolve(f ? { nombre: f.name, archivo: f } : null);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
      });
    },
    desdeArchivoSoltado: (archivo) => ({ nombre: archivo.name, archivo }),
    previsualizar: (a) => subir("/api/importar/previsualizar", a),
    importar: (a) => subir("/api/importar", a),
    resumen: () => pedir("/api/resumen"),
    historial: () => pedir("/api/historial"),
    clientes(f) {
      const q = new URLSearchParams();
      if (f.texto) q.set("texto", f.texto);
      if (f.categoria) q.set("categoria", f.categoria);
      q.set("pagina", String(f.pagina ?? 1));
      q.set("porPagina", String(f.porPagina ?? 50));
      return pedir(`/api/clientes?${q}`);
    },
    categorias: () => pedir("/api/categorias"),
    movil: () => pedir("/api/movil"),
    probarMovil: (ip) => postJson("/api/movil/probar", { ip }),
    llamar: (numero, clienteId) => postJson("/api/movil/llamar", { numero, clienteId: clienteId ?? null }),
    llamadas: () => pedir("/api/movil/llamadas"),
    estadoCola: () => Promise.reject(new Error("La cola de llamadas se controla desde la app de escritorio.")),
    llamarSiguienteCola: () => Promise.reject(new Error("La cola de llamadas se controla desde la app de escritorio.")),
    iniciarCola: () => Promise.reject(new Error("La cola de llamadas se controla desde la app de escritorio.")),
    actualizarCola: () => Promise.reject(new Error("La cola de llamadas se controla desde la app de escritorio.")),
    detenerCola: () => Promise.reject(new Error("La cola de llamadas se controla desde la app de escritorio.")),
    servidor: () => pedir("/api/servidor"),
    configurarServidor: () => Promise.reject(new Error("La configuración del servidor sólo se cambia desde la app de escritorio.")),
    abrirExterno: async (url) => void window.open(url, "_blank", "noopener"),
  };
}

/** Instancia global usada por `renderer.ts`. */
const Api: ClienteBackend = (window as unknown as { phoenixAPI?: PhoenixAPI }).phoenixAPI
  ? crearClienteElectron((window as unknown as { phoenixAPI: PhoenixAPI }).phoenixAPI)
  : crearClienteWeb();
