/**
 * @file clienteMovil.ts
 * @description Cliente de red hacia **Phoenix Mobile** (app Android).
 *
 *   CarteraX ──Wi-Fi──▶ Phoenix Mobile (Android, puerto 8765)
 *     GET  /ping  → { ok, app, version, device, deviceId, pairing, paired, authorized,
 *                     directCall?, callPermission?, callStateTracking?, pairedWith? }
 *     POST /pair  { code, desktop } → { ok, token, device, deviceId }        (v0.4)
 *     POST /unpair                  → { ok }                                (v0.4, token)
 *     POST /call  { phone, name?, rut? } → { ok, phone, action: "CALL", callId? }   (token)
 *     GET  /call-status        → { ok, callId, state, completed, answered, duration,
 *                                  elapsed?, reachedCall?, dialFailed?, phone }    (token)
 *     POST /call-status/ack    → { ok }                                         (token)
 *     Errores: 400, 401 (no vinculado / código incorrecto), 403 (sin permiso
 *     CALL_PHONE), 404, 409 (teléfono ocupado), 429 (demasiados intentos), 500
 *
 * v0.4: el teléfono sólo obedece al computador vinculado con su código de 6
 * dígitos; el token viaja en `X-Phoenix-Token`. Las versiones 0.3 no piden
 * vínculo y siguen funcionando (ignoran la cabecera).
 *
 * Todas las conexiones las abre el computador hacia el teléfono, así que el
 * firewall de Windows (que bloquea conexiones entrantes) no interviene.
 *
 * @since 0.2.0
 */
import * as http from "http";
import * as os from "os";

/** Puerto fijo en el que escucha Phoenix Mobile. */
export const PUERTO_MOVIL = 8765;

/** Tiempo máximo de espera por petición. */
export const TIMEOUT_MS = 4000;

/** Tiempo de espera por dirección al buscar teléfonos en la red. */
const TIMEOUT_BUSQUEDA_MS = 900;

/** Dirección del teléfono y token del vínculo (si lo hay). */
export interface ConexionMovil {
  ip: string;
  token?: string | null;
}

/** Error del teléfono con su código (ej. `NO_VINCULADO`, `OCUPADO`). */
export class ErrorMovil extends Error {
  constructor(
    mensaje: string,
    readonly codigo: string | null = null,
    readonly status = 0
  ) {
    super(mensaje);
  }
}

/**
 * Limpia lo que el usuario escribe como IP: quita `http://`, rutas y puerto.
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
 * Valida que el número tenga al menos 7 dígitos.
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
 * Petición HTTP con cuerpo JSON y respuesta JSON.
 *
 * @returns Código de estado y JSON de respuesta (aunque sea 4xx/5xx).
 * @throws Error de red (timeout, conexión rechazada, host inalcanzable).
 */
function httpJson(
  conexion: ConexionMovil,
  ruta: string,
  metodo: "GET" | "POST" = "GET",
  payload?: unknown,
  timeout = TIMEOUT_MS
): Promise<RespuestaHttp> {
  return new Promise((resolve, reject) => {
    const cuerpo = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload), "utf-8");
    const req = http.request(
      {
        host: conexion.ip,
        port: PUERTO_MOVIL,
        path: ruta,
        method: metodo,
        timeout,
        headers: {
          Accept: "application/json",
          ...(conexion.token ? { "X-Phoenix-Token": conexion.token } : {}),
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
    req.on("timeout", () => req.destroy(new Error(`El teléfono no respondió en ${Math.round(timeout / 1000)} s`)));
    req.on("error", (e: NodeJS.ErrnoException) => reject(new Error(traducirErrorRed(e))));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

/** Lanza el error del teléfono con su código. */
function errorDe(r: RespuestaHttp, porDefecto: string): ErrorMovil {
  const codigo = typeof r.cuerpo.code === "string" ? r.cuerpo.code : r.status === 401 ? "NO_VINCULADO" : null;
  return new ErrorMovil(String(r.cuerpo.error ?? `${porDefecto} (HTTP ${r.status})`), codigo, r.status);
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
 * `conectado` indica que respondió; `requiereVinculo` que este computador
 * todavía no está vinculado (v0.4) y no puede darle órdenes.
 */
export async function pingMovil(ipIngresada: string, token?: string | null): Promise<Phoenix.EstadoMovil> {
  const ip = normalizarIp(ipIngresada);
  if (!ip) return { conectado: false, ip: null, puerto: PUERTO_MOVIL, detalle: "Busca el teléfono o escribe la IP que muestra Phoenix Mobile." };

  try {
    const { status, cuerpo } = await httpJson({ ip, token }, "/ping");
    if (status === 200 && cuerpo.ok) {
      const conVinculo = Boolean(cuerpo.pairing);
      const autorizado = conVinculo ? Boolean(cuerpo.authorized) : true;
      return {
        conectado: true,
        ip,
        puerto: PUERTO_MOVIL,
        dispositivo: String(cuerpo.device ?? "Android"),
        idEquipo: cuerpo.deviceId ? String(cuerpo.deviceId) : undefined,
        permisoLlamadas: autorizado ? Boolean(cuerpo.callPermission) : undefined,
        seguimientoLlamadas: autorizado ? Boolean(cuerpo.callStateTracking) : undefined,
        version: cuerpo.version ? String(cuerpo.version) : undefined,
        admiteVinculo: conVinculo,
        requiereVinculo: !autorizado,
        vinculadoConOtro: conVinculo && !autorizado && Boolean(cuerpo.paired),
        detalle: autorizado
          ? undefined
          : Boolean(cuerpo.paired)
            ? "El teléfono está vinculado con otro computador. Escribe el código que muestra para vincularlo con este."
            : "Escribe el código de 6 dígitos que muestra Phoenix Mobile para vincularlo.",
      };
    }
    return { conectado: false, ip, puerto: PUERTO_MOVIL, detalle: "El teléfono respondió, pero la respuesta no fue válida." };
  } catch (e) {
    return { conectado: false, ip, puerto: PUERTO_MOVIL, detalle: (e as Error).message };
  }
}

/**
 * Vincula este computador con el teléfono usando el código de 6 dígitos que
 * muestra Phoenix Mobile.
 * @returns Token del vínculo y datos del teléfono.
 */
export async function vincularMovil(
  ipIngresada: string,
  codigo: string,
  nombreComputador = os.hostname()
): Promise<{ token: string; dispositivo: string; idEquipo: string | null }> {
  const ip = normalizarIp(ipIngresada);
  if (!ip) throw new Error("Falta la IP del teléfono.");
  const limpio = String(codigo ?? "").replace(/\D/g, "");
  if (limpio.length !== 6) throw new Error("El código tiene 6 dígitos.");
  const r = await httpJson({ ip }, "/pair", "POST", { code: limpio, desktop: nombreComputador });
  if (r.status === 404) throw new ErrorMovil("Esta versión de Phoenix Mobile no usa código. Actualiza la app del teléfono.", "SIN_VINCULO", 404);
  if (r.status !== 200 || !r.cuerpo.ok || typeof r.cuerpo.token !== "string") throw errorDe(r, "No se pudo vincular");
  return {
    token: r.cuerpo.token,
    dispositivo: String(r.cuerpo.device ?? "Android"),
    idEquipo: r.cuerpo.deviceId ? String(r.cuerpo.deviceId) : null,
  };
}

/** Pide al teléfono olvidar este computador. No lanza error si no responde. */
export async function desvincularMovil(conexion: ConexionMovil): Promise<void> {
  try {
    await httpJson({ ...conexion, ip: normalizarIp(conexion.ip) }, "/unpair", "POST", {});
  } catch {
    /* sin conexión: igual se olvida en este computador */
  }
}

/** Teléfono encontrado al buscar en la red. */
export interface MovilEncontrado {
  ip: string;
  dispositivo: string;
  idEquipo: string | null;
  version: string | null;
  admiteVinculo: boolean;
  vinculado: boolean;
}

/**
 * Redes IPv4 privadas de este computador como prefijos /24 (ej. "192.168.1").
 * En redes más grandes sólo se recorre el /24 propio, que es donde suele
 * estar el teléfono en una oficina.
 */
export function prefijosLocales(): string[] {
  const prefijos = new Set<string>();
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      const [a, b] = i.address.split(".").map(Number);
      const privada = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
      if (privada) prefijos.add(i.address.split(".").slice(0, 3).join("."));
    }
  }
  return [...prefijos];
}

/**
 * Busca teléfonos con Phoenix Mobile en la red local: pregunta `/ping` a
 * cada dirección de las redes /24 del computador (y a 127.0.0.1, para el
 * simulador). Sólo abre conexiones salientes.
 *
 * @param token Token guardado, para marcar cuál es el teléfono vinculado.
 */
export async function buscarMoviles(token?: string | null, simultaneas = 96): Promise<MovilEncontrado[]> {
  const ips = ["127.0.0.1"];
  for (const p of prefijosLocales()) for (let n = 1; n <= 254; n++) ips.push(`${p}.${n}`);

  const encontrados: MovilEncontrado[] = [];
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < ips.length) {
      const ip = ips[siguiente++];
      try {
        const { status, cuerpo } = await httpJson({ ip, token }, "/ping", "GET", undefined, TIMEOUT_BUSQUEDA_MS);
        if (status === 200 && cuerpo.ok && String(cuerpo.app ?? "").includes("Phoenix")) {
          encontrados.push({
            ip,
            dispositivo: String(cuerpo.device ?? "Android"),
            idEquipo: cuerpo.deviceId ? String(cuerpo.deviceId) : null,
            version: cuerpo.version ? String(cuerpo.version) : null,
            admiteVinculo: Boolean(cuerpo.pairing),
            vinculado: Boolean(cuerpo.pairing) && Boolean(cuerpo.authorized),
          });
        }
      } catch {
        /* nadie en esa dirección */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(simultaneas, ips.length) }, trabajador));
  // El mismo teléfono puede responder en dos direcciones (ej. el simulador en
  // 127.0.0.1 y en la IP del PC): se deja una, preferiendo la de la red.
  const unicos = new Map<string, MovilEncontrado>();
  for (const m of encontrados) {
    const clave = m.idEquipo ?? m.ip;
    const previo = unicos.get(clave);
    if (!previo || previo.ip === "127.0.0.1") unicos.set(clave, m);
  }
  return [...unicos.values()].sort((a, b) => Number(b.vinculado) - Number(a.vinculado) || a.ip.localeCompare(b.ip, "es", { numeric: true }));
}

/**
 * Ordena al teléfono iniciar una llamada (`POST /call`) con su propia SIM.
 *
 * @returns Número enviado, acción confirmada y el id de la llamada (v0.4).
 * @throws ErrorMovil con el mensaje de Android (no vinculado, sin permiso,
 *         ocupado) o el error de red.
 */
export async function llamarDesdeMovil(
  conexion: ConexionMovil,
  telefono: string,
  cliente: { nombre?: string | null; rut?: string | null } = {}
): Promise<{ numero: string; accion: string; callId: number | null }> {
  const ip = normalizarIp(conexion.ip);
  if (!ip) throw new Error("No hay un teléfono vinculado.");

  const numero = normalizarTelefono(telefono);
  if (!telefonoEsValido(numero)) throw new Error(`Número inválido: "${telefono}"`);

  const r = await httpJson({ ...conexion, ip }, "/call", "POST", {
    phone: numero,
    name: cliente.nombre ?? undefined,
    rut: cliente.rut ?? undefined,
  });
  if (r.status === 200 && r.cuerpo.ok) {
    return { numero, accion: String(r.cuerpo.action ?? "CALL"), callId: typeof r.cuerpo.callId === "number" ? r.cuerpo.callId : null };
  }
  throw errorDe(r, "Respuesta inesperada del teléfono");
}

/** Estado de la llamada observado por Phoenix Mobile. */
export interface EstadoLlamadaMovil {
  callId: number;
  estado: "IDLE" | "RINGING" | "OFFHOOK";
  completada: boolean;
  /** `null`: el teléfono no pudo saberlo (sin permiso o sin registro de llamadas). */
  contestada: boolean | null;
  /** Segundos de conversación según el registro de llamadas de Android. */
  duracion: number;
  /** Segundos desde que se marcó hasta colgar (Phoenix Mobile 0.3.1+). */
  transcurrido: number | null;
  /** El teléfono llegó a «en curso» (v0.4; `null` en versiones anteriores). */
  alcanzoCurso: boolean | null;
  /** El teléfono no pudo marcar: sin señal, sin SIM o modo avión (v0.4). */
  falloMarcado: boolean;
  telefono: string | null;
}

/** Consulta el estado de la llamada actual en el teléfono Android. */
export async function obtenerEstadoLlamadaMovil(conexion: ConexionMovil): Promise<EstadoLlamadaMovil> {
  const ip = normalizarIp(conexion.ip);
  if (!ip) throw new Error("No hay un teléfono vinculado.");
  const r = await httpJson({ ...conexion, ip }, "/call-status");
  if (r.status !== 200 || !r.cuerpo.ok) throw errorDe(r, "No se pudo consultar el estado de la llamada");
  const c = r.cuerpo;
  return {
    callId: Number(c.callId ?? 0),
    estado: String(c.state ?? "IDLE") as EstadoLlamadaMovil["estado"],
    completada: Boolean(c.completed),
    contestada: c.answered === null || c.answered === undefined ? null : Boolean(c.answered),
    duracion: Number(c.duration ?? 0),
    transcurrido: typeof c.elapsed === "number" ? c.elapsed : null,
    alcanzoCurso: typeof c.reachedCall === "boolean" ? c.reachedCall : null,
    falloMarcado: Boolean(c.dialFailed),
    telefono: c.phone ? String(c.phone) : null,
  };
}

/** Confirma al teléfono que CarteraX ya procesó la llamada finalizada. */
export async function confirmarEstadoLlamadaMovil(conexion: ConexionMovil): Promise<void> {
  const ip = normalizarIp(conexion.ip);
  if (!ip) return;
  await httpJson({ ...conexion, ip }, "/call-status/ack", "POST", {});
}
