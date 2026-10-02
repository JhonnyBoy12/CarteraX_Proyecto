# CarteraX — Prototipo fusionado

Prototipo de integración entre la arquitectura normalizada desarrollada para CarteraX y las funcionalidades reutilizables de ERS Phoenix v0.2.0.

La documentación específica de la fusión está en `docs/FUSION_CARTERAX.md`.

Principales capacidades incluidas:

- Electron + TypeScript.
- SQLite con claves foráneas y modo WAL.
- ETL para Excel/CSV con previsualización y normalización.
- Modelo normalizado de clientes, operaciones, contactos, carteras e importaciones.
- Registro de errores de importación.
- Panel y búsqueda de clientes heredados del piloto mediante una vista de compatibilidad.
- Comunicación con la aplicación Android de llamadas.
- Simulador de móvil.
- Servidor HTTP embebido.

Este directorio es de prueba y no modifica el repositorio principal de CarteraX.

## Control de importaciones duplicadas

El ETL calcula una huella SHA-256 del contenido de cada archivo antes de importarlo. Si la misma cartera ya registra esa huella, la importación se detiene antes de insertar clientes, teléfonos u operaciones. Esto también detecta el mismo archivo si fue renombrado. Las bases creadas antes de esta mejora agregan automáticamente la columna `archivo_hash` al iniciar.

## Reinicio de datos para pruebas

La vista Historial incorpora **Borrar datos importados**. Esta acción detiene la cola de llamadas y elimina los datos generados por las importaciones (clientes, teléfonos, operaciones, contactos, gestiones e historial), conservando usuarios y configuración local. Está pensada únicamente para pruebas y permite cargar una cartera nueva para que la cola trabaje sólo con esos clientes y teléfonos.
