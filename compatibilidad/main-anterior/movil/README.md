# Phoenix Mobile (Android)

Proyecto integrado desde `CONEXION_PC_A_ANDROID` (prototipo *direct call* v0.2).
La lógica es idéntica al original; en v0.2.0 sólo se agregó documentación KDoc
en `MainActivity.kt`.

| Carpeta | Contenido |
|---|---|
| `android/` | App Android. Abrir en Android Studio y ejecutar en el teléfono |
| `pc-prueba-python/` | Prototipo Python original. **Reemplazado** por la sección «Teléfono» de la app Electron (`src/movil/clienteMovil.ts`); se conserva como referencia |
| `README_DIRECT_CALL.md` | Instrucciones originales de prueba |

No se incluyeron `build/`, `.gradle/`, `.idea/`, el `.apk` compilado ni
`local.properties` (contiene la ruta del SDK de cada PC; Android Studio lo
vuelve a crear al abrir el proyecto).

Protocolo y flujo completo: ver `docs/INTEGRACION.md`.
