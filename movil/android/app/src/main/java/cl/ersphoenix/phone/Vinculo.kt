package cl.ersphoenix.phone

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale

/**
 * Vínculo entre este teléfono y UN computador con CarteraX.
 *
 * El teléfono muestra un código de 6 dígitos; CarteraX lo envía a `/pair` y
 * recibe un token que acompaña cada orden. Así, en una oficina con varios
 * ejecutivos en la misma Wi‑Fi, cada teléfono sólo obedece a su computador.
 * Vincular otro computador reemplaza al anterior.
 *
 * Tras 5 códigos incorrectos se bloquea 60 s y el código cambia.
 */
class Vinculo private constructor(private val prefs: SharedPreferences) {

    sealed class Resultado {
        class Vinculado(val token: String) : Resultado()
        class Incorrecto(val restantes: Int) : Resultado()
        class Bloqueado(val segundos: Long) : Resultado()
    }

    companion object {
        private const val MAX_INTENTOS = 5
        private const val BLOQUEO_MS = 60_000L
        private const val K_TOKEN = "vinculo_token"
        private const val K_PC = "vinculo_pc"
        private const val K_CODIGO = "vinculo_codigo"
        private const val K_EQUIPO = "vinculo_equipo"

        @Volatile private var instancia: Vinculo? = null

        fun de(ctx: Context): Vinculo = instancia ?: synchronized(this) {
            instancia ?: Vinculo(ctx.applicationContext.getSharedPreferences("phoenix", Context.MODE_PRIVATE)).also { instancia = it }
        }
    }

    private val azar = SecureRandom()
    private var fallidos = 0
    private var bloqueadoHasta = 0L

    /** Identificador estable de este teléfono (CarteraX lo usa para reencontrarlo si cambia la IP). */
    val idEquipo: String = prefs.getString(K_EQUIPO, null) ?: hex(6).also { prefs.edit().putString(K_EQUIPO, it).apply() }

    val codigo: String get() = prefs.getString(K_CODIGO, null) ?: regenerarCodigo()
    val vinculado: Boolean get() = prefs.getString(K_TOKEN, null) != null
    val computador: String? get() = prefs.getString(K_PC, null)

    fun tokenValido(token: String?): Boolean {
        val guardado = prefs.getString(K_TOKEN, null) ?: return false
        if (token.isNullOrEmpty()) return false
        return MessageDigest.isEqual(guardado.toByteArray(), token.toByteArray())
    }

    @Synchronized
    fun vincular(codigoIngresado: String, nombreComputador: String): Resultado {
        val ahora = SystemClock.elapsedRealtime()
        if (ahora < bloqueadoHasta) return Resultado.Bloqueado((bloqueadoHasta - ahora + 999) / 1000)
        val limpio = codigoIngresado.filter { it.isDigit() }
        if (limpio.length != 6 || !MessageDigest.isEqual(limpio.toByteArray(), codigo.toByteArray())) {
            fallidos++
            if (fallidos >= MAX_INTENTOS) {
                fallidos = 0
                bloqueadoHasta = ahora + BLOQUEO_MS
                regenerarCodigo()
                return Resultado.Bloqueado(BLOQUEO_MS / 1000)
            }
            return Resultado.Incorrecto(MAX_INTENTOS - fallidos)
        }
        fallidos = 0
        val token = hex(24)
        prefs.edit()
            .putString(K_TOKEN, token)
            .putString(K_PC, nombreComputador.take(60).ifBlank { "CarteraX" })
            .apply()
        regenerarCodigo()
        return Resultado.Vinculado(token)
    }

    @Synchronized
    fun desvincular() {
        prefs.edit().remove(K_TOKEN).remove(K_PC).apply()
        regenerarCodigo()
    }

    @Synchronized
    fun regenerarCodigo(): String {
        val nuevo = String.format(Locale.ROOT, "%06d", azar.nextInt(1_000_000))
        prefs.edit().putString(K_CODIGO, nuevo).apply()
        return nuevo
    }

    private fun hex(bytes: Int): String {
        val b = ByteArray(bytes)
        azar.nextBytes(b)
        return b.joinToString("") { String.format(Locale.ROOT, "%02x", it) }
    }
}
