# CarteraX — interfaz moderna

Segunda interfaz completa de la aplicación (en el código, `src/nova/`; en
pantalla se llama sólo «CarteraX», y en el menú Ver, «Interfaz moderna»).
Usa el mismo backend (IPC, base SQLite, servicios) y la misma lógica de cola,
importación, reportes, teléfono, ajustes y recordatorios que la interfaz
clásica. Cambia la presentación, el login, el tablero y la ficha del cliente.

## Color

- **Primario — azul noche** (tema oscuro): fondos de apoyo en escalones
  sólidos de una sola familia: `--fondo` (lienzo) → `--lateral` (marco) →
  `--superficie` (tarjetas) → `--superficie-2` (bloques internos) →
  `--superficie-3` (hover). En el tema claro, papel cálido (#F5F3F0) con
  tinta azul noche (#161B2C).
- **Acento — naranjo llamativo** (`--acento`, #FF7A1A en oscuro, #F06A0F en
  claro), siempre con texto oscuro `--sobre-acento` (#1C0D02). Sólo acción,
  selección y foco: botón principal, sección activa del menú, pestaña y
  segmento activos. `--acento-suave` es el fondo tintado de lo seleccionado.
- **Acompañante**: halos muy tenues de naranjo y azul en el lienzo.

Los colores de estado sólo aparecen en datos y etiquetas.

## Movimiento

Dos curvas: `--salida` (ease-out) para lo que entra o sale y `--mover`
(ease-in-out) para lo que ya está en pantalla y se desplaza (indicador del
menú y de las pestañas). Lo que se usa todo el día es corto: cambio de vista
200 ms, pestañas 180 ms, ficha 260 ms al abrir y 200 ms al cerrar (con su
velo al mismo ritmo), diálogos 200/150 ms con fondo incluido. Un solo
momento orquestado: al cargar el Inicio cuentan las cifras y crecen los
gráficos; cambiar de pestaña después ya no los vuelve a animar. Las tarjetas
de la cartera entran sólo al llegar a la vista, no en cada búsqueda. El
cambio de tema usa un fundido nativo (View Transitions). Los pulsos en vivo
(cola, llamada) usan sólo `transform` y `opacity`. Todo se apaga con
«reducir movimiento».

## Cómo abrirla

Es la interfaz por defecto: `npm start` y el ejecutable la abren siempre, y
el menú ya no ofrece cambiar de interfaz. La clásica (`src/renderer/`) se
conserva sólo para desarrollo: `npm run clasica`, `--clasica` o
`CARTERAX_UI=clasica`.

Capturas: `npm run capturas:nova` (o con `CAPTURAS_TEMA=light`), en
`docs/capturas/nova/oscuro` y `docs/capturas/nova/claro`. `npm run capturas`
sigue capturando la clásica.

## Archivos

| Archivo | Qué hace |
|---|---|
| `src/nova/index.html` | Estructura: login, lateral, barra superior, vistas, ficha, diálogos, paleta |
| `src/nova/nova.css` | Estilos y tokens (oscuro y claro) |
| `src/nova/nucleo.ts` | Sesión, login, navegación, tema, menú de perfil, paleta Ctrl K |
| `src/nova/tablero.ts` | Inicio en pestañas: Resumen, Actividad, Metas, Categorías |
| `src/nova/graficos-nova.ts` | Anillo, dona, ritmo diario, calendario, barras por día y hora |
| `src/nova/cartera.ts` | Cartera (tabla o tarjetas) y ficha del cliente |
| `src/nova/movimiento-nova.ts` | Indicador del menú, cifras que cuentan, foco de la franja |
| `tsconfig.nova.json` | Empaqueta todo (más la lógica compartida de `src/renderer`) en `dist/nova/nova.js` |

La lógica que se reutiliza sin cambios vive en `src/renderer/` (`api`,
`util`, `graficos`, `vista-cola`, `vista-importar`, `vista-reportes`,
`vista-telefono`, `vista-config`, `vista-recordatorios`). Por eso los `id`
del HTML de Nova son los mismos que los de la clásica.

## Qué agrega

- **Login**: panel de marca con fondo animado, mostrar/ocultar contraseña,
  aviso de Bloq Mayús, recordar el correo, botón con estado de carga y
  sacudida en el error.
- **Inicio en cuatro pestañas**: *Resumen* (cifras con minilínea, foco de
  hoy, meta, agenda, compromisos, mayores deudas); *Actividad* (llamadas,
  contestadas, tiempo hablado, gestiones, días activos, racha, ritmo diario,
  resultado de las llamadas, día de la semana, horario de llamadas);
  *Metas* (avance, proyección al cierre, lo necesario por día hábil, meta
  definible desde ahí mismo, calendario del mes y metas personales de
  llamadas, gestiones, contactabilidad y cobertura); *Categorías* (franja,
  tarjetas por estado, tramos, rangos y composición).
- **Ficha del cliente** como panel deslizante: avatar, anillo de prioridad,
  llamar, enviar a la cola en un clic, copiar RUT/teléfono/correo, cliente
  anterior/siguiente (Alt + ↑/↓), recuperado del mes, historial filtrable
  por tipo, operaciones con vencimiento.
- **Cartera en tabla o tarjetas**, **paleta Ctrl K** (clientes y acciones),
  **menú de perfil** con la actividad de hoy, **tema claro/oscuro** e
  indicador de fuerza de la nueva contraseña.

Las metas personales y el tema se guardan en el equipo (`localStorage`);
la meta de recuperación es la misma de Ajustes.
