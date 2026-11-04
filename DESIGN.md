# CarteraX — sistema de diseño (v0.4)

Herramienta de trabajo diario para ejecutivos de cobranza (modo *Operate*):
escaneo rápido, cifras legibles y estados de cobranza reconocibles. La
identidad naranja/blanco del ERS (RNF-03) se conserva; el naranja se reserva
para acciones, foco y selección.

Fuente de verdad: `src/renderer/styles.css` (tokens en `:root`) y, en
Android, `movil/android/app/src/main/res/values*/colors.xml` + `themes.xml`.

## Mundo

**Consola de cobranza con el perfil de Phoenix Service** (azul noche,
naranja cálido, durazno y blanco). Marco azul noche en L (escritorio) /
cabecera azul noche (Phoenix Mobile); el trabajo ocurre sobre papel con un
toque de azul. Los tokens conservan el nombre `--grafito`. Nada decorativo:
la única firma es la **franja de la cartera**, la deuda del mes partida por
estado de cobranza, que encabeza el dashboard y reaparece como hilo de color
en el login y bajo la cabecera del teléfono.

## Color

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--naranja` / `--naranja-accion` | #DE762E | #EC8A44 | Marca y fondo de botones, con texto `--sobre-naranja` |
| `--sobre-naranja` | #16203A | #16203A | Texto sobre naranja (5,1:1), como el botón de Phoenix Service |
| `--naranja-hondo` | #A9520F | #FFA86B | Naranja como texto |
| `--naranja-suave` | #FCEBDD (durazno) | #3B2617 | Selección, foco, fondos tenues |
| `--grafito` | #172039 (azul noche) | #0A0F1E | Marco: lateral y barra superior |
| `--fondo` / `--superficie` | #EEF0F5 / #FFF | #0F1426 / #161D33 | Lienzo / paneles |
| `--tinta` / `--pizarra` | #16203A / #515C77 | #E8ECF6 / #A3ADC8 | Texto / texto secundario |
| `--positivo` / `--alerta` / `--aviso` | verde / rojo / ámbar | aclarados | Semántica, siempre con fondo `-suave` |

Tonos de estado (`--tono-*`): misma luminosidad aproximada para que ningún
estado grite más que otro. En oscuro se aclaran. El naranja de marca nunca
lleva texto blanco: va con `--sobre-naranja`.

## Tipografía

Archivo variable (incluida). Texto a ancho normal, 13,5 px; cifras y
títulos condensados (`font-stretch` 68–86 %), siempre `tabular-nums`.
Escala: h1 23 · h2 14 · cuerpo 13,5 · etiquetas 12. Sin mayúsculas forzadas
ni rótulos sobre los títulos.

## Densidad y forma

Compacta: filas de tabla 7 px de relleno, paneles 14–16 px, separación 14 px.
Radio 8 px en paneles y 5 px en controles. Sin sombras en paneles; sólo los
elementos flotantes (ficha, panel lateral, diálogos, avisos) llevan sombra.
Avisos y errores: ícono dibujado + fondo tenue, nunca franja lateral gruesa.

## Movimiento

Curva única `--salida` (ease-out exponencial). Respuestas a acciones del
usuario: entrada de vista (6 px + opacidad), ficha y panel lateral que se
deslizan, diálogos que crecen 2 %, filtros que se despliegan, error de
formulario que se sacude. Un solo momento orquestado: al abrir el dashboard
se revela la franja y crecen las barras. Todo se apaga con
`prefers-reduced-motion`.

Capa dinámica (`src/renderer/movimiento.ts`, sólo presentación): marco grafito
en L con el contenido como hoja; indicador del menú que se desliza; cifras
que cuentan; foco en la franja; la cola late en verde al llamar; avisos con
cuenta regresiva; cabecera de ficha fija.

## Logo y barra lateral

Logo (`src/renderer/assets/logo.svg`, fuente de todos los íconos; se regeneran
con `npx electron scripts/generar-iconos.js`): cuadrado azul noche con una X
cuyo trazo ascendente es una flecha naranja (recuperación) y el otro trazo,
blanco, se corta en el cruce. Íconos anteriores en `docs/logo-anterior/`.

Barra lateral y panel del login en naranja hondo (`--lateral-arriba` #BF5520 →
`--lateral-abajo` #A3461A; en oscuro #9A4417 → #6F3011), texto blanco (AA),
insignias en azul noche. La barra superior sigue azul noche.
