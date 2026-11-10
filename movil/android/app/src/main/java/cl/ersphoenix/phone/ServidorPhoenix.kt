package cl.ersphoenix.phone

import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Petición HTTP ya leída. Las cabeceras van en minúsculas. */
class Peticion(
    val metodo: String,
    val ruta: String,
    val cabeceras: Map<String, String>,
    val cuerpo: String,
)

/**
 * Servidor HTTP mínimo que recibe las órdenes de CarteraX por la red Wi‑Fi
 * local. Vive dentro de [ServicioPhoenix] (servicio en primer plano), así que
 * sigue atendiendo aunque la app quede detrás del marcador durante la llamada.
 *
 * Protocolo v0.4 (compatible con las rutas de la v0.3, ver clienteMovil.ts):
 *  - GET  /ping               → estado del teléfono; sin vínculo sólo dice quién es
 *  - POST /pair {code, desktop} → vincula este computador con el código de 6 dígitos
 *  - POST /unpair             → desvincula (requiere token)
 *  - POST /call {phone, name?, rut?} → inicia la llamada (requiere token)
 *  - GET  /call-status        → estado de la última llamada (requiere token)
 *  - POST /call-status/ack    → CarteraX confirma que procesó el término (requiere token)
 *
 * El token viaja en la cabecera `X-Phoenix-Token`.
 */
class ServidorPhoenix(
    private val puerto: Int,
    private val manejador: (Peticion) -> Pair<Int, JSONObject>,
    private val alIniciar: () -> Unit,
    private val alError: (String) -> Unit,
) {
    @Volatile private var socket: ServerSocket? = null
    @Volatile private var detenido = false
    private val hilos: ExecutorService = Executors.newCachedThreadPool()

    fun iniciar() {
        hilos.execute {
            // Si el servicio se reinicia, el puerto puede tardar un instante en liberarse.
            var intentos = 0
            while (!detenido) {
                try {
                    val s = ServerSocket()
                    s.reuseAddress = true
                    s.bind(InetSocketAddress(puerto))
                    socket = s
                    alIniciar()
                    while (!s.isClosed) {
                        val cliente = s.accept()
                        hilos.execute { atender(cliente) }
                    }
                    return@execute
                } catch (e: SocketException) {
                    if (detenido) return@execute
                    intentos++
                    if (intentos >= 5) {
                        alError("No se pudo abrir el puerto $puerto: ${e.message}")
                        return@execute
                    }
                    Thread.sleep(2000)
                } catch (e: Exception) {
                    if (!detenido) alError("No se pudo iniciar el servidor: ${e.message}")
                    return@execute
                }
            }
        }
    }

    fun detener() {
        detenido = true
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

                val cabeceras = HashMap<String, String>()
                while (true) {
                    val cabecera = lector.readLine() ?: break
                    if (cabecera.isEmpty()) break
                    val i = cabecera.indexOf(':')
                    if (i > 0 && cabeceras.size < 50) {
                        cabeceras[cabecera.substring(0, i).trim().lowercase()] = cabecera.substring(i + 1).trim()
                    }
                }
                val largo = cabeceras["content-length"]?.toIntOrNull() ?: 0

                // El cuerpo se lee como caracteres; los JSON de CarteraX son pequeños.
                val buffer = CharArray(largo.coerceIn(0, 64 * 1024))
                var leidos = 0
                while (leidos < buffer.size) {
                    val n = lector.read(buffer, leidos, buffer.size - leidos)
                    if (n <= 0) break
                    leidos += n
                }
                val (codigo, json) = manejador(Peticion(metodo, ruta, cabeceras, String(buffer, 0, leidos)))
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
            401 -> "Unauthorized"
            403 -> "Forbidden"
            404 -> "Not Found"
            409 -> "Conflict"
            429 -> "Too Many Requests"
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
