# Registro de cambios — ERS Phoenix

## v0.2.0 — Integración cargador CSV/XLSX + Phoenix Mobile + cliente-servidor

Base: `PRUEBA_IMPORT_EXCEL` (v0.1.0). Integrado: `CONEXION_PC_A_ANDROID`
(prototipo *direct call*). El diff completo de los archivos originales está en
[`cambios_archivos_originales.patch`](cambios_archivos_originales.patch)
(ábrelo en VS Code para verlo coloreado).

### Principio seguido: compatibilidad hacia atrás

Nada de lo que funcionaba en la v0.1.0 cambió de nombre ni de forma:

| Elemento v0.1.0 | Estado en v0.2.0 |
|---|---|
| Canal IPC `dialogo:elegir-excel` | Igual. Ahora el filtro también acepta `.csv .tsv .txt .ods .xlsm` |
| Canal IPC `importacion:ejecutar` | Igual, misma respuesta `{ ok, resultado }`. Acepta CSV |
| Canal IPC `resumen:obtener` | Igual. Se agregan campos opcionales `indicadores` y `tramos` |
| Canal IPC `importaciones:historial` | Igual |
| `window.phoenixAPI.elegirArchivoExcel / importarExcel / obtenerResumen / obtenerHistorial` | Iguales |
| `importarExcel(db, ruta, usuarioId)` | Se mantiene como alias de `importarArchivo` |
| Tablas de `schema.sql` | Sin cambios. Sólo se AGREGAN objetos con `IF NOT EXISTS` |
| Base `phoenix_local.db` existente | Se abre sin pérdida de datos (verificado con una base creada por la v0.1.0) |
| Paleta naranja/blanco (RNF-04) | Se conserva (`--naranja`, `--naranja-suave`) |
| Lógica de `MainActivity.kt` (Android) | Idéntica; sólo se agregaron comentarios KDoc |

### Archivos NUEVOS

| Archivo | Propósito | Funciones exportadas |
|---|---|---|
| `src/importacion/lectorArchivos.ts` | Cargador unificado CSV/TSV/TXT + Excel | `leerArchivoTabular`, `detectarFormato`, `decodificarTexto`, `detectarSeparador`, `parsearCsv`, `matrizAObjetos` |
| `src/importacion/previsualizador.ts` | Vista previa sin escribir en la base | `previsualizarArchivo` |
| `src/movil/clienteMovil.ts` | Cliente HTTP hacia Phoenix Mobile (port del Python) | `pingMovil`, `llamarDesdeMovil`, `normalizarIp`, `normalizarTelefono`, `telefonoEsValido` |
| `src/servicios/servicioCartera.ts` | Lógica de cartera compartida por IPC y HTTP | `obtenerResumen`, `obtenerHistorial`, `buscarClientes`, `obtenerCategorias`, `previsualizar`, `importar` |
| `src/servicios/servicioMovil.ts` | Llamadas + registro en `gestiones` | `obtenerIpMovil`, `guardarIpMovil`, `probarMovil`, `llamar`, `obtenerLlamadas` |
| `src/servidor/servidorHttp.ts` | API REST + estáticos (cliente-servidor) | `iniciarServidor`, `ipsLocales`, `urlsDeAcceso` |
| `src/servidor/gestorServidor.ts` | Ciclo de vida del servidor dentro de Electron | `arrancarSegunConfig`, `configurarServidor`, `estadoServidor`, `leerConfigServidor`, `detenerServidor` |
| `src/servidor/standalone.ts` | Backend sin ventana (`npm run servidor`) | — (punto de entrada) |
| `src/ipc/manejadoresIpc.ts` | Canales IPC (originales movidos + nuevos) | `registrarManejadoresIpc` |
| `src/db/configuracion.ts` | Tabla clave/valor `configuracion` | `leerConfig`, `guardarConfig`, `leerConfigBool`, `leerConfigNumero` |
| `src/tipos/contratos.d.ts` | Tipos compartidos backend/frontend (`Phoenix.*`) | — (sólo tipos) |
| `src/renderer/api.ts` | Adaptador: misma interfaz por IPC o HTTP | objeto global `Api` |
| `scripts/copiar-assets.js` | Reemplaza el `node -e` en línea del build | — |
| `scripts/servidor.js` | Lanza el backend con el Node interno de Electron | — |
| `scripts/simulador-movil.js` | Simula Phoenix Mobile para probar sin teléfono | — |
| `scripts/generar-ejemplos.js` | Crea archivos de ejemplo con datos ficticios | — |
| `pruebas/cargador.prueba.js` | 29 pruebas del cargador (`npm run prueba`) | — |
| `ejemplos/*.xlsx, *.csv` | Archivos de prueba ficticios | — |
| `movil/android/` | Proyecto Android Phoenix Mobile (fuentes) | — |
| `movil/pc-prueba-python/` | Prototipo Python original (referencia) | — |
| `.vscode/` | Depuración y tareas para VS Code | — |

### Archivos MODIFICADOS

**`src/importacion/importador.ts`** — lógica de inserción sin cambios.
- La lectura pasa por `leerArchivoTabular` (antes `XLSX.readFile` + `sheet_to_json`). Para Excel usa exactamente las mismas opciones (`defval: null, raw: true`).
- Nueva función `importarArchivo(db, ruta, usuarioId, nombreOriginal?)`; `importarExcel` queda como alias `@deprecated`.
- Si el RUT viene como `12.345.678-9` y no hay columna DV aparte, se separa en `rut` + `dv`.
- El resultado incluye `formato` (campo opcional nuevo).

**`src/importacion/normalizador.ts`** — mismas firmas.
- `limpiarNumero`: si recibe TEXTO entiende `"$ 1.234.567"`, `"1.234,5"`, `"1,234.5"`, `"1.500"`. Antes `"1.234.567"` se convertía en `1.234` (error silencioso). Si recibe un número (Excel) el resultado es idéntico.
- `limpiarFechaYYYYMMDD`: agrega `dd/mm/aaaa`, `dd-mm-aaaa`, `dd.mm.aaaa`, `aaaa-mm-dd` y seriales de Excel (`45106`). Antes un serial producía una fecha del año 45106. Rechaza fechas inexistentes (`31/02`). Cálculo en UTC (independiente de zona horaria).
- Nueva `separarRut`.

**`src/importacion/mapeoColumnas.ts`**
- Diccionario original intacto + sección "ALIAS v0.2.0" (`TELEFONO`, `CELULAR`, `EMAIL`, `NOMBRE CLIENTE`, `MONTO DEUDA`, `DV`, `COMUNA`, `DIRECCION`, …).
- Normalización de encabezados ahora quita tildes y BOM (`Teléfono` = `TELEFONO`).
- Si dos columnas van al mismo teléfono/correo (p. ej. `TELEFONO` y `CELULAR`), la segunda pasa a `fono2` en vez de sobrescribir la primera.
- Nuevas `resolverColumna` y `asignarCampos`.

**`src/db/schema.sql`** — sólo se agregó al final: tabla `configuracion` y 6 índices.

**`src/db/conexion.ts`** — `journal_mode = WAL` (lecturas concurrentes ventana + servidor), crea la carpeta si no existe, nueva `rutaDbActual`.

**`src/db/consultas.ts`** — las 4 funciones originales sin cambios; nuevas `obtenerIndicadores`, `distribucionTramos`, `listarClientes`, `listarCategorias`, `historialLlamadas`.

**`src/main.ts`** — handlers IPC movidos a `ipc/manejadoresIpc.ts` (mismos canales); inicia el servidor HTTP embebido; ventana 1280×800; nuevo modo `--servidor` (sin ventana).

**`src/preload.ts`** — 4 métodos originales + 13 nuevos (ver `docs/INTEGRACION.md`). Arrastrar y soltar usa `webUtils.getPathForFile` (reemplazo oficial de `File.path`).

**`src/renderer/index.html`, `styles.css`, `renderer.ts`** — rediseño con navegación lateral y 6 vistas. Se conservan los nombres `cargarResumen` y `cargarHistorial`. Seguridad: se agregó Content-Security-Policy y todo dato importado se escapa con `esc()` antes de insertarse (la v0.1.0 lo insertaba sin escapar).

**`package.json`** — versión 0.2.0 y scripts nuevos (`servidor`, `simulador-movil`, `prueba`, `ejemplos`). `build` ahora usa `scripts/copiar-assets.js`. **Sin dependencias nuevas.**

**`movil/android/.../MainActivity.kt`** — sólo comentarios KDoc (verificado: el código sin comentarios es idéntico al original).

### Correcciones detectadas en la v0.1.0

1. Números en texto con separador de miles se truncaban (`"1.234.567"` → `1.234`).
2. Celdas con formato fecha de Excel (seriales) producían fechas inválidas.
3. Interfaz vulnerable a inyección de HTML desde el contenido de los archivos.
4. Prototipo Python: el botón decía "ABRIR MARCADOR" pero Android usa `ACTION_CALL` (llama directo). En Electron el botón dice "Llamar".

### Pendientes conocidos (no se cambiaron para no alterar el comportamiento)

- **Duplicados al reimportar:** el importador original inserta de nuevo los clientes si se importa dos veces el mismo archivo (ya figuraba en el README de la v0.1.0 como "upsert por RUT").
- **Contador "corregidos":** cuenta las filas sin columna `NORMALIZADO`, por lo que en archivos sin esa columna coincide con "cargados". Se mantuvo la regla original.
- **Login (RF-01 a RF-07):** el servidor ofrece token opcional (`PHOENIX_TOKEN`) mientras no exista autenticación por usuario.

### Pruebas realizadas

- 29 pruebas automáticas del cargador (`npm run prueba`), incluidas las que confirman que el comportamiento v0.1.0 no cambió.
- Importación de los 3 archivos de ejemplo (XLSX de 2 hojas; CSV `;` Windows-1252 con montos `$`, fechas `dd/mm/aaaa`, RUT con guion y `;` dentro de comillas; CSV `,` UTF-8 con BOM).
- API HTTP de punta a punta: protección CSRF, token, archivo no soportado, rutas estáticas y bloqueo de *path traversal*.
- Phoenix Mobile simulado: conexión, llamada, teléfono inalcanzable (4 s), permiso denegado (403), app cerrada; todos los intentos quedan registrados en `gestiones`.
- App Electron real (Electron 31.7.7, pantalla virtual): los 4 métodos originales responden igual, importación CSV por IPC, llamada, cambio de puerto del servidor en caliente, modo `--servidor`.
- Migración: base creada con el `schema.sql` original se abre sin pérdida de datos.
- No se probó en Windows físico ni con un teléfono Android real (ver `docs/INTEGRACION.md`, sección "Prueba en tu equipo").
