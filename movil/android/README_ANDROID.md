# Phoenix Mobile (Android) — v0.3.0

App Android en Kotlin que recibe las órdenes de llamada de CarteraX por la
Wi‑Fi local y llama con la SIM del teléfono (ERS RF-28, RF-29, RNF-16, RNF-21).

## Compilar

1. Instala Android Studio (incluye el JDK 17).
2. `File → Open` → carpeta `movil/android`.
3. Espera la sincronización de Gradle y pulsa **Run** con el teléfono conectado
   por USB (depuración USB activada).

APK instalable: `Build → Build App Bundle(s) / APK(s) → Build APK(s)`; queda en
`app/build/outputs/apk/debug/app-debug.apk`. También lo genera el workflow
**Instaladores** de GitHub Actions.

## Uso

1. Abre la app y concede los tres permisos:
   - **Realizar llamadas** (obligatorio).
   - **Estado del teléfono** y **Registro de llamadas**: permiten avisar a
     CarteraX cuándo terminó la llamada y si el cliente contestó. Sin ellos,
     la cola funciona pero el ejecutivo marca el resultado a mano.
2. Conecta el teléfono a la misma Wi‑Fi que el computador.
3. Escribe en CarteraX → Teléfono la IP que muestra la tarjeta «Conexión con
   CarteraX». El punto se pone verde cuando CarteraX se comunica.
4. Deja activada «Mantener la pantalla encendida» mientras corre la cola.

## Código

| Archivo | Responsabilidad |
|---|---|
| `MainActivity.kt` | Pantalla, permisos, inicio de llamadas y lectura de su duración |
| `ServidorPhoenix.kt` | Servidor HTTP en el puerto 8765 (sin dependencias) |
| `res/layout/activity_main.xml` | Diseño de la pantalla |
| `res/values/colors.xml` | Paleta Phoenix (naranja/blanco) |

## Protocolo (JSON sobre HTTP, puerto 8765)

| Ruta | Respuesta |
|---|---|
| `GET /ping` | `{ ok, app, version, directCall, callPermission, callStateTracking, device }` |
| `POST /call` `{ phone, name?, rut? }` | `{ ok, phone, action: "CALL" }` · 400 número vacío · 403 sin permiso |
| `GET /call-status` | `{ ok, callId, state: IDLE/RINGING/OFFHOOK, completed, answered, duration, phone }` |
| `POST /call-status/ack` | `{ ok }` (CarteraX confirma que procesó el término) |

Para probar CarteraX sin teléfono: `npm run simulador-movil` (implementa el
mismo protocolo) e IP `127.0.0.1`.
