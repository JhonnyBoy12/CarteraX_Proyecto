/**
 * Simulador de Phoenix Mobile (app Android) para pruebas sin teléfono.
 *
 * Implementa el MISMO protocolo que MainActivity.kt:
 *   GET  /ping  → { ok, app, directCall, callPermission, device }
 *   POST /call  { phone } → { ok, phone, action: "CALL" }
 *   400 número vacío · 403 sin permiso · 404 ruta desconocida
 *
 * Uso:
 *   npm run simulador-movil                 (permiso concedido)
 *   npm run simulador-movil -- --sin-permiso   (simula 403)
 *
 * Luego en Phoenix → Teléfono, escribe la IP 127.0.0.1 y prueba la conexión.
 *
 * @since 0.2.0
 */
const http = require("http");

const PUERTO = 8765;
const conPermiso = !process.argv.includes("--sin-permiso");

/** Responde JSON con el mismo formato que writeJson() de Android. */
function json(res, codigo, cuerpo) {
  const datos = Buffer.from(JSON.stringify(cuerpo), "utf-8");
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", "Content-Length": datos.length, Connection: "close" });
  res.end(datos);
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/ping") {
      return json(res, 200, { ok: true, app: "Phoenix Mobile", directCall: true, callPermission: conPermiso, device: "Simulador Phoenix" });
    }
    if (req.method === "POST" && req.url === "/call") {
      let cuerpo = "";
      req.on("data", (t) => (cuerpo += t));
      req.on("end", () => {
        let phone = "";
        try { phone = String(JSON.parse(cuerpo).phone ?? "").trim(); } catch { /* cuerpo inválido */ }
        if (!phone) return json(res, 400, { ok: false, error: "Número vacío" });
        if (!conPermiso) return json(res, 403, { ok: false, error: "Phoenix Mobile no tiene permiso CALL_PHONE" });
        console.log(`[${new Date().toLocaleTimeString()}] 📞 Llamada simulada a ${phone}`);
        json(res, 200, { ok: true, phone, action: "CALL" });
      });
      return;
    }
    json(res, 404, { ok: false, error: "Ruta no encontrada" });
  })
  .listen(PUERTO, "0.0.0.0", () => {
    console.log(`Simulador Phoenix Mobile escuchando en :${PUERTO} (permiso de llamadas: ${conPermiso ? "sí" : "no"})`);
  });
