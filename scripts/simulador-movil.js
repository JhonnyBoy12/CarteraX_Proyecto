/**
 * Simulador de Phoenix Mobile para probar CarteraX sin teléfono.
 *
 * Implementa el MISMO protocolo que la app Android (MainActivity.kt):
 *   GET  /ping                → { ok, app, version, directCall, callPermission, callStateTracking, device }
 *   POST /call {phone,name?}  → { ok, phone, action: "CALL" }
 *   GET  /call-status         → { ok, callId, state, completed, answered, duration, elapsed, phone }
 *   POST /call-status/ack     → { ok }
 *
 * Cada llamada simulada: RINGING (1 s) → OFFHOOK → IDLE. Si "contesta",
 * dura unos segundos con duración > 0; si no, termina con duración 0.
 *
 * Uso:
 *   npm run simulador-movil                          contesta al azar (60 %)
 *   npm run simulador-movil -- --contesta=siempre    siempre contesta
 *   npm run simulador-movil -- --contesta=nunca      nunca contesta
 *   npm run simulador-movil -- --sin-permiso         responde 403 al llamar
 *   npm run simulador-movil -- --sin-seguimiento     no informa el estado (resultado manual)
 *   npm run simulador-movil -- --sin-registro        cuelga sin saber si contestaron (answered: null)
 *   npm run simulador-movil -- --contesta=rapido     corta a los 2 s sin contestar (rechazo, apagado…)
 *
 * Luego en CarteraX → Teléfono escribe la IP 127.0.0.1 y prueba la conexión.
 */
const http = require("http");

const PUERTO = 8765;
const args = process.argv.slice(2);
const conPermiso = !args.includes("--sin-permiso");
const conSeguimiento = !args.includes("--sin-seguimiento");
const sinRegistro = args.includes("--sin-registro");
const modo = (args.find((a) => a.startsWith("--contesta=")) || "--contesta=azar").split("=")[1];
const duracionMs = Number((args.find((a) => a.startsWith("--duracion=")) || "--duracion=4").split("=")[1]) * 1000;

const llamada = { callId: 0, state: "IDLE", completed: false, answered: null, duration: 0, elapsed: 0, phone: null, name: null };
let temporizadores = [];

function json(res, codigo, cuerpo) {
  const datos = Buffer.from(JSON.stringify(cuerpo), "utf-8");
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", "Content-Length": datos.length, Connection: "close" });
  res.end(datos);
}

function simularLlamada(phone, name) {
  temporizadores.forEach(clearTimeout);
  const contesta = modo === "siempre" ? true : modo === "nunca" || modo === "rapido" ? false : Math.random() < 0.6;
  Object.assign(llamada, { callId: llamada.callId + 1, state: "RINGING", completed: false, answered: null, duration: 0, elapsed: 0, phone, name });
  const total = contesta ? 1000 + duracionMs : modo === "rapido" ? 2000 : 3500;
  const hora = () => new Date().toLocaleTimeString();
  console.log(`[${hora()}] 📞 Llamando a ${name ? name + " · " : ""}${phone} (${contesta ? "contestará" : "no contestará"})`);
  temporizadores = [
    setTimeout(() => (llamada.state = "OFFHOOK"), 1000),
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
    if (req.method === "GET" && req.url === "/ping") {
      return json(res, 200, {
        ok: true, app: "Phoenix Mobile", version: "simulador", directCall: true,
        callPermission: conPermiso, callStateTracking: conSeguimiento, device: "Simulador Phoenix",
      });
    }
    if (req.method === "GET" && req.url === "/call-status") {
      const visible = conSeguimiento ? llamada : { ...llamada, state: "IDLE", completed: false, answered: null };
      return json(res, 200, { ok: true, ...visible });
    }
    if (req.method === "POST" && req.url === "/call-status/ack") {
      Object.assign(llamada, { completed: false, answered: null, duration: 0, elapsed: 0 });
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/call") {
      let cuerpo = "";
      req.on("data", (t) => (cuerpo += t));
      req.on("end", () => {
        let datos = {};
        try { datos = JSON.parse(cuerpo); } catch { /* cuerpo inválido */ }
        const phone = String(datos.phone ?? "").trim();
        if (!phone) return json(res, 400, { ok: false, error: "Número vacío" });
        if (!conPermiso) return json(res, 403, { ok: false, error: "Phoenix Mobile no tiene permiso CALL_PHONE" });
        simularLlamada(phone, datos.name ? String(datos.name) : null);
        json(res, 200, { ok: true, phone, action: "CALL" });
      });
      return;
    }
    json(res, 404, { ok: false, error: "Ruta no encontrada" });
  })
  .listen(PUERTO, "0.0.0.0", () => {
    console.log(`Simulador Phoenix Mobile en :${PUERTO} · permiso: ${conPermiso ? "sí" : "no"} · seguimiento: ${conSeguimiento ? "sí" : "no"} · contesta: ${modo}`);
  });
