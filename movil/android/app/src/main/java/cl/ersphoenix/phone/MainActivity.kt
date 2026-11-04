package cl.ersphoenix.phone

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.CallLog
import android.provider.Settings
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.view.View
import android.view.WindowManager
import android.widget.Chronometer
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.switchmaterial.SwitchMaterial
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Date
import java.util.Locale

/**
 * Phoenix Mobile v0.3 — recibe órdenes de llamada de CarteraX y llama con la
 * SIM del teléfono (RF-28, RF-29, RNF-16, RNF-21).
 *
 * Además de iniciar la llamada, observa su estado (marcando, en curso,
 * terminada) y lee su duración en el registro de llamadas, para que la cola
 * automática de CarteraX sepa si el cliente contestó.
 *
 * La pantalla muestra, en orden: conexión con CarteraX (con la IP a escribir
 * en el computador), la llamada en curso, los permisos y las últimas llamadas.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val PUERTO = 8765
        private const val VERSION = "0.3.1"
        /** Reintentos para leer el registro de llamadas tras colgar (1 s entre cada uno). */
        private const val REINTENTOS_REGISTRO = 5
        private const val REQ_LLAMADAS = 2001
        private const val REQ_SEGUIMIENTO = 2002
        private const val MAX_ORDENES = 8
        private const val CONEXION_RECIENTE_MS = 45_000L
        private const val PREFS = "phoenix"
        private const val PREF_PANTALLA = "pantalla_encendida"
    }

    private class Orden(val hora: String, val nombre: String?, val numero: String, var resultado: String)

    // --- Estado de la llamada (lo leen los hilos del servidor) ---
    @Volatile private var estadoTelefono = TelephonyManager.CALL_STATE_IDLE
    @Volatile private var llamadaTerminada = false
    @Volatile private var contestada: Boolean? = null
    @Volatile private var duracion = 0L
    /** Segundos desde que se marcó hasta colgar (incluye el timbre). */
    @Volatile private var transcurrido = 0L
    /** Hora (System.currentTimeMillis) en que se marcó la llamada actual. */
    @Volatile private var marcadaEn = 0L
    @Volatile private var idLlamada = 0L
    @Volatile private var ultimoNumero: String? = null
    @Volatile private var ultimoNombre: String? = null
    @Volatile private var ultimoContacto = 0L
    @Volatile private var servidorListo = false
    @Volatile private var errorServidor: String? = null

    private val ordenes = mutableListOf<Orden>()
    private var escuchandoLlamadas = false
    private var servidor: ServidorPhoenix? = null
    private val principal = Handler(Looper.getMainLooper())
    private val refresco = object : Runnable {
        override fun run() {
            refrescarConexion()
            principal.postDelayed(this, 3000)
        }
    }

    // --- Vistas ---
    private lateinit var puntoEstado: View
    private lateinit var txtEstado: TextView
    private lateinit var txtDetalleEstado: TextView
    private lateinit var txtIp: TextView
    private lateinit var chipLlamada: TextView
    private lateinit var txtCliente: TextView
    private lateinit var filaNumero: LinearLayout
    private lateinit var txtNumero: TextView
    private lateinit var cronometro: Chronometer
    private lateinit var btnVolverLlamar: MaterialButton
    private lateinit var listaOrdenes: LinearLayout
    private lateinit var txtSinOrdenes: TextView

    // ===================================================================
    // Ciclo de vida
    // ===================================================================

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        enlazarVistas()

        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val pantalla = findViewById<SwitchMaterial>(R.id.switchPantalla)
        pantalla.isChecked = prefs.getBoolean(PREF_PANTALLA, true)
        aplicarPantallaEncendida(pantalla.isChecked)
        pantalla.setOnCheckedChangeListener { _, activo ->
            prefs.edit().putBoolean(PREF_PANTALLA, activo).apply()
            aplicarPantallaEncendida(activo)
        }

        findViewById<MaterialButton>(R.id.btnCopiarIp).setOnClickListener { copiarIp() }
        btnVolverLlamar.setOnClickListener { llamar(ultimoNumero) }
        findViewById<MaterialButton>(R.id.btnPermLlamadas).setOnClickListener {
            pedirPermisos(arrayOf(Manifest.permission.CALL_PHONE), REQ_LLAMADAS)
        }
        findViewById<MaterialButton>(R.id.btnPermEstado).setOnClickListener {
            pedirPermisos(arrayOf(Manifest.permission.READ_PHONE_STATE), REQ_SEGUIMIENTO)
        }
        findViewById<MaterialButton>(R.id.btnPermRegistro).setOnClickListener {
            pedirPermisos(arrayOf(Manifest.permission.READ_CALL_LOG), REQ_SEGUIMIENTO)
        }

        // Primer arranque: se piden todos los permisos de una vez (RNF-21).
        val faltantes = arrayOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
            .filter { !tienePermiso(it) }
        if (faltantes.isNotEmpty()) ActivityCompat.requestPermissions(this, faltantes.toTypedArray(), REQ_LLAMADAS)

        registrarEscuchaLlamadas()
        pintarPermisos()
        pintarLlamada(null)
        pintarOrdenes()

        servidor = ServidorPhoenix(
            PUERTO,
            manejador = ::manejarPeticion,
            alIniciar = { servidorListo = true; runOnUiThread { refrescarConexion() } },
            alError = { mensaje -> errorServidor = mensaje; runOnUiThread { refrescarConexion() } },
        ).also { it.iniciar() }
    }

    override fun onResume() {
        super.onResume()
        // El usuario pudo conceder permisos desde Ajustes.
        pintarPermisos()
        registrarEscuchaLlamadas()
        principal.post(refresco)
    }

    override fun onPause() {
        super.onPause()
        principal.removeCallbacks(refresco)
    }

    override fun onDestroy() {
        servidor?.detener()
        principal.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun enlazarVistas() {
        puntoEstado = findViewById(R.id.puntoEstado)
        txtEstado = findViewById(R.id.txtEstado)
        txtDetalleEstado = findViewById(R.id.txtDetalleEstado)
        txtIp = findViewById(R.id.txtIp)
        chipLlamada = findViewById(R.id.chipLlamada)
        txtCliente = findViewById(R.id.txtCliente)
        filaNumero = findViewById(R.id.filaNumero)
        txtNumero = findViewById(R.id.txtNumero)
        cronometro = findViewById(R.id.cronometro)
        btnVolverLlamar = findViewById(R.id.btnVolverLlamar)
        listaOrdenes = findViewById(R.id.listaOrdenes)
        txtSinOrdenes = findViewById(R.id.txtSinOrdenes)
    }

    // ===================================================================
    // Protocolo con CarteraX (se ejecuta en hilos del servidor)
    // ===================================================================

    private fun manejarPeticion(metodo: String, ruta: String, cuerpo: String): Pair<Int, JSONObject> {
        ultimoContacto = SystemClock.elapsedRealtime()
        return when {
            metodo == "GET" && ruta == "/ping" -> 200 to JSONObject()
                .put("ok", true)
                .put("app", "Phoenix Mobile")
                .put("version", VERSION)
                .put("directCall", true)
                .put("callPermission", tienePermiso(Manifest.permission.CALL_PHONE))
                .put("callStateTracking", seguimientoDisponible())
                .put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")

            metodo == "GET" && ruta == "/call-status" -> 200 to JSONObject()
                .put("ok", true)
                .put("callId", idLlamada)
                .put("state", nombreEstado())
                .put("completed", llamadaTerminada)
                .put("answered", contestada ?: JSONObject.NULL)
                .put("duration", duracion)
                .put("elapsed", transcurrido)
                .put("phone", ultimoNumero ?: JSONObject.NULL)

            metodo == "POST" && ruta == "/call-status/ack" -> {
                llamadaTerminada = false
                contestada = null
                duracion = 0L
                transcurrido = 0L
                200 to JSONObject().put("ok", true)
            }

            metodo == "POST" && ruta == "/call" -> recibirLlamada(cuerpo)

            else -> 404 to JSONObject().put("ok", false).put("error", "Ruta no encontrada")
        }
    }

    private fun recibirLlamada(cuerpo: String): Pair<Int, JSONObject> {
        val json = try {
            JSONObject(cuerpo)
        } catch (_: Exception) {
            return 400 to JSONObject().put("ok", false).put("error", "JSON inválido")
        }
        val numero = json.optString("phone", "").trim()
        val nombre = json.optString("name", "").trim().ifEmpty { null }
        if (numero.isBlank()) return 400 to JSONObject().put("ok", false).put("error", "Número vacío")

        if (!tienePermiso(Manifest.permission.CALL_PHONE)) {
            runOnUiThread {
                Toast.makeText(this, "CarteraX pidió una llamada, pero falta el permiso de llamadas.", Toast.LENGTH_LONG).show()
                pintarPermisos()
            }
            return 403 to JSONObject().put("ok", false).put("error", "Phoenix Mobile no tiene permiso CALL_PHONE")
        }

        ultimoNumero = numero
        ultimoNombre = nombre
        idLlamada += 1
        llamadaTerminada = false
        contestada = null
        duracion = 0L
        transcurrido = 0L
        marcadaEn = System.currentTimeMillis()

        runOnUiThread {
            agregarOrden(Orden(SimpleDateFormat("HH:mm", Locale.forLanguageTag("es-CL")).format(Date()), nombre, numero, "Marcando…"))
            pintarLlamada("marcando")
            llamar(numero)
        }
        return 200 to JSONObject().put("ok", true).put("phone", numero).put("action", "CALL")
    }

    // ===================================================================
    // Llamadas
    // ===================================================================

    /** Inicia la llamada con ACTION_CALL (marca sin pasar por el marcador). */
    private fun llamar(numero: String?) {
        if (numero.isNullOrBlank()) return
        if (!tienePermiso(Manifest.permission.CALL_PHONE)) {
            pedirPermisos(arrayOf(Manifest.permission.CALL_PHONE), REQ_LLAMADAS)
            return
        }
        try {
            startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:${Uri.encode(numero)}")))
        } catch (e: SecurityException) {
            Toast.makeText(this, "Android bloqueó la llamada: falta el permiso.", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(this, "No se pudo iniciar la llamada: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    /** Observa el estado del teléfono para informar el término de cada llamada. */
    @Suppress("DEPRECATION")
    private fun registrarEscuchaLlamadas() {
        if (escuchandoLlamadas || !tienePermiso(Manifest.permission.READ_PHONE_STATE)) return
        val telefonia = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
        telefonia.listen(object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                val anterior = estadoTelefono
                estadoTelefono = state
                when {
                    state == TelephonyManager.CALL_STATE_OFFHOOK && anterior != TelephonyManager.CALL_STATE_OFFHOOK ->
                        pintarLlamada("en_curso")
                    state == TelephonyManager.CALL_STATE_IDLE && anterior != TelephonyManager.CALL_STATE_IDLE && ultimoNumero != null -> {
                        cronometro.stop()
                        if (marcadaEn > 0) transcurrido = (System.currentTimeMillis() - marcadaEn) / 1000
                        // El registro de llamadas se escribe un instante después de colgar.
                        principal.postDelayed({ cerrarLlamada(REINTENTOS_REGISTRO) }, 1000)
                    }
                }
            }
        }, PhoneStateListener.LISTEN_CALL_STATE)
        escuchandoLlamadas = true
    }

    /**
     * Cierra la llamada con la duración del registro de Android. El registro
     * se escribe un instante después de colgar (a veces varios segundos), así
     * que se reintenta antes de concluir; sólo se aceptan entradas posteriores
     * a la marcación, para no tomar la duración de una llamada anterior.
     * Sin permiso de registro, `answered` queda null: CarteraX lo pregunta.
     */
    private fun cerrarLlamada(intentos: Int) {
        val numero = ultimoNumero ?: return
        if (!tienePermiso(Manifest.permission.READ_CALL_LOG)) {
            duracion = 0L
            contestada = null
            llamadaTerminada = true
            ordenes.firstOrNull()?.resultado = "Terminó"
            pintarOrdenes()
            pintarLlamada("terminada")
            return
        }
        val segundos = duracionLlamadaDesde(numero, marcadaEn)
        if (segundos == null && intentos > 1) {
            principal.postDelayed({ cerrarLlamada(intentos - 1) }, 1000)
            return
        }
        val s = segundos ?: 0L
        duracion = s
        contestada = s > 0
        llamadaTerminada = true
        ordenes.firstOrNull()?.resultado = if (s > 0) "Contestó, ${textoDuracion(s)}" else "No contestó"
        pintarOrdenes()
        pintarLlamada(if (s > 0) "contesto" else "no_contesto")
    }

    /**
     * Duración (s) de la llamada saliente a ese número registrada después de
     * `desde` (ms), o null si todavía no aparece en el registro.
     */
    private fun duracionLlamadaDesde(numero: String, desde: Long): Long? {
        val digitos = numero.filter { it.isDigit() }.takeLast(8)
        val cursor = contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DURATION),
            "${CallLog.Calls.TYPE} = ? AND ${CallLog.Calls.DATE} >= ?",
            arrayOf(CallLog.Calls.OUTGOING_TYPE.toString(), (desde - 5_000).toString()),
            "${CallLog.Calls.DATE} DESC"
        ) ?: return null
        cursor.use { c ->
            val iNumero = c.getColumnIndex(CallLog.Calls.NUMBER)
            val iDuracion = c.getColumnIndex(CallLog.Calls.DURATION)
            var revisadas = 0
            while (c.moveToNext() && revisadas < 5) {
                revisadas++
                val n = c.getString(iNumero)?.filter { it.isDigit() } ?: continue
                if (n.takeLast(8) == digitos) return c.getLong(iDuracion)
            }
        }
        return null
    }

    private fun nombreEstado(): String = when (estadoTelefono) {
        TelephonyManager.CALL_STATE_RINGING -> "RINGING"
        TelephonyManager.CALL_STATE_OFFHOOK -> "OFFHOOK"
        else -> "IDLE"
    }

    // ===================================================================
    // Interfaz
    // ===================================================================

    private fun color(id: Int) = ContextCompat.getColor(this, id)

    private fun colorearFondo(vista: View, colorId: Int) {
        ViewCompat.setBackgroundTintList(vista, ColorStateList.valueOf(color(colorId)))
    }

    /** Tarjeta de conexión: servidor, Wi‑Fi, permiso y último contacto de CarteraX. */
    private fun refrescarConexion() {
        val ip = ipLocal()
        txtIp.text = if (ip != null) "$ip:$PUERTO" else "Sin Wi‑Fi"
        val reciente = ultimoContacto > 0 && SystemClock.elapsedRealtime() - ultimoContacto < CONEXION_RECIENTE_MS

        val (colorId, titulo, detalle) = when {
            errorServidor != null -> Triple(R.color.alerta, "No se pudo iniciar", errorServidor ?: "")
            !servidorListo -> Triple(R.color.gris_estado, "Iniciando…", "Preparando la conexión.")
            ip == null -> Triple(R.color.alerta, "Sin red Wi‑Fi", "Conecta el teléfono a la misma red Wi‑Fi que el computador.")
            !tienePermiso(Manifest.permission.CALL_PHONE) -> Triple(R.color.alerta, "Falta el permiso de llamadas", "Concédelo en la sección Permisos.")
            reciente -> Triple(R.color.positivo, "Conectado a CarteraX", "Última señal del computador hace ${(SystemClock.elapsedRealtime() - ultimoContacto) / 1000} s.")
            else -> Triple(R.color.phoenix_naranja, "Esperando a CarteraX", "En CarteraX, abre Teléfono, escribe la IP y pulsa «Probar conexión».")
        }
        colorearFondo(puntoEstado, colorId)
        txtEstado.text = titulo
        txtDetalleEstado.text = detalle
    }

    /**
     * Tarjeta de llamada actual.
     * @param fase null | marcando | en_curso | contesto | no_contesto | terminada (sin datos)
     */
    private fun pintarLlamada(fase: String?) {
        if (fase == null) {
            chipLlamada.text = getString(R.string.sin_llamada)
            chipLlamada.setTextColor(color(R.color.pizarra))
            colorearFondo(chipLlamada, R.color.fondo)
            txtCliente.text = getString(R.string.esperando_orden)
            txtCliente.setTextColor(color(R.color.pizarra))
            txtCliente.textSize = 15f
            filaNumero.visibility = View.GONE
            btnVolverLlamar.visibility = View.GONE
            return
        }
        txtCliente.text = ultimoNombre ?: "Llamada desde CarteraX"
        txtCliente.setTextColor(color(R.color.tinta))
        txtCliente.textSize = 22f
        txtNumero.text = ultimoNumero ?: ""
        filaNumero.visibility = View.VISIBLE

        val (texto, fondo, tinta) = when (fase) {
            "marcando" -> Triple("Marcando", R.color.phoenix_naranja_suave, R.color.phoenix_naranja_hondo)
            "en_curso" -> Triple("En curso", R.color.positivo, R.color.blanco)
            "contesto" -> Triple("Contestó", R.color.positivo_suave, R.color.positivo)
            "terminada" -> Triple("Terminó", R.color.fondo, R.color.pizarra)
            else -> Triple("No contestó", R.color.alerta_suave, R.color.alerta)
        }
        chipLlamada.text = texto
        chipLlamada.setTextColor(color(tinta))
        colorearFondo(chipLlamada, fondo)

        when (fase) {
            "marcando" -> {
                cronometro.stop()
                cronometro.base = SystemClock.elapsedRealtime()
                btnVolverLlamar.visibility = View.GONE
            }
            "en_curso" -> {
                cronometro.base = SystemClock.elapsedRealtime()
                cronometro.start()
            }
            else -> {
                cronometro.stop()
                btnVolverLlamar.visibility = View.VISIBLE
            }
        }
    }

    private fun agregarOrden(o: Orden) {
        ordenes.add(0, o)
        while (ordenes.size > MAX_ORDENES) ordenes.removeAt(ordenes.size - 1)
        pintarOrdenes()
    }

    private fun pintarOrdenes() {
        listaOrdenes.removeAllViews()
        txtSinOrdenes.visibility = if (ordenes.isEmpty()) View.VISIBLE else View.GONE
        val relleno = (8 * resources.displayMetrics.density).toInt()
        for (o in ordenes) {
            val fila = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, relleno, 0, relleno)
            }
            val hora = TextView(this).apply {
                text = o.hora
                setTextColor(color(R.color.pizarra))
                textSize = 13f
                minWidth = (52 * resources.displayMetrics.density).toInt()
            }
            val detalle = TextView(this).apply {
                text = if (o.nombre != null) "${o.nombre}\n${o.numero}" else o.numero
                setTextColor(color(R.color.tinta))
                textSize = 14f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val resultado = TextView(this).apply {
                text = o.resultado
                textSize = 13f
                setTextColor(
                    color(
                        when {
                            o.resultado.startsWith("Contestó") -> R.color.positivo
                            o.resultado.startsWith("No") -> R.color.alerta
                            else -> R.color.pizarra
                        }
                    )
                )
            }
            fila.addView(hora)
            fila.addView(detalle)
            fila.addView(resultado)
            listaOrdenes.addView(fila)
        }
    }

    private fun pintarPermisos() {
        val filas = listOf(
            Triple(R.id.puntoPermLlamadas, R.id.btnPermLlamadas, Manifest.permission.CALL_PHONE),
            Triple(R.id.puntoPermEstado, R.id.btnPermEstado, Manifest.permission.READ_PHONE_STATE),
            Triple(R.id.puntoPermRegistro, R.id.btnPermRegistro, Manifest.permission.READ_CALL_LOG),
        )
        for ((punto, boton, permiso) in filas) {
            val ok = tienePermiso(permiso)
            colorearFondo(findViewById(punto), if (ok) R.color.positivo else R.color.alerta)
            findViewById<MaterialButton>(boton).visibility = if (ok) View.GONE else View.VISIBLE
        }
    }

    private fun copiarIp() {
        val ip = ipLocal() ?: return
        val portapapeles = getSystemService(ClipboardManager::class.java)
        portapapeles?.setPrimaryClip(ClipData.newPlainText("IP Phoenix Mobile", ip))
        Toast.makeText(this, "IP copiada: $ip", Toast.LENGTH_SHORT).show()
    }

    private fun aplicarPantallaEncendida(activo: Boolean) {
        if (activo) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun textoDuracion(segundos: Long): String {
        val min = segundos / 60
        return if (min > 0) "$min min ${segundos % 60} s" else "$segundos s"
    }

    // ===================================================================
    // Permisos
    // ===================================================================

    private fun tienePermiso(permiso: String): Boolean =
        ContextCompat.checkSelfPermission(this, permiso) == PackageManager.PERMISSION_GRANTED

    /** El seguimiento automático necesita ver el estado y el registro de llamadas. */
    private fun seguimientoDisponible(): Boolean =
        tienePermiso(Manifest.permission.READ_PHONE_STATE) && tienePermiso(Manifest.permission.READ_CALL_LOG)

    /**
     * Pide permisos; si Android ya no muestra el diálogo (el usuario marcó
     * «No volver a preguntar»), abre los ajustes de la app.
     */
    private fun pedirPermisos(permisos: Array<String>, codigo: Int) {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val bloqueado = permisos.any {
            !tienePermiso(it) && prefs.getBoolean("pedido_$it", false) &&
                !ActivityCompat.shouldShowRequestPermissionRationale(this, it)
        }
        if (bloqueado) {
            Toast.makeText(this, "Activa el permiso en Ajustes > Permisos.", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            return
        }
        prefs.edit().apply { permisos.forEach { putBoolean("pedido_$it", true) } }.apply()
        ActivityCompat.requestPermissions(this, permisos, codigo)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE).edit()
        permissions.forEach { prefs.putBoolean("pedido_$it", true) }
        prefs.apply()
        pintarPermisos()
        registrarEscuchaLlamadas()
        refrescarConexion()
    }

    // ===================================================================
    // Red
    // ===================================================================

    /** Primera IPv4 privada del teléfono (la que se escribe en CarteraX). */
    private fun ipLocal(): String? = try {
        Collections.list(NetworkInterface.getNetworkInterfaces())
            .filter { it.isUp && !it.isLoopback }
            .flatMap { Collections.list(it.inetAddresses) }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
            ?.hostAddress
    } catch (_: Exception) {
        null
    }
}
