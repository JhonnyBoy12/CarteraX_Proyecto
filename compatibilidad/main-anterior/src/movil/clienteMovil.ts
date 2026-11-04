/**
 * @file clienteMovil.ts
 * @description Cliente de red hacia **Phoenix Mobile** (app Android del
 * proyecto CONEXION_PC_A_ANDROID). Es la traducción a TypeScript de
 * `pc/phoenix_phone_test.py`, con el MISMO protocolo:
 *
 *   Phoenix Desktop ──Wi-Fi──▶ Phoenix Mobile (Android, puerto 8765)
 *     GET  /ping  → { ok, app, directCall, callPermission, device }
 *     POST /call  { "phone": "+569..." } → { ok, phone, action: "CALL" }
 *     Errores: 400 (número vacío), 403 (sin permiso CALL_PHONE), 404, 500
 *
 * Corre en el proceso principal (Node), por lo que no hay restricciones
 * CORS y la app Android no necesita cambios.
 *
 * @since 0.2.0
 */
import * as http from "http";

/** Puerto fijo en el que escucha Phoenix Mobile (`MainActivity.port`). */
export const PUERTO_MOVIL = 8765;

/** Tiempo máximo de espera por petición, igual que el prototipo Python. */
export const TIMEOUT_MS = 4000;

/**
 * Limpia lo que el usuario escribe como IP: quita `http://`, rutas y puerto.
 * Equivalente a `normalize_ip` del prototipo Python.
 *
 * @param valor Texto ingresado (ej. `"http://192.168.1.25:8765/"`).
 * @returns Sólo la IP/host (ej. `"192.168.1.25"`).
 */
export function normalizarIp(valor: string): string {
  let v = (valor ?? "").trim();
  v = v.replace(/^https?:\/\//i, "");
  v = v.split("/")[0];
  v = v.split(":")[0];
  return v.trim();
}

/**
 * Deja un número telefónico sólo con dígitos, conservando el `+` inicial.
 * Equivalente a `normalize_phone` del prototipo Python.
 *
 * @param valor Número tal como viene del Excel/CSV o del usuario.
 * @returns Número normalizado, ej. `"+56 9 1234-5678"` → `"+56912345678"`.
 */
export function normalizarTelefono(valor: string): string {
  const v = (valor ?? "").trim();
  if (!v) return "";
  const mas = v.startsWith("+");
  return (mas ? "+" : "") + v.replace(/\D/g, "");
}

/**
 * Valida que el número tenga al menos 7 dígitos (regla del prototipo).
 * @param numero Número ya normalizado.
 */
export function telefonoEsValido(numero: string): boolean {
  return numero.replace(/\D/g, "").length >= 7;
}

/** Respuesta HTTP cruda del teléfono. */
interface RespuestaHttp {
  status: number;
  cuerpo: Record<string, unknown>;
}

/**
 * Hace una petición HTTP con cuerpo JSON y respuesta JSON.
 * Equivalente a `http_json` del prototipo Python.
 *
 * @param ip IP del teléfono (ya normalizada).
 * @param ruta Ruta, ej. `"/ping"`.
 * @param metodo `"GET"` o `"POST"`.
 * @param payload Objeto a enviar como JSON (sólo POST).
 * @returns Código de estado y JSON de respuesta (aunque sea 4xx/5xx).
 * @throws Error de red (timeout, conexión rechazada, host inalcanzable).
 */
function httpJson(
  ip: string,
  ruta: string,
  metodo: "GET" | "POST" = "GET",
  payload?: unknown
): Promise<RespuestaHttp> {
  return new Promise((resolve, reject) => {
    const cuerpo = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload), "utf-8");
    const req = http.request(
      {
        host: ip,
        port: PUERTO_MOVIL,
        path: ruta,
        method: metodo,
        timeout: TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          ...(cuerpo ? { "Content-Type": "application/json", "Content-Length": cuerpo.length } : {}),
        },
      },
      (res) => {
        const trozos: Buffer[] = [];
        res.on("data", (t: Buffer) => trozos.push(t));
        res.on("end", () => {
          const texto = Buffer.concat(trozos).toString("utf-8");
          try {
            resolve({ status: res.statusCode ?? 0, cuerpo: texto ? JSON.parse(texto) : {} });
          } catch {
            reject(new Error(`Respuesta no válida del teléfono: ${texto.slice(0, 120)}`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`El teléfono no respondió en ${TIMEOUT_MS / 1000} s`)));
    req.on("error", (e: NodeJS.ErrnoException) => reject(new Error(traducirErrorRed(e))));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

/**
 * Convierte códigos de error de Node en mensajes comprensibles.
 * @param e Error de socket.
 */
function traducirErrorRed(e: NodeJS.ErrnoException): string {
  switch (e.code) {
    case "ECONNREFUSED":
      return "Conexión rechazada: ¿Phoenix Mobile está abierta en el teléfono?";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "Teléfono inalcanzable: verifica que PC y teléfono estén en la misma Wi-Fi.";
    case "ENOTFOUND":
      return "IP inválida o no encontrada.";
    default:
      return e.message;
  }
}

/**
 * Prueba la conexión con el teléfono (`GET /ping`).
 * Nunca lanza error: si falla devuelve `conectado: false` con el detalle.
 *
 * @param ipIngresada IP tal como la escribió el usuario.
 * @returns Estado del teléfono (modelo, permiso de llamadas, etc.).
 * @example
 * const estado = await pingMovil("192.168.1.25");
 * if (estado.conectado) console.log(estado.dispositivo);
 */
export async function pingMovil(ipIngresada: string): Promise<Phoenix.EstadoMovil> {
  const ip = normalizarIp(ipIngresada);
  if (!ip) return { conectado: false, ip: null, puerto: PUERTO_MOVIL, detalle: "Ingresa la IP que aparece en Phoenix Mobile." };

  try {
    const { status, cuerpo } = await httpJson(ip, "/ping");
    if (status === 200 && cuerpo.ok) {
      return {
        conectado: true,
        ip,
        puerto: PUERTO_MOVIL,
        dispositivo: String(cuerpo.device ?? "Android"),
        permisoLlamadas: Boolean(cuerpo.callPermission),
        llamadaDirecta: Boolean(cuerpo.directCall),
      };
    }
    return { conectado: false, ip, puerto: PUERTO_MOVIL, detalle: "El teléfono respondió, pero la respuesta no fue válida." };
  } catch (e) {
    return { conectado: false, ip, puerto: PUERTO_MOVIL, detalle: (e as Error).message };
  }
}

/**
 * Ordena al teléfono iniciar una llamada (`POST /call`). Android usa
 * `ACTION_CALL` con la SIM del propio teléfono.
 *
 * @param ipIngresada IP del teléfono.
 * @param telefono Número a llamar (se normaliza aquí).
 * @returns Número enviado y acción confirmada por Android.
 * @throws Error con el mensaje devuelto por Android (ej. falta permiso
 *         CALL_PHONE → 403) o el error de red.
 */
export async function llamarDesdeMovil(
  ipIngresada: string,
  telefono: string
): Promise<{ numero: string; accion: string }> {
  const ip = normalizarIp(ipIngresada);
  if (!ip) throw new Error("No hay IP configurada para Phoenix Mobile.");

  const numero = normalizarTelefono(telefono);
  if (!telefonoEsValido(numero)) throw new Error(`Número inválido: "${telefono}"`);

  const { status, cuerpo } = await httpJson(ip, "/call", "POST", { phone: numero });
  if (status === 200 && cuerpo.ok) {
    return { numero, accion: String(cuerpo.action ?? "CALL") };
  }
  throw new Error(String(cuerpo.error ?? `Respuesta inesperada del teléfono (HTTP ${status})`));
}

/** Estado de la llamada observado por Phoenix Mobile. */
export interface EstadoLlamadaMovil {
  callId: number;
  estado: "IDLE" | "RINGING" | "OFFHOOK";
  completada: boolean;
  contestada: boolean | null;
  duracion: number;
  telefono: string | null;
}

/** Consulta el estado de la llamada actual en el teléfono Android. */
export async function obtenerEstadoLlamadaMovil(ipIngresada: string): Promise<EstadoLlamadaMovil> {
  const ip = normalizarIp(ipIngresada);
  if (!ip) throw new Error("No hay IP configurada para Phoenix Mobile.");
  const { status, cuerpo } = await httpJson(ip, "/call-status");
  if (status !== 200 || !cuerpo.ok) throw new Error(String(cuerpo.error ?? "No se pudo consultar el estado de la llamada."));
  return {
    callId: Number(cuerpo.callId ?? 0),
    estado: String(cuerpo.state ?? "IDLE") as EstadoLlamadaMovil["estado"],
    completada: Boolean(cuerpo.completed),
    contestada: cuerpo.answered === null || cuerpo.answered === undefined ? null : Boolean(cuerpo.answered),
    duracion: Number(cuerpo.duration ?? 0),
    telefono: cuerpo.phone ? String(cuerpo.phone) : null,
  };
}

/** Confirma al teléfono que CarteraX ya procesó la llamada finalizada. */
export async function confirmarEstadoLlamadaMovil(ipIngresada: string): Promise<void> {
  const ip = normalizarIp(ipIngresada);
  if (!ip) return;
  await httpJson(ip, "/call-status/ack", "POST", {});
}
