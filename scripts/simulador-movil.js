/**
 * Simulador de Phoenix Mobile para probar CarteraX sin teléfono.
 *
 * Implementa el MISMO protocolo que la app Android v0.4 (ServicioPhoenix.kt):
 *   GET  /ping                → { ok, app, version, device, deviceId, pairing, paired, authorized, … }
 *   POST /pair {code,desktop} → { ok, token, device, deviceId }
 *   POST /unpair              → { ok }                                  (token)
 *   POST /call {phone,name?}  → { ok, phone, action: "CALL", callId }   (token)
 *   GET  /call-status         → { ok, callId, state, completed, answered, duration,
 *                                 elapsed, reachedCall, dialFailed, phone }   (token)
 *   POST /call-status/ack     → { ok }                                  (token)
 * El token viaja en la cabecera X-Phoenix-Token.
 *
 * Cada llamada simulada: RINGING (1 s) → OFFHOOK → IDLE. Si "contesta",
 * dura unos segundos con duración > 0; si no, termina con duración 0.
 *
 * Uso:
 *   npm run simulador-movil                          contesta al azar (60 %)
 *   npm run simulador-movil -- --codigo=123456       fija el código de vinculación
 *   npm run simulador-movil -- --sin-vinculo         se comporta como la v0.3 (sin código)
 *   npm run simulador-movil -- --contesta=siempre    siempre contesta
 *   npm run simulador-movil -- --contesta=nunca      nunca contesta
 *   npm run simulador-movil -- --contesta=rapido     corta a los 2 s sin contestar (apagado, sin chip…)
 *   npm run simulador-movil -- --no-marca            no logra marcar (sin señal, sin SIM)
 *   npm run simulador-movil -- --sin-permiso         responde 403 al llamar
 *   npm run simulador-movil -- --sin-seguimiento     no informa el estado (resultado manual)
 *   npm run simulador-movil -- --sin-registro        cuelga sin saber si contestaron (answered: null)
 *
 * Luego en CarteraX → Teléfono pulsa «Buscar teléfonos» (aparece como
 * 127.0.0.1) y escribe el código que muestra esta consola.
 */
const http = require("http");
const crypto = require("crypto");

const PUERTO = 8765;
const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => (args.find((a) => a.startsWith(`--${nombre}=`)) || `--${nombre}=${porDefecto}`).split("=")[1];
const conPermiso = !args.includes("--sin-permiso");
const conSeguimiento = !args.includes("--sin-seguimiento");
const sinRegistro = args.includes("--sin-registro");
const sinVinculo = args.includes("--sin-vinculo");
const noMarca = args.includes("--no-marca");
const modo = opcion("contesta", "azar");
const duracionMs = Number(opcion("duracion", "4")) * 1000;
let codigo = opcion("codigo", String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"));

const vinculo = { token: null, pc: null };
const llamada = {
  callId: 0, state: "IDLE", completed: false, answered: null, duration: 0, elapsed: 0,
  reachedCall: false, dialFailed: false, phone: null, name: null,
};
let temporizadores = [];
const hora = () => new Date().toLocaleTimeString();

function json(res, codigoHttp, cuerpo) {
  const datos = Buffer.from(JSON.stringify(cuerpo), "utf-8");
  res.writeHead(codigoHttp, { "Content-Type": "application/json; charset=utf-8", "Content-Length": datos.length, Connection: "close" });
  res.end(datos);
}

function autorizado(req) {
  if (sinVinculo) return true;
  const t = req.headers["x-phoenix-token"];
  return Boolean(vinculo.token) && typeof t === "string" && t.length === vinculo.token.length &&
    crypto.timingSafeEqual(Buffer.from(t), Buffer.from(vinculo.token));
}

function leerCuerpo(req, alTerminar) {
  let cuerpo = "";
  req.on("data", (t) => (cuerpo += t));
  req.on("end", () => {
    let datos = {};
    try { datos = JSON.parse(cuerpo || "{}"); } catch { /* cuerpo inválido */ }
    alTerminar(datos);
  });
}

function simularLlamada(phone, name) {
  temporizadores.forEach(clearTimeout);
  Object.assign(llamada, {
    callId: llamada.callId + 1, state: noMarca ? "IDLE" : "RINGING", completed: false, answered: null,
    duration: 0, elapsed: 0, reachedCall: false, dialFailed: false, phone, name,
  });
  if (noMarca) {
    console.log(`[${hora()}] 📵 No se pudo marcar a ${phone} (sin señal)`);
    temporizadores = [setTimeout(() => Object.assign(llamada, { completed: true, answered: false, dialFailed: true, elapsed: 3 }), 1500)];
    return;
  }
  const contesta = modo === "siempre" ? true : modo === "nunca" || modo === "rapido" ? false : Math.random() < 0.6;
  const total = contesta ? 1000 + duracionMs : modo === "rapido" ? 2000 : 3500;
  console.log(`[${hora()}] 📞 Llamando a ${name ? name + " · " : ""}${phone} (${contesta ? "contestará" : "no contestará"})`);
  temporizadores = [
    setTimeout(() => Object.assign(llamada, { state: "OFFHOOK", reachedCall: true }), 1000),
    setTimeout(() => {
      Object.assign(llamada, {
        state: "IDLE",
        completed: true,
        answered: sinRegistro ? null : contesta,
        duration: contesta && !sinRegistro ? Math.round(duracionMs / 1000) : 0,
        elapsed: Math.round(total / 1000),
      });
      console.log(`[${hora()}]    ↳ ${contesta ? "contestó, " + Math.round(duracionMs / 1000) + " s" : "sin respuesta"}${sinRegistro ? " (sin registro)" : ""}`);
    }, total),
  ];
}

http
  .createServer((req, res) => {
    const ok = autorizado(req);
    if (req.method === "GET" && req.url === "/ping") {
      const base = {
        ok: true, app: "Phoenix Mobile", version: sinVinculo ? "simulador-0.3" : "simulador", device: "Simulador Phoenix",
        deviceId: "sim000000001",
      };
      if (sinVinculo) return json(res, 200, { ...base, directCall: true, callPermission: conPermiso, callStateTracking: conSeguimiento });
      return json(res, 200, {
        ...base, pairing: true, paired: Boolean(vinculo.token), authorized: ok,
        ...(ok ? { directCall: true, callPermission: conPermiso, callStateTracking: conSeguimiento, pairedWith: vinculo.pc } : {}),
      });
    }
    if (req.method === "POST" && req.url === "/pair") {
      if (sinVinculo) return json(res, 404, { ok: false, error: "Ruta no encontrada" });
      return leerCuerpo(req, (datos) => {
        if (String(datos.code ?? "").replace(/\D/g, "") !== codigo) {
          return json(res, 401, { ok: false, code: "CODIGO_INCORRECTO", error: "Código incorrecto. Te quedan 4 intentos." });
        }
        vinculo.token = crypto.randomBytes(24).toString("hex");
        vinculo.pc = String(datos.desktop ?? "CarteraX");
        codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
        console.log(`[${hora()}] 🔗 Vinculado con ${vinculo.pc}. Código nuevo: ${codigo}`);
        json(res, 200, { ok: true, token: vinculo.token, device: "Simulador Phoenix", deviceId: "sim000000001" });
      });
    }
    if (["/call", "/call-status", "/call-status/ack", "/unpair"].includes(req.url) && !ok) {
      return json(res, 401, {
        ok: false, code: "NO_VINCULADO",
        error: vinculo.token
          ? "Este teléfono está vinculado con otro computador. Vuelve a vincularlo con el código."
          : "Este teléfono no está vinculado. Vincúlalo desde CarteraX con el código que muestra Phoenix Mobile.",
      });
    }
    if (req.method === "POST" && req.url === "/unpair") {
      vinculo.token = vinculo.pc = null;
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && req.url === "/call-status") {
      const visible = conSeguimiento ? llamada : { ...llamada, state: "IDLE", completed: false, answered: null };
      const { name: _nombre, ...publico } = visible;
      return json(res, 200, { ok: true, ...publico });
    }
    if (req.method === "POST" && req.url === "/call-status/ack") {
      if (llamada.completed) Object.assign(llamada, { completed: false, answered: null, duration: 0, elapsed: 0, dialFailed: false });
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/call") {
      return leerCuerpo(req, (datos) => {
        const phone = String(datos.phone ?? "").trim();
        if (!phone) return json(res, 400, { ok: false, error: "Número vacío" });
        if (!conPermiso) return json(res, 403, { ok: false, error: "Phoenix Mobile no tiene permiso para llamar. Concédelo en el teléfono." });
        if (llamada.state !== "IDLE") return json(res, 409, { ok: false, code: "OCUPADO", error: "El teléfono está en otra llamada." });
        simularLlamada(phone, datos.name ? String(datos.name) : null);
        json(res, 200, { ok: true, phone, action: "CALL", callId: llamada.callId });
      });
    }
    json(res, 404, { ok: false, error: "Ruta no encontrada" });
  })
  .listen(PUERTO, "0.0.0.0", () => {
    console.log(`Simulador Phoenix Mobile en :${PUERTO} · permiso: ${conPermiso ? "sí" : "no"} · seguimiento: ${conSeguimiento ? "sí" : "no"} · contesta: ${modo}`);
    console.log(sinVinculo ? "Sin código de vinculación (como Phoenix Mobile 0.3)." : `Código de vinculación: ${codigo}`);
  });
