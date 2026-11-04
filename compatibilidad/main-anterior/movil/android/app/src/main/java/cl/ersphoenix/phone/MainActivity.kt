package cl.ersphoenix.phone

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CallLog
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Phoenix Mobile — receptor de órdenes de llamada desde Phoenix Desktop.
 *
 * Levanta un servidor HTTP mínimo en el puerto [port] (8765) dentro de la
 * red Wi-Fi local. Phoenix Desktop (Electron, `src/movil/clienteMovil.ts`)
 * le envía órdenes y el teléfono llama con su propia SIM (`ACTION_CALL`).
 *
 * Protocolo (JSON):
 *  - `GET  /ping` → `{ ok, app, directCall, callPermission, device }`
 *  - `POST /call` con `{ "phone": "+569..." }` → `{ ok, phone, action: "CALL" }`
 *  - Errores: 400 número vacío, 403 sin permiso CALL_PHONE, 404 ruta, 500 interno.
 *
 * v0.2.0 (integración): sólo se agregó esta documentación KDoc; la lógica
 * es idéntica a la del prototipo `phoenix-phone-prototype-direct-call`.
 */
class MainActivity : AppCompatActivity() {

    private val port = 8765
    private val callPermissionRequest = 2001
    private val phoneStatePermissionRequest = 2002

    @Volatile private var callState = TelephonyManager.CALL_STATE_IDLE
    @Volatile private var callWasOffhook = false
    @Volatile private var callCompleted = false
    @Volatile private var lastCallAnswered: Boolean? = null
    @Volatile private var lastCallDuration = 0L
    @Volatile private var lastCallId = 0L
    private var telephonyManager: TelephonyManager? = null

    private lateinit var statusText: TextView
    private lateinit var ipText: TextView
    private lateinit var numberText: TextView
    private lateinit var permissionText: TextView

    private var lastPhone: String? = null
    private var serverSocket: ServerSocket? = null
    private lateinit var executor: ExecutorService

    /** Arranca la app: construye la UI, pide el permiso CALL_PHONE e inicia el servidor. */
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        executor = Executors.newCachedThreadPool()
        buildUi()
        updatePermissionStatus()
        requestCallPermissionIfNeeded()
        requestPhoneStatePermissionsIfNeeded()
        registerCallStateListener()
        startServer()
    }

    /** Construye la interfaz por código (sin XML): IP, permiso, estado, último número y botones. */
    private fun buildUi() {
        val padding = (24 * resources.displayMetrics.density).toInt()
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }

        val title = TextView(this).apply {
            text = "PHOENIX MOBILE"
            textSize = 28f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }

        val subtitle = TextView(this).apply {
            text = "Receptor local - llamada directa"
            textSize = 16f
            setPadding(0, 4, 0, 24)
        }

        ipText = TextView(this).apply {
            textSize = 20f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }

        permissionText = TextView(this).apply {
            textSize = 16f
            setPadding(0, 14, 0, 6)
        }

        statusText = TextView(this).apply {
            text = "🟡 Iniciando servidor..."
            textSize = 18f
            setPadding(0, 12, 0, 24)
        }

        numberText = TextView(this).apply {
            text = "Número recibido: —"
            textSize = 19f
            setPadding(0, 8, 0, 18)
        }

        val permissionButton = Button(this).apply {
            text = "PERMITIR LLAMADAS"
            setOnClickListener { requestCallPermissionIfNeeded(force = true) }
        }

        val manualCallButton = Button(this).apply {
            text = "📞 LLAMAR AL ÚLTIMO NÚMERO"
            setOnClickListener { placeCall(lastPhone) }
        }

        val help = TextView(this).apply {
            text = "Mantén Phoenix Mobile abierta durante la prueba. Cuando el PC envíe un número, la app intentará iniciar la llamada directamente usando la SIM del teléfono."
            textSize = 14f
            setPadding(0, 28, 0, 0)
        }

        container.addView(title)
        container.addView(subtitle)
        container.addView(ipText)
        container.addView(permissionText)
        container.addView(statusText)
        container.addView(numberText)
        container.addView(permissionButton)
        container.addView(manualCallButton)
        container.addView(help)
        setContentView(container)
    }

    /** @return `true` si el usuario concedió el permiso `CALL_PHONE`. */
    private fun hasCallPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED

    /** Solicita permisos para observar el estado y duración de las llamadas. */
    private fun requestPhoneStatePermissionsIfNeeded() {
        val pendientes = arrayOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
            .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (pendientes.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, pendientes.toTypedArray(), phoneStatePermissionRequest)
        }
    }

    /** Observa el estado telefónico para informar al PC cuándo la llamada termina. */
    @Suppress("DEPRECATION")
    private fun registerCallStateListener() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return
        telephonyManager = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
        telephonyManager?.listen(object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                val anterior = callState
                callState = state
                if (state == TelephonyManager.CALL_STATE_OFFHOOK) callWasOffhook = true
                if (state == TelephonyManager.CALL_STATE_IDLE && anterior != TelephonyManager.CALL_STATE_IDLE && lastPhone != null) {
                    val duracion = obtenerDuracionUltimaLlamada(lastPhone!!)
                    lastCallDuration = duracion
                    lastCallAnswered = duracion > 0
                    callCompleted = true
                    runOnUiThread { statusText.text = "Llamada finalizada. CarteraX puede continuar la cola." }
                }
            }
        }, PhoneStateListener.LISTEN_CALL_STATE)
    }

    /** Obtiene la duración de la llamada saliente más reciente al número indicado. */
    private fun obtenerDuracionUltimaLlamada(phone: String): Long {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return 0L
        val digitos = phone.filter { it.isDigit() }.takeLast(8)
        val cursor = contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DURATION, CallLog.Calls.TYPE, CallLog.Calls.DATE),
            "${CallLog.Calls.TYPE} = ?",
            arrayOf(CallLog.Calls.OUTGOING_TYPE.toString()),
            "${CallLog.Calls.DATE} DESC"
        ) ?: return 0L
        cursor.use { c ->
            val numeroIdx = c.getColumnIndex(CallLog.Calls.NUMBER)
            val duracionIdx = c.getColumnIndex(CallLog.Calls.DURATION)
            var revisadas = 0
            while (c.moveToNext() && revisadas < 5) {
                revisadas++
                val numero = c.getString(numeroIdx)?.filter { it.isDigit() } ?: continue
                if (numero.takeLast(8) == digitos) return c.getLong(duracionIdx)
            }
        }
        return 0L
    }

    private fun nombreEstadoLlamada(): String = when (callState) {
        TelephonyManager.CALL_STATE_RINGING -> "RINGING"
        TelephonyManager.CALL_STATE_OFFHOOK -> "OFFHOOK"
        else -> "IDLE"
    }

    /** Actualiza el texto que indica si el permiso de llamadas está concedido. */
    private fun updatePermissionStatus() {
        permissionText.text = if (hasCallPermission()) {
            "Permiso para llamadas: ✅ concedido"
        } else {
            "Permiso para llamadas: ❌ pendiente"
        }
    }

    /**
     * Solicita el permiso `CALL_PHONE` si aún no está concedido.
     * @param force si es `true` y ya hay permiso, lo informa en pantalla.
     */
    private fun requestCallPermissionIfNeeded(force: Boolean = false) {
        if (hasCallPermission()) {
            updatePermissionStatus()
            if (force) statusText.text = "🟢 El permiso de llamadas ya está concedido"
            return
        }

        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.CALL_PHONE),
            callPermissionRequest
        )
    }

    /** Recibe la respuesta del diálogo de permisos y actualiza el estado en pantalla. */
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == callPermissionRequest) {
            updatePermissionStatus()
            statusText.text = if (hasCallPermission()) {
                "Permiso concedido. Listo para llamadas directas"
            } else {
                "Sin permiso CALL_PHONE no se puede iniciar la llamada automáticamente"
            }
        } else if (requestCode == phoneStatePermissionRequest) {
            registerCallStateListener()
        }
    }

    /**
     * Muestra la IP local e inicia el `ServerSocket` en [port] en un hilo aparte.
     * Cada conexión entrante se atiende en otro hilo con [handleClient].
     */
    private fun startServer() {
        val ip = getLocalIpv4()
        ipText.text = if (ip != null) "IP del teléfono: $ip:$port" else "IP del teléfono: no detectada"

        executor.execute {
            try {
                serverSocket = ServerSocket(port)
                runOnUiThread { statusText.text = "🟢 Listo para recibir órdenes" }

                while (!Thread.currentThread().isInterrupted && serverSocket?.isClosed == false) {
                    val client = serverSocket?.accept() ?: break
                    executor.execute { handleClient(client) }
                }
            } catch (e: SocketException) {
                if (serverSocket?.isClosed != true) {
                    runOnUiThread { statusText.text = "🔴 Error de red: ${e.message}" }
                }
            } catch (e: Exception) {
                runOnUiThread { statusText.text = "🔴 Error iniciando servidor: ${e.message}" }
            }
        }
    }

    /**
     * Atiende una petición HTTP: lee la línea de petición y cabeceras, y
     * despacha a `/ping` o `/call`. Responde siempre JSON con [writeJson].
     * @param socket conexión del cliente (se cierra al terminar).
     */
    private fun handleClient(socket: Socket) {
        socket.use { client ->
            client.soTimeout = 5000
            val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))
            val writer = BufferedWriter(OutputStreamWriter(client.getOutputStream(), Charsets.UTF_8))

            try {
                val requestLine = reader.readLine() ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 2) {
                    writeJson(writer, 400, JSONObject().put("ok", false).put("error", "Petición inválida"))
                    return
                }

                val method = parts[0].uppercase()
                val path = parts[1]
                var contentLength = 0

                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                    val idx = line.indexOf(':')
                    if (idx > 0) {
                        val name = line.substring(0, idx).trim()
                        val value = line.substring(idx + 1).trim()
                        if (name.equals("Content-Length", ignoreCase = true)) {
                            contentLength = value.toIntOrNull() ?: 0
                        }
                    }
                }

                when {
                    method == "GET" && path == "/ping" -> {
                        val payload = JSONObject()
                            .put("ok", true)
                            .put("app", "Phoenix Mobile")
                            .put("directCall", true)
                            .put("callPermission", hasCallPermission())
                            .put("device", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
                            .put("callStateTracking", ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED)
                        writeJson(writer, 200, payload)
                    }

                    method == "GET" && path == "/call-status" -> {
                        val payload = JSONObject()
                            .put("ok", true)
                            .put("callId", lastCallId)
                            .put("state", nombreEstadoLlamada())
                            .put("completed", callCompleted)
                            .put("answered", lastCallAnswered)
                            .put("duration", lastCallDuration)
                            .put("phone", lastPhone)
                        writeJson(writer, 200, payload)
                    }

                    method == "POST" && path == "/call-status/ack" -> {
                        callCompleted = false
                        lastCallAnswered = null
                        lastCallDuration = 0L
                        callWasOffhook = false
                        writeJson(writer, 200, JSONObject().put("ok", true))
                    }

                    method == "POST" && path == "/call" -> {
                        val chars = CharArray(contentLength)
                        var total = 0
                        while (total < contentLength) {
                            val read = reader.read(chars, total, contentLength - total)
                            if (read <= 0) break
                            total += read
                        }

                        val body = String(chars, 0, total)
                        val json = JSONObject(body)
                        val phone = json.optString("phone", "").trim()

                        if (phone.isBlank()) {
                            writeJson(writer, 400, JSONObject().put("ok", false).put("error", "Número vacío"))
                            return
                        }

                        if (!hasCallPermission()) {
                            runOnUiThread {
                                statusText.text = "⚠️ Orden recibida, pero falta permiso para llamar"
                                requestCallPermissionIfNeeded()
                            }
                            writeJson(
                                writer,
                                403,
                                JSONObject()
                                    .put("ok", false)
                                    .put("error", "Phoenix Mobile no tiene permiso CALL_PHONE")
                            )
                            return
                        }

                        lastPhone = phone
                        lastCallId += 1
                        callCompleted = false
                        lastCallAnswered = null
                        lastCallDuration = 0L
                        callWasOffhook = false
                        runOnUiThread {
                            numberText.text = "Número recibido: $phone"
                            statusText.text = "📞 Orden recibida. Iniciando llamada..."
                            placeCall(phone)
                        }

                        writeJson(
                            writer,
                            200,
                            JSONObject().put("ok", true).put("phone", phone).put("action", "CALL")
                        )
                    }

                    else -> writeJson(writer, 404, JSONObject().put("ok", false).put("error", "Ruta no encontrada"))
                }
            } catch (e: Exception) {
                try {
                    writeJson(writer, 500, JSONObject().put("ok", false).put("error", e.message ?: "Error interno"))
                } catch (_: Exception) { }
            }
        }
    }

    /**
     * Escribe una respuesta HTTP/1.1 con cuerpo JSON y `Connection: close`.
     * @param statusCode código HTTP (200, 400, 403, 404, 500).
     * @param payload cuerpo de la respuesta.
     */
    private fun writeJson(writer: BufferedWriter, statusCode: Int, payload: JSONObject) {
        val body = payload.toString()
        val reason = when (statusCode) {
            200 -> "OK"
            400 -> "Bad Request"
            403 -> "Forbidden"
            404 -> "Not Found"
            else -> "Internal Server Error"
        }
        val bytes = body.toByteArray(Charsets.UTF_8)
        writer.write("HTTP/1.1 $statusCode $reason\r\n")
        writer.write("Content-Type: application/json; charset=utf-8\r\n")
        writer.write("Content-Length: ${bytes.size}\r\n")
        writer.write("Connection: close\r\n")
        writer.write("\r\n")
        writer.write(body)
        writer.flush()
    }

    /**
     * Inicia la llamada con `Intent.ACTION_CALL` (marca directamente, sin
     * pedir confirmación en el marcador). Requiere el permiso `CALL_PHONE`.
     * @param phone número a llamar; si es nulo o vacío sólo informa en pantalla.
     */
    private fun placeCall(phone: String?) {
        if (phone.isNullOrBlank()) {
            statusText.text = "⚠️ Aún no hay un número recibido"
            return
        }

        if (!hasCallPermission()) {
            statusText.text = "⚠️ Debes conceder permiso para realizar llamadas"
            requestCallPermissionIfNeeded()
            return
        }

        try {
            val intent = Intent(Intent.ACTION_CALL).apply {
                data = Uri.parse("tel:${Uri.encode(phone)}")
            }
            startActivity(intent)
            statusText.text = "🟢 Llamada enviada al sistema telefónico"
        } catch (e: SecurityException) {
            statusText.text = "🔴 Android bloqueó la llamada: falta permiso"
        } catch (e: Exception) {
            statusText.text = "🔴 No se pudo iniciar la llamada: ${e.message}"
        }
    }

    /** @return primera IPv4 privada del teléfono (la que se escribe en Phoenix Desktop) o `null`. */
    private fun getLocalIpv4(): String? {
        return try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            interfaces
                .flatMap { Collections.list(it.inetAddresses) }
                .firstOrNull { !it.isLoopbackAddress && it is Inet4Address && it.isSiteLocalAddress }
                ?.hostAddress
        } catch (_: Exception) {
            null
        }
    }

    /** Cierra el servidor y detiene los hilos al cerrar la app. */
    override fun onDestroy() {
        try { serverSocket?.close() } catch (_: Exception) { }
        executor.shutdownNow()
        super.onDestroy()
    }
}
