package cl.ersphoenix.phone

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
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

/**
 * Phoenix Mobile v0.4 — pantalla. Sólo muestra; el trabajo lo hace
 * [ServicioPhoenix], que sigue atendiendo a CarteraX aunque esta pantalla
 * quede detrás del marcador o se cierre.
 *
 * Orden: estado de conexión, vinculación (código de 6 dígitos o computador
 * vinculado), llamada en curso, lo necesario para que no se corte
 * (permisos y batería) y las últimas llamadas.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val REQ_PERMISOS = 2001
        private const val PREFS = "phoenix"
        private const val PREF_PANTALLA = "pantalla_encendida"
        private const val CONEXION_RECIENTE_MS = 45_000L
    }

    private val principal = Handler(Looper.getMainLooper())
    private val refresco = object : Runnable {
        override fun run() {
            pintarConexion()
            principal.postDelayed(this, 2000)
        }
    }

    private lateinit var puntoConexion: View
    private lateinit var txtConexion: TextView
    private lateinit var grupoSinVincular: View
    private lateinit var grupoVinculado: View
    private lateinit var digitos: List<TextView>
    private lateinit var txtVinculadoCon: TextView
    private lateinit var txtUltimaSenal: TextView
    private lateinit var txtIp: TextView
    private lateinit var chipLlamada: TextView
    private lateinit var txtCliente: TextView
    private lateinit var filaNumero: View
    private lateinit var txtNumero: TextView
    private lateinit var cronometro: Chronometer
    private lateinit var btnVolverLlamar: MaterialButton
    private lateinit var listaOrdenes: LinearLayout
    private lateinit var txtSinOrdenes: TextView

    private val oyente: () -> Unit = { pintarTodo() }
    private var faseMostrada: EstadoPhoenix.Fase? = null
    private var codigoMostrado = ""

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
        findViewById<MaterialButton>(R.id.btnNuevoCodigo).setOnClickListener {
            Vinculo.de(this).regenerarCodigo()
            pintarVinculo()
        }
        findViewById<MaterialButton>(R.id.btnDesvincular).setOnClickListener {
            Vinculo.de(this).desvincular()
            ServicioPhoenix.iniciar(this, ServicioPhoenix.ACCION_REFRESCAR)
            pintarTodo()
            Toast.makeText(this, getString(R.string.desvinculado), Toast.LENGTH_SHORT).show()
        }
        btnVolverLlamar.setOnClickListener { volverALlamar() }
        findViewById<MaterialButton>(R.id.btnPermLlamadas).setOnClickListener { pedirPermisos(arrayOf(Manifest.permission.CALL_PHONE)) }
        findViewById<MaterialButton>(R.id.btnPermEstado).setOnClickListener { pedirPermisos(arrayOf(Manifest.permission.READ_PHONE_STATE)) }
        findViewById<MaterialButton>(R.id.btnPermRegistro).setOnClickListener { pedirPermisos(arrayOf(Manifest.permission.READ_CALL_LOG)) }
        findViewById<MaterialButton>(R.id.btnPermAvisos).setOnClickListener {
            if (Build.VERSION.SDK_INT >= 33) pedirPermisos(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        }
        findViewById<MaterialButton>(R.id.btnPermBateria).setOnClickListener { pedirSinRestriccionBateria() }
        findViewById<View>(R.id.filaPermAvisos).visibility = if (Build.VERSION.SDK_INT >= 33) View.VISIBLE else View.GONE

        // Primer arranque: se piden todos los permisos de una vez (RNF-21).
        val faltantes = permisosBase().filter { !tienePermiso(it) }
        if (faltantes.isNotEmpty()) ActivityCompat.requestPermissions(this, faltantes.toTypedArray(), REQ_PERMISOS)

        ServicioPhoenix.iniciar(this)
        EstadoPhoenix.alCambiar = oyente
        pintarTodo()
    }

    override fun onResume() {
        super.onResume()
        // Pudo conceder permisos desde Ajustes o cerrar el servicio desde la notificación.
        ServicioPhoenix.iniciar(this, ServicioPhoenix.ACCION_REFRESCAR)
        pintarTodo()
        principal.post(refresco)
    }

    override fun onPause() {
        super.onPause()
        principal.removeCallbacks(refresco)
    }

    override fun onDestroy() {
        if (EstadoPhoenix.alCambiar === oyente) EstadoPhoenix.alCambiar = null
        principal.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun enlazarVistas() {
        puntoConexion = findViewById(R.id.puntoConexion)
        txtConexion = findViewById(R.id.txtConexion)
        grupoSinVincular = findViewById(R.id.grupoSinVincular)
        grupoVinculado = findViewById(R.id.grupoVinculado)
        digitos = listOf(R.id.d1, R.id.d2, R.id.d3, R.id.d4, R.id.d5, R.id.d6).map { findViewById(it) }
        txtVinculadoCon = findViewById(R.id.txtVinculadoCon)
        txtUltimaSenal = findViewById(R.id.txtUltimaSenal)
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
    // Pintado
    // ===================================================================

    private fun pintarTodo() {
        pintarConexion()
        pintarVinculo()
        pintarLlamada()
        pintarPermisos()
        pintarOrdenes()
    }

    private fun color(id: Int) = ContextCompat.getColor(this, id)

    private fun colorear(vista: View, colorId: Int) {
        ViewCompat.setBackgroundTintList(vista, ColorStateList.valueOf(color(colorId)))
    }

    /** Píldora de la cabecera y texto de la última señal. */
    private fun pintarConexion() {
        val ip = EstadoPhoenix.ipLocal()
        txtIp.text = if (ip != null) "$ip:${ServicioPhoenix.PUERTO}" else getString(R.string.sin_wifi)
        val vinculo = Vinculo.de(this)
        val hace = (SystemClock.elapsedRealtime() - EstadoPhoenix.ultimoContacto) / 1000
        val reciente = EstadoPhoenix.ultimoContacto > 0 && hace * 1000 < CONEXION_RECIENTE_MS

        val (colorId, texto) = when {
            !EstadoPhoenix.servicioActivo -> R.color.gris_estado to getString(R.string.estado_detenido)
            EstadoPhoenix.errorServidor != null -> R.color.alerta to getString(R.string.estado_error)
            !EstadoPhoenix.servidorListo -> R.color.gris_estado to getString(R.string.estado_iniciando)
            ip == null -> R.color.alerta to getString(R.string.sin_wifi)
            !tienePermiso(Manifest.permission.CALL_PHONE) -> R.color.alerta to getString(R.string.estado_sin_permiso)
            !vinculo.vinculado -> R.color.acento to getString(R.string.estado_sin_vincular)
            reciente -> R.color.positivo to getString(R.string.estado_conectado)
            else -> R.color.aviso to getString(R.string.estado_esperando)
        }
        colorear(puntoConexion, colorId)
        txtConexion.text = texto

        txtUltimaSenal.text = when {
            !EstadoPhoenix.servicioActivo -> getString(R.string.senal_detenido)
            EstadoPhoenix.errorServidor != null -> EstadoPhoenix.errorServidor
            ip == null -> getString(R.string.senal_sin_wifi)
            reciente -> getString(R.string.senal_reciente, hace)
            else -> getString(R.string.senal_esperando)
        }
    }

    private fun pintarVinculo() {
        val vinculo = Vinculo.de(this)
        if (vinculo.vinculado) {
            grupoSinVincular.visibility = View.GONE
            grupoVinculado.visibility = View.VISIBLE
            txtVinculadoCon.text = vinculo.computador ?: "CarteraX"
            codigoMostrado = ""
        } else {
            grupoVinculado.visibility = View.GONE
            grupoSinVincular.visibility = View.VISIBLE
            val codigo = vinculo.codigo
            if (codigo != codigoMostrado) {
                digitos.forEachIndexed { i, t ->
                    t.text = codigo.getOrNull(i)?.toString() ?: ""
                    // Entrada escalonada y corta al cambiar el código.
                    t.alpha = 0f
                    t.translationY = 8f * resources.displayMetrics.density
                    t.animate().alpha(1f).translationY(0f).setStartDelay(i * 30L).setDuration(200).start()
                }
                codigoMostrado = codigo
            }
        }
    }

    private fun pintarLlamada() {
        val fase = EstadoPhoenix.fase
        if (fase == EstadoPhoenix.Fase.ESPERANDO) {
            chipLlamada.text = getString(R.string.sin_llamada)
            chipLlamada.setTextColor(color(R.color.tinta_3))
            colorear(chipLlamada, R.color.superficie_2)
            txtCliente.text = getString(R.string.esperando_orden)
            txtCliente.setTextColor(color(R.color.tinta_3))
            txtCliente.textSize = 15f
            filaNumero.visibility = View.GONE
            btnVolverLlamar.visibility = View.GONE
            faseMostrada = fase
            return
        }
        txtCliente.text = EstadoPhoenix.nombre ?: getString(R.string.llamada_carterax)
        txtCliente.setTextColor(color(R.color.tinta))
        txtCliente.textSize = 22f
        txtNumero.text = EstadoPhoenix.numero ?: ""
        filaNumero.visibility = View.VISIBLE

        val (texto, fondo, tinta) = when (fase) {
            EstadoPhoenix.Fase.MARCANDO -> Triple(R.string.fase_marcando, R.color.acento_suave, R.color.acento_hondo)
            EstadoPhoenix.Fase.EN_CURSO -> Triple(R.string.fase_en_curso, R.color.positivo_suave, R.color.positivo)
            EstadoPhoenix.Fase.CONTESTO -> Triple(R.string.fase_contesto, R.color.positivo_suave, R.color.positivo)
            EstadoPhoenix.Fase.NO_CONTESTO -> Triple(R.string.fase_no_contesto, R.color.alerta_suave, R.color.alerta)
            EstadoPhoenix.Fase.FALLO -> Triple(R.string.fase_fallo, R.color.alerta_suave, R.color.alerta)
            else -> Triple(R.string.fase_termino, R.color.superficie_2, R.color.tinta_3)
        }
        chipLlamada.text = getString(texto)
        chipLlamada.setTextColor(color(tinta))
        colorear(chipLlamada, fondo)

        if (fase != faseMostrada) {
            chipLlamada.alpha = 0f
            chipLlamada.animate().alpha(1f).setDuration(180).start()
            when (fase) {
                EstadoPhoenix.Fase.MARCANDO -> {
                    cronometro.stop()
                    cronometro.base = SystemClock.elapsedRealtime()
                }
                EstadoPhoenix.Fase.EN_CURSO -> {
                    cronometro.base = EstadoPhoenix.inicioCurso.takeIf { it > 0 } ?: SystemClock.elapsedRealtime()
                    cronometro.start()
                }
                else -> {
                    cronometro.stop()
                    cronometro.base = SystemClock.elapsedRealtime() - EstadoPhoenix.duracionFinal * 1000
                }
            }
            faseMostrada = fase
        }
        val terminada = fase != EstadoPhoenix.Fase.MARCANDO && fase != EstadoPhoenix.Fase.EN_CURSO
        btnVolverLlamar.visibility = if (terminada) View.VISIBLE else View.GONE
    }

    private fun pintarOrdenes() {
        val ordenes = EstadoPhoenix.copiaOrdenes()
        listaOrdenes.removeAllViews()
        txtSinOrdenes.visibility = if (ordenes.isEmpty()) View.VISIBLE else View.GONE
        val d = resources.displayMetrics.density
        ordenes.forEachIndexed { i, o ->
            if (i > 0) {
                listaOrdenes.addView(View(this).apply {
                    setBackgroundColor(color(R.color.linea))
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1 * d).toInt().coerceAtLeast(1))
                })
            }
            val fila = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(0, (12 * d).toInt(), 0, (12 * d).toInt())
            }
            val tono = when (o.tono) {
                EstadoPhoenix.Tono.BIEN -> R.color.positivo
                EstadoPhoenix.Tono.MAL -> R.color.alerta
                else -> R.color.gris_estado
            }
            val punto = View(this).apply {
                setBackgroundResource(R.drawable.punto_estado)
                layoutParams = LinearLayout.LayoutParams((8 * d).toInt(), (8 * d).toInt()).apply { marginEnd = (12 * d).toInt() }
            }
            colorear(punto, tono)
            val textos = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            textos.addView(TextView(this).apply {
                text = o.nombre ?: o.numero
                setTextColor(color(R.color.tinta))
                textSize = 15f
                paint.isFakeBoldText = true
            })
            textos.addView(TextView(this).apply {
                text = if (o.nombre != null) "${o.numero} · ${o.hora}" else o.hora
                setTextColor(color(R.color.tinta_3))
                textSize = 13f
            })
            val resultado = TextView(this).apply {
                text = o.resultado
                textSize = 13f
                setTextColor(color(if (o.tono == EstadoPhoenix.Tono.NEUTRO) R.color.tinta_3 else tono))
            }
            fila.addView(punto)
            fila.addView(textos)
            fila.addView(resultado)
            listaOrdenes.addView(fila)
        }
    }

    private fun pintarPermisos() {
        val energia = getSystemService(POWER_SERVICE) as PowerManager
        val filas = listOf(
            Triple(R.id.puntoPermLlamadas, R.id.btnPermLlamadas, tienePermiso(Manifest.permission.CALL_PHONE)),
            Triple(R.id.puntoPermEstado, R.id.btnPermEstado, tienePermiso(Manifest.permission.READ_PHONE_STATE)),
            Triple(R.id.puntoPermRegistro, R.id.btnPermRegistro, tienePermiso(Manifest.permission.READ_CALL_LOG)),
            Triple(R.id.puntoPermAvisos, R.id.btnPermAvisos, Build.VERSION.SDK_INT < 33 || tienePermiso(Manifest.permission.POST_NOTIFICATIONS)),
            Triple(R.id.puntoPermBateria, R.id.btnPermBateria, energia.isIgnoringBatteryOptimizations(packageName)),
        )
        for ((punto, boton, ok) in filas) {
            colorear(findViewById(punto), if (ok) R.color.positivo else R.color.alerta)
            findViewById<MaterialButton>(boton).visibility = if (ok) View.GONE else View.VISIBLE
        }
    }

    // ===================================================================
    // Acciones
    // ===================================================================

    private fun volverALlamar() {
        val numero = EstadoPhoenix.numero ?: return
        if (!tienePermiso(Manifest.permission.CALL_PHONE)) return pedirPermisos(arrayOf(Manifest.permission.CALL_PHONE))
        try {
            startActivity(Intent(Intent.ACTION_CALL, Uri.fromParts("tel", numero, null)))
        } catch (e: Exception) {
            Toast.makeText(this, getString(R.string.no_se_pudo_llamar), Toast.LENGTH_LONG).show()
        }
    }

    private fun copiarIp() {
        val ip = EstadoPhoenix.ipLocal() ?: return
        getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("IP Phoenix Mobile", ip))
        Toast.makeText(this, getString(R.string.ip_copiada, ip), Toast.LENGTH_SHORT).show()
    }

    private fun aplicarPantallaEncendida(activo: Boolean) {
        if (activo) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** Pide que Android no duerma la app (las marcas con ahorro agresivo la cierran). */
    @Suppress("BatteryLife")
    private fun pedirSinRestriccionBateria() {
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    // ===================================================================
    // Permisos
    // ===================================================================

    private fun permisosBase(): List<String> {
        val base = mutableListOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
        if (Build.VERSION.SDK_INT >= 33) base.add(Manifest.permission.POST_NOTIFICATIONS)
        return base
    }

    private fun tienePermiso(permiso: String): Boolean =
        ContextCompat.checkSelfPermission(this, permiso) == PackageManager.PERMISSION_GRANTED

    /**
     * Pide permisos; si Android ya no muestra el diálogo (el usuario marcó
     * «No volver a preguntar»), abre los ajustes de la app.
     */
    private fun pedirPermisos(permisos: Array<String>) {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val bloqueado = permisos.any {
            !tienePermiso(it) && prefs.getBoolean("pedido_$it", false) &&
                !ActivityCompat.shouldShowRequestPermissionRationale(this, it)
        }
        if (bloqueado) {
            Toast.makeText(this, getString(R.string.activa_en_ajustes), Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            return
        }
        prefs.edit().apply { permisos.forEach { putBoolean("pedido_$it", true) } }.apply()
        ActivityCompat.requestPermissions(this, permisos, REQ_PERMISOS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE).edit()
        permissions.forEach { prefs.putBoolean("pedido_$it", true) }
        prefs.apply()
        // El servicio empieza a escuchar las llamadas apenas hay permiso.
        ServicioPhoenix.iniciar(this, ServicioPhoenix.ACCION_REFRESCAR)
        pintarTodo()
    }
}
