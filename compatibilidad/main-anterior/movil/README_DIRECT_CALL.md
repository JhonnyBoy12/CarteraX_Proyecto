# Phoenix Phone Prototype - Direct Call v0.2

Esta versión cambia la prueba anterior de `ACTION_DIAL` a `ACTION_CALL`.

## Resultado esperado

Phoenix Desktop -> Wi-Fi local -> Phoenix Mobile -> llamada iniciada con la SIM del teléfono.

No requiere una API de telefonía ni un servidor externo.

## Primera ejecución

1. Abre `android/` en Android Studio.
2. Sincroniza Gradle.
3. Selecciona el teléfono físico y pulsa Run.
4. Phoenix Mobile pedirá permiso para realizar llamadas. Pulsa **Permitir**.
5. Comprueba que la app muestre `Permiso para llamadas: ✅ concedido`.
6. PC y teléfono deben estar en la misma Wi-Fi.
7. En el PC ejecuta `pc/run_pc.bat`.
8. Introduce la IP que Phoenix Mobile muestra en pantalla.
9. Pulsa `PROBAR CONEXIÓN`.
10. Introduce un número de prueba autorizado y pulsa `ENVIAR / LLAMAR`.

Si Android y el fabricante permiten `ACTION_CALL` normalmente, la llamada debe comenzar sin tener que tocar el botón verde del marcador.

## Compatibilidad usada

- Android Gradle Plugin: 8.3.2
- Kotlin: 1.9.22
- compileSdk: 34
- targetSdk: 34
- Java/Kotlin JVM: 17
- androidx.core-ktx: 1.13.1

## Nota

La llamada usa el plan/SIM del teléfono. Pueden existir restricciones adicionales del fabricante, configuración del teléfono, SIM/eSIM o políticas empresariales.
