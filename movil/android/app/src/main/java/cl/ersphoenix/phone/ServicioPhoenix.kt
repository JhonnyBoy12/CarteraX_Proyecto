package cl.ersphoenix.phone

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.CallLog
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Corazón de Phoenix Mobile v0.4: servicio en primer plano que atiende a
 * CarteraX y sigue cada llamada.
 *
 * Por qué un servicio: en la v0.3 todo vivía en la pantalla. Al abrirse el
 * marcador, Android podía suspender o cerrar la app; CarteraX veía el
 * teléfono «desconectado», el término de la llamada se perdía (sin minutos) y
 * la cola quedaba esperando. Ahora:
 *  - El servidor, la escucha de llamadas y la lectura del registro viven aquí,
 *    con notificación fija, Wi‑Fi de alto rendimiento y CPU despierta.
 *  - La llamada se marca con TelecomManager.placeCall (no abre una pantalla,
 *    así que Android no la bloquea aunque la app esté en segundo plano).
 *  - La llamada en curso se guarda: si Android reinicia el servicio, la cierra
 *    al volver leyendo el registro de llamadas.
 *  - Si el registro no aparece, la duración queda «desconocida» (CarteraX
 *    pregunta) en vez de contarse como «no contestó».
 *  - Si nunca pasa a «en curso», se informa que no se pudo marcar.
 */
class ServicioPhoenix : Service() {

    companion object {
        const val PUERTO = 8765
        const val VERSION = "0.4.0"
        const val ACCION_DETENER = "cl.ersphoenix.phone.DETENER"
        const val ACCION_REFRESCAR = "cl.ersphoenix.phone.REFRESCAR"
        private const val CANAL = "phoenix_servicio"
        private const val NOTIF_ID = 1
        /** Reintentos para leer el registro de llamadas tras colgar (1 s entre cada uno). */
        private const val REINTENTOS_REGISTRO = 10
        /** Si la llamada no pasa a «en curso» en este tiempo, no se pudo marcar. */
        private const val ESPERA_MARCADO_MS = 15_000L

        fun iniciar(ctx: Context, accion: String? = null) {
            val i = Intent(ctx, ServicioPhoenix::class.java)
            if (accion != null) i.action = accion
            ContextCompat.startForegroundService(ctx, i)
        }

        fun detener(ctx: Context) {
            ctx.startService(Intent(ctx, ServicioPhoenix::class.java).setAction(ACCION_DETENER))
        }
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var vinculo: Vinculo
    private var servidor: ServidorPhoenix? = null
    private val principal = Handler(Looper.getMainLooper())
    private var oyente: PhoneStateListener? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val cerrojo = Any()

    // --- Llamada actual (la leen los hilos del servidor) ---
    @Volatile private var estadoTelefono = TelephonyManager.CALL_STATE_IDLE
    @Volatile private var idLlamada = 0L
    @Volatile private var numero: String? = null
    @Volatile private var nombre: String? = null
    /** System.currentTimeMillis() al marcar. */
    @Volatile private var marcadaEn = 0L
    /** Se marcó y todavía no se cierra. */
    @Volatile private var abierta = false
    /** El teléfono llegó a «en curso» (OFFHOOK). */
    @Volatile private var vioCurso = false
    @Volatile private var terminada = false
    @Volatile private var contestada: Boolean? = null
    @Volatile private var duracion = 0L
    /** Segundos desde que se marcó hasta colgar (incluye el timbre). */
    @Volatile private var transcurrido = 0L
    @Volatile private var fallo = false

    // ===================================================================
    // Ciclo de vida
    // ===================================================================

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences("phoenix", MODE_PRIVATE)
        vinculo = Vinculo.de(this)
        crearCanal()
        entrarPrimerPlano()
        tomarCerrojos()
        restaurarLlamada()
        registrarEscucha()
        EstadoPhoenix.servicioActivo = true
        EstadoPhoenix.errorServidor = null

        servidor = ServidorPhoenix(
            PUERTO,
            manejador = ::manejar,
            alIniciar = { EstadoPhoenix.servidorListo = true; EstadoPhoenix.avisar() },
            alError = { m -> EstadoPhoenix.errorServidor = m; EstadoPhoenix.avisar() },
        ).also { it.iniciar() }

        // Volvió tras un cierre a mitad de llamada y ya se colgó: se cierra con el registro.
        if (abierta && !terminada) {
            principal.postDelayed({
                if (abierta && !terminada && estadoTelefono == TelephonyManager.CALL_STATE_IDLE) {
                    cerrarLlamada(idLlamada, REINTENTOS_REGISTRO)
                }
            }, 1500)
        }
        EstadoPhoenix.avisar()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACCION_DETENER -> {
                apagar()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACCION_REFRESCAR -> {
                registrarEscucha()
                actualizarNotificacion()
            }
        }
        // Si Android cierra el proceso, vuelve a levantar el servicio solo.
        return START_STICKY
    }

    override fun onDestroy() {
        apagar()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun apagar() {
        servidor?.detener()
        servidor = null
        oyente?.let {
            @Suppress("DEPRECATION")
            (getSystemService(TELEPHONY_SERVICE) as TelephonyManager).listen(it, PhoneStateListener.LISTEN_NONE)
        }
        oyente = null
        principal.removeCallbacksAndMessages(null)
        try { wifiLock?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
        try { wakeLock?.takeIf { it.isHeld }?.release() } catch (_: Exception) {}
        EstadoPhoenix.servicioActivo = false
        EstadoPhoenix.servidorListo = false
        EstadoPhoenix.avisar()
    }

    // ===================================================================
    // Notificación y recursos
    // ===================================================================

    private fun crearCanal() {
        val canal = NotificationChannel(CANAL, getString(R.string.canal_servicio), NotificationManager.IMPORTANCE_LOW)
        canal.description = getString(R.string.canal_servicio_ayuda)
        canal.setShowBadge(false)
        getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
    }

    private fun notificacion(): Notification {
        val abrir = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val detener = PendingIntent.getService(
            this, 1, Intent(this, ServicioPhoenix::class.java).setAction(ACCION_DETENER),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val texto = when {
            abierta && !terminada -> getString(R.string.notif_llamando, nombre ?: numero ?: "")
            vinculo.vinculado -> getString(R.string.notif_vinculado, vinculo.computador ?: "CarteraX")
            else -> getString(R.string.notif_sin_vincular)
        }
        return NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(getString(R.string.notif_titulo))
            .setContentText(texto)
            .setContentIntent(abrir)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setColor(ContextCompat.getColor(this, R.color.acento))
            .addAction(0, getString(R.string.notif_detener), detener)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun entrarPrimerPlano() {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notificacion(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notificacion())
        }
    }

    private fun actualizarNotificacion() {
        try {
            getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notificacion())
        } catch (_: SecurityException) {
            // Sin permiso de notificaciones en Android 13+: el servicio sigue igual.
        }
    }

    /** Wi‑Fi sin ahorro de energía y CPU despierta mientras el servicio atiende. */
    @Suppress("DEPRECATION")
    private fun tomarCerrojos() {
        try {
            val wifi = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Phoenix:wifi").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (_: Exception) {
        }
        try {
            val energia = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = energia.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Phoenix:servicio").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (_: Exception) {
        }
    }

    // ===================================================================
    // Protocolo con CarteraX (hilos del servidor)
    // ===================================================================

    private fun manejar(p: Peticion): Pair<Int, JSONObject> {
        val autorizado = vinculo.tokenValido(p.cabeceras["x-phoenix-token"])
        if (autorizado) {
            EstadoPhoenix.ultimoContacto = SystemClock.elapsedRealtime()
            EstadoPhoenix.avisar()
        }
        val protegida = p.ruta in setOf("/call", "/call-status", "/call-status/ack", "/unpair")
        return when {
            p.metodo == "GET" && p.ruta == "/ping" -> 200 to ping(autorizado)
            p.metodo == "POST" && p.ruta == "/pair" -> vincular(p.cuerpo)
            protegida && !autorizado -> 401 to JSONObject()
                .put("ok", false)
                .put("code", "NO_VINCULADO")
                .put(
                    "error",
                    if (vinculo.vinculado) "Este teléfono está vinculado con otro computador. Vuelve a vincularlo con el código."
                    else "Este teléfono no está vinculado. Vincúlalo desde CarteraX con el código que muestra Phoenix Mobile."
                )
            p.metodo == "POST" && p.ruta == "/unpair" -> {
                vinculo.desvincular()
                EstadoPhoenix.avisar()
                principal.post { actualizarNotificacion() }
                200 to JSONObject().put("ok", true)
            }
            p.metodo == "GET" && p.ruta == "/call-status" -> 200 to estadoLlamada()
            p.metodo == "POST" && p.ruta == "/call-status/ack" -> {
                synchronized(cerrojo) {
                    if (terminada) {
                        terminada = false
                        contestada = null
                        duracion = 0L
                        transcurrido = 0L
                        fallo = false
                        guardarLlamada()
                    }
                }
                200 to JSONObject().put("ok", true)
            }
            p.metodo == "POST" && p.ruta == "/call" -> recibirLlamada(p.cuerpo)
            else -> 404 to JSONObject().put("ok", false).put("error", "Ruta no encontrada")
        }
    }

    /** Sin vínculo sólo dice quién es (para que CarteraX lo encuentre al buscar). */
    private fun ping(autorizado: Boolean): JSONObject {
        val j = JSONObject()
            .put("ok", true)
            .put("app", "Phoenix Mobile")
            .put("version", VERSION)
            .put("device", "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}")
            .put("deviceId", vinculo.idEquipo)
            .put("pairing", true)
            .put("paired", vinculo.vinculado)
            .put("authorized", autorizado)
        if (autorizado) {
            j.put("directCall", true)
                .put("callPermission", tienePermiso(Manifest.permission.CALL_PHONE))
                .put("callStateTracking", seguimientoDisponible())
                .put("pairedWith", vinculo.computador ?: JSONObject.NULL)
        }
        return j
    }

    private fun vincular(cuerpo: String): Pair<Int, JSONObject> {
        val json = try { JSONObject(cuerpo) } catch (_: Exception) {
            return 400 to JSONObject().put("ok", false).put("error", "JSON inválido")
        }
        return when (val r = vinculo.vincular(json.optString("code", ""), json.optString("desktop", "CarteraX"))) {
            is Vinculo.Resultado.Vinculado -> {
                EstadoPhoenix.ultimoContacto = SystemClock.elapsedRealtime()
                EstadoPhoenix.avisar()
                principal.post { actualizarNotificacion() }
                200 to JSONObject()
                    .put("ok", true)
                    .put("token", r.token)
                    .put("device", "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}")
                    .put("deviceId", vinculo.idEquipo)
            }
            is Vinculo.Resultado.Incorrecto -> {
                EstadoPhoenix.avisar()
                401 to JSONObject().put("ok", false).put("code", "CODIGO_INCORRECTO")
                    .put("error", "Código incorrecto. Te quedan ${r.restantes} intentos.")
            }
            is Vinculo.Resultado.Bloqueado -> {
                EstadoPhoenix.avisar()
                429 to JSONObject().put("ok", false).put("code", "BLOQUEADO")
                    .put("error", "Demasiados intentos. Espera ${r.segundos} s y usa el código nuevo que muestra el teléfono.")
            }
        }
    }

    private fun estadoLlamada(): JSONObject = synchronized(cerrojo) {
        val enCurso = abierta && !terminada && marcadaEn > 0
        JSONObject()
            .put("ok", true)
            .put("callId", idLlamada)
            .put("state", nombreEstado())
            .put("completed", terminada)
            .put("answered", contestada ?: JSONObject.NULL)
            .put("duration", duracion)
            .put("elapsed", if (enCurso) (System.currentTimeMillis() - marcadaEn) / 1000 else transcurrido)
            .put("reachedCall", vioCurso)
            .put("dialFailed", fallo)
            .put("phone", numero ?: JSONObject.NULL)
    }

    private fun recibirLlamada(cuerpo: String): Pair<Int, JSONObject> {
        val json = try { JSONObject(cuerpo) } catch (_: Exception) {
            return 400 to JSONObject().put("ok", false).put("error", "JSON inválido")
        }
        val n = json.optString("phone", "").trim()
        val nom = json.optString("name", "").trim().ifEmpty { null }
        if (n.isBlank()) return 400 to JSONObject().put("ok", false).put("error", "Número vacío")

        if (!tienePermiso(Manifest.permission.CALL_PHONE)) {
            EstadoPhoenix.avisar()
            return 403 to JSONObject().put("ok", false).put("error", "Phoenix Mobile no tiene permiso para llamar. Concédelo en el teléfono.")
        }
        if (estadoTelefono != TelephonyManager.CALL_STATE_IDLE) {
            return 409 to JSONObject().put("ok", false).put("code", "OCUPADO")
                .put("error", "El teléfono está en otra llamada. Termínala y vuelve a intentar.")
        }

        val id = synchronized(cerrojo) {
            idLlamada += 1
            numero = n
            nombre = nom
            marcadaEn = System.currentTimeMillis()
            abierta = true
            vioCurso = false
            terminada = false
            contestada = null
            duracion = 0L
            transcurrido = 0L
            fallo = false
            guardarLlamada()
            idLlamada
        }

        principal.post {
            EstadoPhoenix.agregarOrden(EstadoPhoenix.Orden(SimpleDateFormat("HH:mm", Locale.forLanguageTag("es-CL")).format(Date()), nom, n))
            EstadoPhoenix.nombre = nom
            EstadoPhoenix.numero = n
            EstadoPhoenix.fase = EstadoPhoenix.Fase.MARCANDO
            EstadoPhoenix.avisar()
            actualizarNotificacion()
            marcar(n)
            principal.postDelayed({ vigilarMarcado(id) }, ESPERA_MARCADO_MS)
        }
        return 200 to JSONObject().put("ok", true).put("phone", n).put("action", "CALL").put("callId", id)
    }

    // ===================================================================
    // Llamadas
    // ===================================================================

    /**
     * Marca con TelecomManager.placeCall: no abre una pantalla desde la app,
     * así que funciona aunque Phoenix Mobile esté en segundo plano (Android
     * 10+ bloquea abrir pantallas desde atrás, que era lo que a veces impedía
     * que la cola marcara). Si falla, prueba con ACTION_CALL.
     */
    private fun marcar(n: String) {
        val uri = Uri.fromParts("tel", n, null)
        try {
            val telecom = getSystemService(TELECOM_SERVICE) as TelecomManager
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) {
                telecom.placeCall(uri, Bundle())
                return
            }
        } catch (_: Exception) {
        }
        try {
            startActivity(Intent(Intent.ACTION_CALL, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            cerrarComoFallo(idLlamada)
        }
    }

    /** Nunca pasó a «en curso»: sin señal, sin SIM, modo avión o Android lo bloqueó. */
    private fun vigilarMarcado(id: Long) {
        if (id != idLlamada || !abierta || terminada || vioCurso) return
        if (!tienePermiso(Manifest.permission.READ_PHONE_STATE)) return // sin permiso no se puede saber
        if (estadoTelefono != TelephonyManager.CALL_STATE_IDLE) return
        cerrarComoFallo(id)
    }

    private fun cerrarComoFallo(id: Long) {
        synchronized(cerrojo) {
            if (id != idLlamada || terminada) return
            transcurrido = (System.currentTimeMillis() - marcadaEn) / 1000
            duracion = 0L
            contestada = false
            fallo = true
            terminada = true
            abierta = false
            guardarLlamada()
        }
        EstadoPhoenix.ultimaOrden()?.apply { resultado = "No se pudo marcar"; tono = EstadoPhoenix.Tono.MAL }
        EstadoPhoenix.fase = EstadoPhoenix.Fase.FALLO
        EstadoPhoenix.avisar()
        actualizarNotificacion()
    }

    @Suppress("DEPRECATION")
    private fun registrarEscucha() {
        if (oyente != null || !tienePermiso(Manifest.permission.READ_PHONE_STATE)) return
        val telefonia = getSystemService(TELEPHONY_SERVICE) as TelephonyManager
        val o = object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                alCambiarEstado(state)
            }
        }
        try {
            telefonia.listen(o, PhoneStateListener.LISTEN_CALL_STATE)
            oyente = o
        } catch (_: SecurityException) {
        }
    }

    private fun alCambiarEstado(state: Int) {
        val anterior = estadoTelefono
        estadoTelefono = state
        if (!abierta || terminada) return
        if (state == TelephonyManager.CALL_STATE_OFFHOOK && anterior != TelephonyManager.CALL_STATE_OFFHOOK) {
            vioCurso = true
            guardarLlamada()
            EstadoPhoenix.inicioCurso = SystemClock.elapsedRealtime()
            EstadoPhoenix.fase = EstadoPhoenix.Fase.EN_CURSO
            EstadoPhoenix.avisar()
        } else if (state == TelephonyManager.CALL_STATE_IDLE && anterior != TelephonyManager.CALL_STATE_IDLE) {
            synchronized(cerrojo) {
                transcurrido = (System.currentTimeMillis() - marcadaEn) / 1000
                guardarLlamada()
            }
            val id = idLlamada
            // El registro de llamadas se escribe un instante después de colgar.
            principal.postDelayed({ cerrarLlamada(id, REINTENTOS_REGISTRO) }, 1000)
        }
    }

    /**
     * Cierra la llamada con la duración del registro de Android. Se reintenta
     * porque el registro puede tardar varios segundos; si no aparece, la
     * duración queda desconocida (CarteraX pregunta) en vez de «no contestó».
     */
    private fun cerrarLlamada(id: Long, intentos: Int) {
        if (id != idLlamada || terminada) return
        val n = numero ?: return
        val segundos = if (tienePermiso(Manifest.permission.READ_CALL_LOG)) duracionDesde(n, marcadaEn) else null
        if (segundos == null && intentos > 1 && tienePermiso(Manifest.permission.READ_CALL_LOG)) {
            principal.postDelayed({ cerrarLlamada(id, intentos - 1) }, 1000)
            return
        }
        synchronized(cerrojo) {
            if (id != idLlamada || terminada) return
            if (transcurrido == 0L && marcadaEn > 0) transcurrido = (System.currentTimeMillis() - marcadaEn) / 1000
            duracion = segundos ?: 0L
            contestada = segundos?.let { it > 0 }
            terminada = true
            abierta = false
            guardarLlamada()
        }
        EstadoPhoenix.duracionFinal = segundos ?: 0L
        EstadoPhoenix.ultimaOrden()?.apply {
            when {
                segundos == null -> { resultado = "Terminó"; tono = EstadoPhoenix.Tono.NEUTRO }
                segundos > 0 -> { resultado = "Contestó · ${textoDuracion(segundos)}"; tono = EstadoPhoenix.Tono.BIEN }
                else -> { resultado = "No contestó"; tono = EstadoPhoenix.Tono.MAL }
            }
        }
        EstadoPhoenix.fase = when {
            segundos == null -> EstadoPhoenix.Fase.TERMINO
            segundos > 0 -> EstadoPhoenix.Fase.CONTESTO
            else -> EstadoPhoenix.Fase.NO_CONTESTO
        }
        EstadoPhoenix.avisar()
        actualizarNotificacion()
    }

    /**
     * Duración (s) de la llamada saliente a ese número registrada después de
     * `desde` (ms), o null si todavía no aparece. Se comparan los últimos 8
     * dígitos para tolerar +56, 9 o espacios.
     */
    private fun duracionDesde(n: String, desde: Long): Long? {
        val digitos = n.filter { it.isDigit() }.takeLast(8)
        return try {
            val cursor = contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DURATION),
                "${CallLog.Calls.TYPE} = ? AND ${CallLog.Calls.DATE} >= ?",
                arrayOf(CallLog.Calls.OUTGOING_TYPE.toString(), (desde - 10_000).toString()),
                "${CallLog.Calls.DATE} DESC"
            ) ?: return null
            cursor.use { c ->
                val iNumero = c.getColumnIndex(CallLog.Calls.NUMBER)
                val iDuracion = c.getColumnIndex(CallLog.Calls.DURATION)
                var revisadas = 0
                while (c.moveToNext() && revisadas < 8) {
                    revisadas++
                    val num = c.getString(iNumero)?.filter { it.isDigit() } ?: continue
                    if (num.takeLast(8) == digitos) return c.getLong(iDuracion)
                }
            }
            null
        } catch (_: Exception) {
            null
        }
    }

    private fun nombreEstado(): String = when (estadoTelefono) {
        TelephonyManager.CALL_STATE_RINGING -> "RINGING"
        TelephonyManager.CALL_STATE_OFFHOOK -> "OFFHOOK"
        else -> "IDLE"
    }

    // ===================================================================
    // Persistencia de la llamada (sobrevive a un reinicio del proceso)
    // ===================================================================

    private fun guardarLlamada() {
        prefs.edit()
            .putLong("ll_id", idLlamada)
            .putString("ll_numero", numero)
            .putString("ll_nombre", nombre)
            .putLong("ll_marcada", marcadaEn)
            .putBoolean("ll_abierta", abierta)
            .putBoolean("ll_curso", vioCurso)
            .putBoolean("ll_terminada", terminada)
            .putInt("ll_contestada", when (contestada) { null -> -1; true -> 1; false -> 0 })
            .putLong("ll_duracion", duracion)
            .putLong("ll_transcurrido", transcurrido)
            .putBoolean("ll_fallo", fallo)
            .apply()
    }

    private fun restaurarLlamada() {
        idLlamada = prefs.getLong("ll_id", 0L)
        numero = prefs.getString("ll_numero", null)
        nombre = prefs.getString("ll_nombre", null)
        marcadaEn = prefs.getLong("ll_marcada", 0L)
        abierta = prefs.getBoolean("ll_abierta", false)
        vioCurso = prefs.getBoolean("ll_curso", false)
        terminada = prefs.getBoolean("ll_terminada", false)
        contestada = when (prefs.getInt("ll_contestada", -1)) { 1 -> true; 0 -> false; else -> null }
        duracion = prefs.getLong("ll_duracion", 0L)
        transcurrido = prefs.getLong("ll_transcurrido", 0L)
        fallo = prefs.getBoolean("ll_fallo", false)
        // Una llamada abierta de hace más de 2 horas ya no se puede seguir.
        if (abierta && System.currentTimeMillis() - marcadaEn > 2 * 3600_000L) abierta = false
    }

    // ===================================================================
    // Utilidades
    // ===================================================================

    private fun tienePermiso(permiso: String): Boolean =
        ContextCompat.checkSelfPermission(this, permiso) == PackageManager.PERMISSION_GRANTED

    private fun seguimientoDisponible(): Boolean =
        tienePermiso(Manifest.permission.READ_PHONE_STATE) && tienePermiso(Manifest.permission.READ_CALL_LOG)

    private fun textoDuracion(segundos: Long): String {
        val min = segundos / 60
        return if (min > 0) "$min min ${segundos % 60} s" else "$segundos s"
    }
}
