# Phoenix Mobile (Android) — v0.4.0

App Android en Kotlin que recibe las órdenes de llamada de CarteraX por la
Wi‑Fi local y llama con la SIM del teléfono (ERS RF-28, RF-29, RNF-16, RNF-21).
Misma paleta que la interfaz moderna de CarteraX: azul noche (oscuro) o papel
cálido (claro), con acento naranjo. Vistas en `docs/capturas/movil/`.

## Qué cambió en la 0.4

| Problema en la 0.3 | Causa | Solución en la 0.4 |
|---|---|---|
| A veces no registraba los minutos y la cola se quedaba esperando | Todo vivía en la pantalla: al abrirse el marcador Android suspendía o cerraba la app y se perdía el término de la llamada | `ServicioPhoenix`, servicio en primer plano con notificación fija, Wi‑Fi de alto rendimiento y CPU despierta. La llamada en curso se guarda y, si Android reinicia la app, se cierra con el registro de llamadas al volver |
| CarteraX veía el teléfono «desconectado» durante la llamada | Lo mismo: el servidor HTTP estaba en la pantalla | El servidor vive en el servicio |
| A veces la cola no marcaba el siguiente número | Android 10+ bloquea abrir el marcador desde una app en segundo plano | Se marca con `TelecomManager.placeCall`, que no abre pantallas |
| Llamadas contestadas que quedaban como «no contestó» | Si el registro de llamadas tardaba más de 5 s, se asumía 0 s | Se espera hasta 10 s; si no aparece, la duración queda «desconocida» y CarteraX pregunta |
| En una oficina, cualquier PC podía mandarle llamadas a cualquier teléfono | El servidor aceptaba órdenes de cualquiera en la red | Vínculo con código de 6 dígitos: sólo obedece al computador vinculado |
| Sin señal o sin SIM la cola esperaba 45 s | No se distinguía «no pudo marcar» | Si en 15 s no pasa a «en curso», informa `dialFailed` y la cola se pausa con el aviso |

## Compilar

1. Instala Android Studio (incluye el JDK 17).
2. `File → Open` → carpeta `movil/android`.
3. Espera la sincronización de Gradle y pulsa **Run** con el teléfono conectado
   por USB (depuración USB activada).

APK instalable: `Build → Build App Bundle(s) / APK(s) → Build APK(s)`; queda en
`app/build/outputs/apk/debug/app-debug.apk`. También lo genera el workflow
**Instaladores** de GitHub Actions.

Sin Android Studio: con JDK 17 y el SDK de Android (plataforma 34), escribe la
ruta del SDK en `local.properties` (`sdk.dir=...`) y ejecuta
`gradlew assembleDebug`. Si Gradle falla en Windows con «Unable to establish
loopback connection», define `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp`.

## Uso

1. Abre la app y deja todo en verde en «Para que no se corte»:
   - **Realizar llamadas** (obligatorio).
   - **Estado del teléfono** y **Registro de llamadas**: avisan a CarteraX
     cuándo terminó la llamada, si contestaron y cuánto duró.
   - **Notificaciones** (Android 13+): muestran que Phoenix sigue activo.
   - **Batería sin restricción**: evita que Android (sobre todo Xiaomi,
     Samsung, Huawei, Oppo) cierre Phoenix durante la llamada.
2. Conecta el teléfono a la misma Wi‑Fi que el computador.
3. En CarteraX → Teléfono pulsa «Buscar teléfonos», elige este equipo y
   escribe el código de 6 dígitos que muestra la app.
4. Phoenix sigue funcionando en segundo plano. Para detenerlo, usa «Detener»
   en la notificación.

## Código

| Archivo | Responsabilidad |
|---|---|
| `ServicioPhoenix.kt` | Servicio en primer plano: servidor, protocolo, marcado, seguimiento de la llamada y su registro |
| `ServidorPhoenix.kt` | Servidor HTTP en el puerto 8765 (sin dependencias) |
| `Vinculo.kt` | Código de 6 dígitos, token y bloqueo tras 5 intentos fallidos |
| `EstadoPhoenix.kt` | Estado compartido entre el servicio y la pantalla |
| `MainActivity.kt` | Pantalla y permisos (sólo muestra; el trabajo lo hace el servicio) |
| `res/layout/activity_main.xml` | Diseño de la pantalla |
| `res/values/colors.xml`, `values-night/colors.xml` | Paleta claro/oscuro |

## Protocolo (JSON sobre HTTP, puerto 8765)

El token del vínculo viaja en la cabecera `X-Phoenix-Token`.

| Ruta | Respuesta |
|---|---|
| `GET /ping` | `{ ok, app, version, device, deviceId, pairing, paired, authorized }` y, con token, `directCall, callPermission, callStateTracking, pairedWith` |
| `POST /pair` `{ code, desktop }` | `{ ok, token, device, deviceId }` · 401 código incorrecto · 429 demasiados intentos |
| `POST /unpair` | `{ ok }` (token) |
| `POST /call` `{ phone, name?, rut? }` | `{ ok, phone, action: "CALL", callId }` · 401 no vinculado · 403 sin permiso · 409 en otra llamada |
| `GET /call-status` | `{ ok, callId, state, completed, answered, duration, elapsed, reachedCall, dialFailed, phone }` (token) |
| `POST /call-status/ack` | `{ ok }` (token; CarteraX confirma que procesó el término) |

`answered: null` significa que el teléfono no pudo saberlo (sin permiso o sin
registro): CarteraX pregunta al ejecutivo en vez de suponer.

Para probar CarteraX sin teléfono: `npm run simulador-movil` (mismo protocolo;
muestra el código en la consola).
