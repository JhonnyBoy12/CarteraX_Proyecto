/**
 * @file servidorHttp.ts
 * @description Servidor HTTP del backend (arquitectura cliente-servidor).
 *
 * Expone la misma lógica que la ventana Electron usa por IPC, pero como API
 * REST JSON, y además sirve la interfaz (`dist/renderer`) para abrirla desde
 * un navegador. Sin dependencias nuevas: usa el módulo `http` de Node.
 *
 * Se puede ejecutar de dos formas:
 *  1. **Embebido en Electron** (por defecto): `main.ts` lo inicia en
 *     `127.0.0.1:3737`. Desde la sección «Servidor» de la app se puede
 *     habilitar el acceso desde la red local (0.0.0.0).
 *  2. **Independiente** (`npm run servidor`): ver `standalone.ts`.
 *
 * Endpoints (todos responden `{ ok, datos?, error? }`):
 *
 * | Método | Ruta                          | Descripción                          |
 * |--------|-------------------------------|--------------------------------------|
 * | GET    | /api/salud                    | Estado del servidor                  |
 * | GET    | /api/resumen                  | KPIs, top deuda, categorías, tramos  |
 * | GET    | /api/historial                | Historial de importaciones           |
 * | GET    | /api/clientes?texto&categoria&pagina&porPagina | Clientes   |
 * | GET    | /api/categorias               | Categorías de gestión                |
 * | POST   | /api/importar/previsualizar   | Cuerpo = bytes del archivo           |
 * | POST   | /api/importar                 | Cuerpo = bytes del archivo           |
 * | GET    | /api/movil                    | IP guardada de Phoenix Mobile        |
 * | POST   | /api/movil/probar             | `{ ip? }`                            |
 * | POST   | /api/movil/llamar             | `{ numero, clienteId? }`             |
 * | GET    | /api/movil/llamadas           | Últimas llamadas                     |
 * | GET    | /api/servidor                 | Estado/URLs del servidor             |
 *
 * Para subir archivos se envía el archivo crudo como cuerpo y su nombre en
 * la cabecera `X-Nombre-Archivo` (codificado con `encodeURIComponent`).
 *
 * Seguridad:
 *  - Toda ruta `/api/*` exige la cabecera `X-Phoenix-Cliente`. Un sitio web
 *    externo no puede enviarla sin preflight CORS (que este servidor no
 *    acepta), lo que bloquea ataques CSRF hacia `localhost`.
 *  - Si existe la variable de entorno `PHOENIX_TOKEN`, además se exige
 *    `Authorization: Bearer <token>`.
 *  - Los estáticos se sirven sólo desde la carpeta del renderer.
 *
 * @since 0.2.0
 */
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";

import * as cartera from "../servicios/servicioCartera";
import * as movil from "../servicios/servicioMovil";
import { TAMANO_MAXIMO_BYTES } from "../importacion/lectorArchivos";

/** Versión informada en /api/salud. */
const VERSION = "0.2.0";

/** Carpeta con index.html, styles.css y los .js del renderer. */
const CARPETA_ESTATICOS = path.join(__dirname, "..", "renderer");

const TIPOS_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

/** Opciones para iniciar el servidor. */
export interface OpcionesServidor {
  puerto: number;
  /** `true` → escucha en 0.0.0.0 (red local). `false` → sólo 127.0.0.1. */
  accesoRed: boolean;
  modo: "electron" | "standalone";
  /** Token opcional (si se define, se exige `Authorization: Bearer`). */
  token?: string;
}

/** Control del servidor en ejecución. */
export interface ControlServidor {
  /** Detiene el servidor y libera el puerto. */
  detener(): Promise<void>;
  /** Estado actual, incluyendo URLs de acceso. */
  estado(): Phoenix.EstadoServidor;
}

/** Error con código HTTP asociado. */
class ErrorHttp extends Error {
  constructor(public codigo: number, mensaje: string) {
    super(mensaje);
  }
}

/**
 * IPv4 locales (no loopback) del equipo, para mostrar URLs de red.
 * @returns Lista de IPs, ej. `["192.168.1.10"]`.
 */
export function ipsLocales(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

/**
 * URLs por las que se puede abrir la interfaz web.
 * @param puerto Puerto en uso.
 * @param accesoRed Si escucha en la red local.
 */
export function urlsDeAcceso(puerto: number, accesoRed: boolean): string[] {
  const urls = [`http://localhost:${puerto}`];
  if (accesoRed) urls.push(...ipsLocales().map((ip) => `http://${ip}:${puerto}`));
  return urls;
}

/** Envía una respuesta JSON con el envoltorio estándar. */
function enviarJson(res: http.ServerResponse, codigo: number, cuerpo: Phoenix.Respuesta<unknown>): void {
  const datos = Buffer.from(JSON.stringify(cuerpo), "utf-8");
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": datos.length,
    "Cache-Control": "no-store",
  });
  res.end(datos);
}

/**
 * Lee el cuerpo completo de la petición con límite de tamaño.
 * @param req Petición entrante.
 * @param limite Bytes máximos.
 * @throws ErrorHttp 413 si se excede el límite.
 */
function leerCuerpo(req: http.IncomingMessage, limite: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const trozos: Buffer[] = [];
    let total = 0;
    req.on("data", (t: Buffer) => {
      total += t.length;
      if (total > limite) {
        reject(new ErrorHttp(413, `Archivo demasiado grande (máx. ${Math.round(limite / 1048576)} MB)`));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on("end", () => resolve(Buffer.concat(trozos)));
    req.on("error", reject);
  });
}

/** Lee y parsea un cuerpo JSON (exige Content-Type application/json). */
async function leerJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new ErrorHttp(415, "Se esperaba Content-Type: application/json");
  }
  const cuerpo = await leerCuerpo(req, 1024 * 1024);
  try {
    return cuerpo.length ? JSON.parse(cuerpo.toString("utf-8")) : {};
  } catch {
    throw new ErrorHttp(400, "JSON inválido");
  }
}

/**
 * Guarda el archivo subido en una carpeta temporal, ejecuta `accion` y
 * borra la carpeta al terminar (aunque haya error).
 *
 * @param req Petición con el archivo como cuerpo y `X-Nombre-Archivo`.
 * @param accion Función que recibe la ruta temporal y el nombre original.
 */
async function conArchivoSubido<T>(
  req: http.IncomingMessage,
  accion: (ruta: string, nombre: string) => T
): Promise<T> {
  const nombreCabecera = String(req.headers["x-nombre-archivo"] ?? "");
  const nombre = path.basename(decodeURIComponent(nombreCabecera)).replace(/[<>:"|?*]/g, "_");
  if (!nombre) throw new ErrorHttp(400, "Falta la cabecera X-Nombre-Archivo");

  const cuerpo = await leerCuerpo(req, TAMANO_MAXIMO_BYTES);
  if (!cuerpo.length) throw new ErrorHttp(400, "El archivo llegó vacío");

  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-subida-"));
  const ruta = path.join(carpeta, nombre);
  try {
    fs.writeFileSync(ruta, cuerpo);
    return accion(ruta, nombre);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
}

/**
 * Sirve un archivo estático del renderer (con protección de rutas).
 * @returns `true` si lo encontró y respondió.
 */
function servirEstatico(rutaUrl: string, res: http.ServerResponse): boolean {
  const relativa = rutaUrl === "/" ? "index.html" : decodeURIComponent(rutaUrl).replace(/^\/+/, "");
  const absoluta = path.normalize(path.join(CARPETA_ESTATICOS, relativa));
  if (!absoluta.startsWith(CARPETA_ESTATICOS + path.sep) || !fs.existsSync(absoluta) || fs.statSync(absoluta).isDirectory()) {
    return false;
  }
  res.writeHead(200, { "Content-Type": TIPOS_MIME[path.extname(absoluta)] ?? "application/octet-stream" });
  fs.createReadStream(absoluta).pipe(res);
  return true;
}

/**
 * Crea e inicia el servidor HTTP.
 *
 * @param db Conexión SQLite compartida con el resto del backend.
 * @param opciones Puerto, acceso en red, modo y token.
 * @returns Promesa con el control del servidor (o error si el puerto está ocupado).
 * @example
 * const srv = await iniciarServidor(db, { puerto: 3737, accesoRed: false, modo: "electron" });
 * console.log(srv.estado().urls); // ["http://localhost:3737"]
 */
export function iniciarServidor(db: Database.Database, opciones: OpcionesServidor): Promise<ControlServidor> {
  const token = opciones.token?.trim() || undefined;

  /** Tabla de rutas: "MÉTODO /ruta" → manejador. */
  const rutas: Record<string, (req: http.IncomingMessage, url: URL) => Promise<unknown> | unknown> = {
    "GET /api/salud": () => ({ app: "ERS Phoenix", version: VERSION, modo: opciones.modo, hora: new Date().toISOString() }),
    "GET /api/resumen": () => cartera.obtenerResumen(db),
    "GET /api/historial": () => cartera.obtenerHistorial(db),
    "GET /api/categorias": () => cartera.obtenerCategorias(db),
    "GET /api/clientes": (_req, url) =>
      cartera.buscarClientes(db, {
        texto: url.searchParams.get("texto") ?? undefined,
        categoria: url.searchParams.get("categoria") ?? undefined,
        pagina: Number(url.searchParams.get("pagina") ?? 1),
        porPagina: Number(url.searchParams.get("porPagina") ?? 50),
      }),
    "POST /api/importar/previsualizar": (req) => conArchivoSubido(req, (ruta, nombre) => cartera.previsualizar(ruta, nombre)),
    "POST /api/importar": (req) => conArchivoSubido(req, (ruta, nombre) => cartera.importar(db, ruta, nombre)),
    "GET /api/movil": () => ({ ip: movil.obtenerIpMovil(db) }),
    "POST /api/movil/probar": async (req) => {
      const { ip } = await leerJson(req);
      return movil.probarMovil(db, typeof ip === "string" ? ip : undefined);
    },
    "POST /api/movil/llamar": async (req) => {
      const { numero, clienteId } = await leerJson(req);
      if (typeof numero !== "string") throw new ErrorHttp(400, "Falta 'numero'");
      return movil.llamar(db, numero, typeof clienteId === "string" ? clienteId : null);
    },
    "GET /api/movil/llamadas": () => movil.obtenerLlamadas(db),
    "GET /api/servidor": () => estado(),
  };

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const metodo = (req.method ?? "GET").toUpperCase();

    if (!url.pathname.startsWith("/api/")) {
      if (metodo === "GET" && servirEstatico(url.pathname, res)) return;
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }

    try {
      if (!req.headers["x-phoenix-cliente"]) throw new ErrorHttp(403, "Falta cabecera X-Phoenix-Cliente");
      if (token && req.headers.authorization !== `Bearer ${token}`) throw new ErrorHttp(401, "Token inválido");

      const manejador = rutas[`${metodo} ${url.pathname}`];
      if (!manejador) throw new ErrorHttp(404, `Ruta no encontrada: ${metodo} ${url.pathname}`);

      const datos = await manejador(req, url);
      enviarJson(res, 200, { ok: true, datos });
    } catch (e) {
      const codigo = e instanceof ErrorHttp ? e.codigo : 500;
      enviarJson(res, codigo, { ok: false, error: (e as Error).message });
    }
  });

  const host = opciones.accesoRed ? "0.0.0.0" : "127.0.0.1";

  /** Estado público del servidor. */
  function estado(): Phoenix.EstadoServidor {
    return {
      habilitado: true,
      activo: servidor.listening,
      puerto: opciones.puerto,
      accesoRed: opciones.accesoRed,
      urls: servidor.listening ? urlsDeAcceso(opciones.puerto, opciones.accesoRed) : [],
      modo: opciones.modo,
    };
  }

  return new Promise((resolve, reject) => {
    servidor.once("error", (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === "EADDRINUSE" ? `El puerto ${opciones.puerto} ya está en uso` : e.message))
    );
    servidor.listen(opciones.puerto, host, () =>
      resolve({
        estado,
        detener: () =>
          new Promise<void>((ok) => {
            servidor.close(() => ok());
            servidor.closeAllConnections(); // evita esperar conexiones keep-alive del navegador
          }),
      })
    );
  });
}
