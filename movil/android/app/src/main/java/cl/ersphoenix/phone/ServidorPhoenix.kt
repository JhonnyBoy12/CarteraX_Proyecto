package cl.ersphoenix.phone

import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Servidor HTTP mínimo que recibe las órdenes de CarteraX (Phoenix Desktop)
 * por la red Wi‑Fi local. No depende de la interfaz: cada petición se
 * entrega a [manejador], que devuelve el código HTTP y el JSON de respuesta.
 *
 * Protocolo (sin cambios de rutas respecto a la v0.2, ver clienteMovil.ts):
 *  - GET  /ping               → estado del teléfono y permisos
 *  - POST /call {phone, name?, rut?} → inicia la llamada
 *  - GET  /call-status        → estado de la última llamada
 *  - POST /call-status/ack    → CarteraX confirma que procesó el término
 *
 * @param puerto puerto TCP (8765).
 * @param manejador (método, ruta, cuerpo) → (código HTTP, JSON).
 * @param alError se invoca si el socket no puede abrirse.
 */
class ServidorPhoenix(
    private val puerto: Int,
    private val manejador: (metodo: String, ruta: String, cuerpo: String) -> Pair<Int, JSONObject>,
    private val alIniciar: () -> Unit,
    private val alError: (String) -> Unit,
) {
    private var socket: ServerSocket? = null
    private val hilos: ExecutorService = Executors.newCachedThreadPool()

    fun iniciar() {
        hilos.execute {
            try {
                val s = ServerSocket(puerto)
                socket = s
                alIniciar()
                while (!s.isClosed) {
                    val cliente = s.accept()
                    hilos.execute { atender(cliente) }
                }
            } catch (e: SocketException) {
                if (socket?.isClosed != true) alError("Error de red: ${e.message}")
            } catch (e: Exception) {
                alError("No se pudo iniciar el servidor: ${e.message}")
            }
        }
    }

    fun detener() {
        try {
            socket?.close()
        } catch (_: Exception) {
        }
        hilos.shutdownNow()
    }

    /** Lee la petición (línea inicial, cabeceras y cuerpo) y responde JSON. */
    private fun atender(conexion: Socket) {
        conexion.use { c ->
            c.soTimeout = 5000
            val lector = BufferedReader(InputStreamReader(c.getInputStream(), Charsets.UTF_8))
            val escritor = BufferedWriter(OutputStreamWriter(c.getOutputStream(), Charsets.UTF_8))
            try {
                val linea = lector.readLine() ?: return
                val partes = linea.split(" ")
                if (partes.size < 2) {
                    escribir(escritor, 400, JSONObject().put("ok", false).put("error", "Petición inválida"))
                    return
                }
                val metodo = partes[0].uppercase()
                val ruta = partes[1].substringBefore("?")

                var largo = 0
                while (true) {
                    val cabecera = lector.readLine() ?: break
                    if (cabecera.isEmpty()) break
                    val i = cabecera.indexOf(':')
                    if (i > 0 && cabecera.substring(0, i).trim().equals("Content-Length", ignoreCase = true)) {
                        largo = cabecera.substring(i + 1).trim().toIntOrNull() ?: 0
                    }
                }

                // El cuerpo se lee como caracteres; los JSON de CarteraX son pequeños.
                val buffer = CharArray(largo.coerceIn(0, 64 * 1024))
                var leidos = 0
                while (leidos < buffer.size) {
                    val n = lector.read(buffer, leidos, buffer.size - leidos)
                    if (n <= 0) break
                    leidos += n
                }
                val (codigo, json) = manejador(metodo, ruta, String(buffer, 0, leidos))
                escribir(escritor, codigo, json)
            } catch (e: Exception) {
                try {
                    escribir(escritor, 500, JSONObject().put("ok", false).put("error", e.message ?: "Error interno"))
                } catch (_: Exception) {
                }
            }
        }
    }

    private fun escribir(w: BufferedWriter, codigo: Int, json: JSONObject) {
        val cuerpo = json.toString().toByteArray(Charsets.UTF_8)
        val razon = when (codigo) {
            200 -> "OK"
            400 -> "Bad Request"
            403 -> "Forbidden"
            404 -> "Not Found"
            else -> "Internal Server Error"
        }
        w.write("HTTP/1.1 $codigo $razon\r\n")
        w.write("Content-Type: application/json; charset=utf-8\r\n")
        w.write("Content-Length: ${cuerpo.size}\r\n")
        w.write("Connection: close\r\n\r\n")
        w.write(String(cuerpo, Charsets.UTF_8))
        w.flush()
    }
}
