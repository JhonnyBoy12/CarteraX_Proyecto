package cl.ersphoenix.phone

import android.os.Handler
import android.os.Looper
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

/**
 * Estado visible de Phoenix Mobile. Lo escribe [ServicioPhoenix] (que sigue
 * vivo aunque la pantalla se cierre) y lo lee [MainActivity] para pintarse.
 */
object EstadoPhoenix {

    enum class Fase { ESPERANDO, MARCANDO, EN_CURSO, CONTESTO, NO_CONTESTO, TERMINO, FALLO }
    enum class Tono { NEUTRO, BIEN, MAL }

    class Orden(val hora: String, val nombre: String?, val numero: String) {
        @Volatile var resultado: String = "Marcando…"
        @Volatile var tono: Tono = Tono.NEUTRO
    }

    private const val MAX_ORDENES = 8

    @Volatile var servicioActivo = false
    @Volatile var servidorListo = false
    @Volatile var errorServidor: String? = null
    /** SystemClock.elapsedRealtime() de la última orden del computador vinculado. */
    @Volatile var ultimoContacto = 0L

    @Volatile var fase = Fase.ESPERANDO
    @Volatile var nombre: String? = null
    @Volatile var numero: String? = null
    /** elapsedRealtime() en que la llamada pasó a «en curso». */
    @Volatile var inicioCurso = 0L
    /** Segundos de conversación según el registro de llamadas (al terminar). */
    @Volatile var duracionFinal = 0L

    private val ordenes = mutableListOf<Orden>()

    /** La pantalla se suscribe aquí; se invoca siempre en el hilo principal. */
    @Volatile var alCambiar: (() -> Unit)? = null
    private val principal = Handler(Looper.getMainLooper())

    fun avisar() {
        principal.post { alCambiar?.invoke() }
    }

    fun agregarOrden(o: Orden) {
        synchronized(ordenes) {
            ordenes.add(0, o)
            while (ordenes.size > MAX_ORDENES) ordenes.removeAt(ordenes.size - 1)
        }
    }

    fun ultimaOrden(): Orden? = synchronized(ordenes) { ordenes.firstOrNull() }

    fun copiaOrdenes(): List<Orden> = synchronized(ordenes) { ordenes.toList() }

    /** Primera IPv4 privada del teléfono (la que CarteraX encuentra al buscar). */
    fun ipLocal(): String? = try {
        Collections.list(NetworkInterface.getNetworkInterfaces())
            .filter { it.isUp && !it.isLoopback }
            .flatMap { Collections.list(it.inetAddresses) }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
            ?.hostAddress
    } catch (_: Exception) {
        null
    }
}
