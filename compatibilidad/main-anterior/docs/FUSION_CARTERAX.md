# Fusión CarteraX + ERS Phoenix v0.2.0

## Objetivo

Este directorio es un prototipo separado. No reemplaza el repositorio actual de CarteraX. Su objetivo es validar cuánto del piloto ERS Phoenix puede reutilizarse manteniendo un modelo de datos normalizado y coherente con CarteraX.

## Qué se conservó del piloto

- Lector unificado de Excel, CSV, TSV, TXT y ODS.
- Previsualización de archivos antes de importar.
- Normalización de montos, fechas, RUT y encabezados.
- Mapeo flexible de columnas y alias.
- Interfaz Electron del piloto como base visual.
- IPC entre renderer y proceso principal.
- Servidor HTTP embebido y modo servidor.
- Cliente de Phoenix Mobile y proyecto Android.
- Simulador de móvil y pruebas del cargador.
- Configuración persistente de IP/puerto.

## Qué se cambió

La base del piloto no se copió como modelo final. Se reemplazó por un esquema normalizado con:

- `usuarios`
- `periodos`
- `clientes`
- `operaciones`
- `telefonos`
- `correos`
- `direcciones`
- `vehiculos`
- `carteras`
- `cartera_clientes`
- `importaciones`
- `errores_importacion`
- `gestiones`
- `configuracion`

El importador ahora separa los datos del archivo entre esas entidades. También realiza búsqueda de clientes por RUT/DV para evitar el problema del piloto que insertaba nuevamente un cliente al reimportar.

Se agregó la vista `v_clientes_resumen` para que el panel pueda consultar información agregada sin volver a desnormalizar las tablas.

## Contexto local temporal

El login todavía no está implementado. Para que el prototipo pueda probarse de punta a punta, el ETL crea automáticamente:

- un usuario `ejecutivo-local`;
- el periodo correspondiente al mes actual;
- una cartera para ese ejecutivo y periodo.

Esto es una solución de prototipo. Cuando se implemente autenticación, el contexto deberá provenir de la sesión del usuario.

## Cambios pendientes antes de considerarlo producción

1. Implementar login, recuperación y cambio de contraseña.
2. Sustituir el contexto local automático por la sesión autenticada.
3. Diseñar migraciones versionadas de SQLite.
4. Revisar reglas de negocio para operaciones sin número de operación.
5. Definir estrategia de reimportación/actualización de operaciones existentes.
6. Completar validación de correos, teléfonos y RUT.
7. Separar formalmente `llamadas` de `gestiones` y construir la cola progresiva.
8. Probar Phoenix Mobile con un teléfono Android físico.
9. Adaptar textos/nombres visuales restantes de “Phoenix” a “CarteraX”.
10. Revisar el servidor HTTP y autenticación antes de exponerlo fuera de una red de pruebas.

## Ejecución

```powershell
npm install
npm run build
npm start
```

Para ejecutar las pruebas heredadas del cargador:

```powershell
npm run prueba
```

Para simular el teléfono Android:

```powershell
npm run simulador-movil
```

## Nota de integración

Este prototipo debe evaluarse en una rama o carpeta separada. No se recomienda copiarlo directamente sobre `feature/database` hasta validar importación, panel, llamadas y esquema con datos ficticios y con copias controladas de los Excel reales.

## Cola de llamadas

Se agregó una primera cola de llamadas basada en la cartera importada. La selección consulta `cartera_clientes` y `telefonos`, usa sólo teléfonos válidos y pendientes, y excluye clientes cuyo estado importado indique pago/cierre (`pago realizado`, `pagado`, `pago`, `cerrado`, `cancelado`).

Cada teléfono mantiene `estado_llamada`, `intentos_llamada` y `ultima_llamada`. Al enviar una llamada al móvil queda en estado `ENVIADA`, evitando que el mismo número vuelva a salir inmediatamente como pendiente.

Esta versión todavía no avanza automáticamente al finalizar físicamente una llamada Android: el prototipo móvil actual no devuelve al escritorio un evento fiable de fin de llamada. La cola ya selecciona y filtra correctamente; la automatización completa se implementará cuando el móvil reporte el ciclo de llamada y su resultado.


## Modo automático de cola de llamadas

Se incorporó un proceso de cola controlado desde la aplicación de escritorio. La cola:

- excluye clientes cuyo estado importado corresponde a pago/cierre;
- selecciona teléfonos válidos pendientes por prioridad;
- inicia la llamada mediante la app Android;
- consulta periódicamente el estado telefónico;
- se mantiene en estado `EN_LLAMADA` mientras Android informa una llamada en curso;
- al finalizar, consulta la duración de la llamada saliente en Android;
- si la duración es 0, marca el teléfono `NO_CONTESTA` y prioriza el siguiente número del mismo cliente;
- si la duración es mayor a 0, marca el teléfono y cliente como `CONTACTADO` y continúa con otro cliente;
- permite detener manualmente la cola desde el escritorio.

La app Android requiere además `READ_PHONE_STATE` y `READ_CALL_LOG`. Esta detección se diseñó para el prototipo interno/sideload. Antes de distribución se deben revisar las restricciones de permisos de Android/Google Play y probar el comportamiento en los modelos de teléfono objetivo.
