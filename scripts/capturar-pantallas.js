/**
 * Genera las capturas de diseño de CarteraX sin tocar la base real.
 *
 * Abre la app compilada (dist/) con una carpeta de datos TEMPORAL, inicia
 * sesión con el usuario inicial, importa ejemplos/cartera_ejemplo.xlsx,
 * registra algunas gestiones de muestra, levanta el simulador de Phoenix
 * Mobile y fotografía cada vista.
 *
 * Tema: CAPTURAS_TEMA=dark o light (por defecto, el del sistema).
 *
 * Uso:
 *   npm run build
 *   npx electron scripts/capturar-pantallas.js [carpeta-salida]
 *   (por defecto: docs/capturas/diseno)
 */
const { app, nativeTheme } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const raiz = path.join(__dirname, "..");
const salida = path.resolve(process.argv[2] || path.join(raiz, "docs", "capturas", "diseno"));
const datos = fs.mkdtempSync(path.join(os.tmpdir(), "carterax-capturas-"));
fs.mkdirSync(salida, { recursive: true });
app.setPath("userData", datos);
// CAPTURAS_TEMA=dark|light fuerza el tema (por defecto, el del sistema).
if (process.env.CAPTURAS_TEMA) app.whenReady().then(() => (nativeTheme.themeSource = process.env.CAPTURAS_TEMA));

const ANCHO = 1440;
const ALTO = 900;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** CSV con filas válidas e inválidas para mostrar el panel de validación. */
function csvConErrores() {
  const filas = [
    "rut,nombre,deuda_total,fono1,fono2,correo_1,tramo_mora,DDAS_FEC_1ER_VCTO",
    '24878600-9,"VALENTINA PEÑA LAGOS",4515200,956844906,,cliente200@correo.cl,61-90,20230810',
    '17315457-1,"RODRIGO CASTRO VERA",8482000,972669752,,,1-30,20221110',
    ',"SIN RUT LIMITADA",1200000,955511122,,,1-30,20230110',
    '12345678-0,"DV ERRÓNEO SPA",3300000,912345678,,correo-sin-arroba,31-60,20230510',
    '15999888-K,"SIN TELÉFONO PÉREZ",-50000,123,,,31-60,20231340',
    '9876543-3,"DEUDA TEXTO ROJAS",no informa,987654321,987654321,ok@correo.cl,61-90,20220810',
    '17315457-1,"RODRIGO CASTRO VERA",8482000,972669752,,,1-30,20221110',
  ];
  const ruta = path.join(datos, "cartera_con_errores.csv");
  fs.writeFileSync(ruta, filas.join("\n"), "utf-8");
  return ruta;
}

async function ejecutar(win) {
  const js = (codigo) => win.webContents.executeJavaScript(`(async () => { ${codigo} })()`, true);
  const foto = async (nombre) => {
    await esperar(350);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(salida, `${nombre}.png`), img.toPNG());
    console.log(`  ✔ ${nombre}.png`);
  };
  const bajar = (px) => js(`document.getElementById("contenido").scrollTo({ top: ${px} });`);

  win.unmaximize();
  win.setContentSize(ANCHO, ALTO);
  await esperar(800);
  // Interfaz Nova: el tema se guarda en la página, no en el sistema.
  const esNova = await js(`return typeof elegirPestana === "function";`);
  if (esNova && process.env.CAPTURAS_TEMA) await js(`aplicarTema(${JSON.stringify(process.env.CAPTURAS_TEMA === "light" ? "claro" : "oscuro")}, false);`);
  await esperar(esNova ? 700 : 0);
  await foto("00_login");

  // Sesión e importación de la cartera de ejemplo.
  await js(`await entrarAplicacion(await Api.login("ejecutivo@carterax.cl", "CarteraX123!"));`);
  const ejemplo = path.join(raiz, "ejemplos", "cartera_ejemplo.xlsx");
  await js(`const r = await Api.importar(${JSON.stringify(ejemplo)}, App.contexto.periodo.id); aplicarContexto(r.contexto);`);

  // Gestiones de muestra: estados variados para alertas y recordatorios.
  await js(`
    const ids = (await Api.clientes({ orden: "prioridad", porPagina: 40 })).filas.map((f) => f.id);
    const en = (d) => { const f = new Date(); f.setDate(f.getDate() + d); return f.toISOString().slice(0, 10); };
    const g = (i, s) => Api.gestionar({ clienteIds: [ids[i]], ...s }).catch(() => undefined);
    await g(0, { estado: "COMPROMISO", fechaCompromiso: en(0), monto: 450000, comentario: "Paga hoy por transferencia." });
    await g(1, { estado: "COMPROMISO", fechaCompromiso: en(3), monto: 1200000, comentario: "Acordó pagar la cuota el viernes." });
    await g(2, { estado: "NOTIFICADO", comentario: "Se envió carta certificada con el detalle de la deuda." });
    await g(3, { estado: "NO_CONTESTA", comentario: "Buzón de voz en ambos teléfonos." });
    await g(4, { estado: "ALERTA", comentario: "Reclama cobro duplicado, revisar con el banco." });
    await g(5, { estado: "ABONO", monto: 300000, comentario: "Abonó una cuota." });
    await g(6, { estado: "PAGADO", comentario: "Regularizó la deuda completa." });
    await g(7, { estado: "CONTACTADO", comentario: "Pide que lo llamen después de las 18:00." });
    await Api.gestionar({ clienteIds: ids.slice(10, 20), estado: "EN_COLA" });
  `);

  // Simulador de Phoenix Mobile para las llamadas de muestra y la cola.
  const sim = spawn(process.execPath, [path.join(__dirname, "simulador-movil.js"), "--contesta=siempre", "--duracion=3", "--codigo=482913"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "ignore",
  });
  app.on("quit", () => sim.kill());
  for (let i = 0; i < 40; i++) {
    if (await js(`return (await Api.probarMovil("127.0.0.1")).conectado;`)) break;
    await esperar(250);
  }
  // Phoenix Mobile 0.4: se vincula con el código que muestra el teléfono.
  const conVinculo = await js(`return typeof Api.vincularMovil === "function";`);
  if (conVinculo) await js(`await Api.vincularMovil("127.0.0.1", "482913");`);

  // Llamadas de muestra (si la versión registra motivos): una contestada y
  // tres sin respuesta por distintos motivos.
  const conMotivos = await js(`return typeof MOTIVOS !== "undefined";`);
  if (conMotivos) {
    await js(`
      const espera = (ms) => new Promise((r) => setTimeout(r, ms));
      let e = await Api.colaIniciar();
      for (let i = 0; i < 30 && e.proceso !== "ESPERANDO_RESULTADO"; i++) { await espera(400); e = await Api.colaActualizar(); }
      e = await Api.colaResultado({ estado: "CONTACTADO", comentario: "Pide propuesta de repactación.", duracion: 184 });
      for (const m of ["ocupado", "apagado", "inexistente", "no_contesta"]) {
        if (!e.activa || !e.actual) break;
        e = await Api.colaFinalizar(m);
      }
      await Api.colaDetener();
    `);
  }

  // Dashboard (vista completa en dos tramos).
  await js(`irA("dashboard");`);
  await esperar(1200);
  await foto("01_dashboard");
  await bajar(700);
  await foto("02_dashboard_detalle");
  await bajar(1500);
  await foto("03_dashboard_final");

  // Nova: cada pestaña del inicio.
  if (esNova) {
    for (const [nombre, tab] of [["01b_inicio_actividad", "actividad"], ["01c_inicio_metas", "metas"], ["01d_inicio_categorias", "categorias"]]) {
      await js(`elegirPestana(document.querySelector("#dashboard-contenido .tablero"), ${JSON.stringify(tab)}); document.getElementById("contenido").scrollTo({ top: 0 });`);
      await esperar(1100);
      await foto(nombre);
    }
    await bajar(600);
    await foto("01e_inicio_categorias_detalle");
    await js(`elegirPestana(document.querySelector("#dashboard-contenido .tablero"), "resumen");`);
  }

  // Recordatorios (si la versión los incluye).
  const hayRecordatorios = await js(`return typeof abrirRecordatorios === "function";`);
  if (hayRecordatorios) {
    await js(`await abrirRecordatorios();`);
    await esperar(600);
    await foto("04_recordatorios");
    await js(`cerrarRecordatorios();`);
  }

  // Clientes y ficha.
  await js(`irA("clientes");`);
  await esperar(1000);
  await foto("05_clientes");
  if (esNova) {
    await js(`document.getElementById("vista-tarjetas").click();`);
    await esperar(900);
    await foto("05b_clientes_tarjetas");
    await js(`document.getElementById("vista-tabla").click();`);
  }
  await js(`
    const p = await Api.clientes({ orden: "prioridad", porPagina: 5 });
    if (typeof cargarRecordatorios === "function") await cargarRecordatorios();
    const conRecordatorio = typeof listaRecordatorios !== "undefined" ? listaRecordatorios.find((r) => r.estadoActual === "NO_CONTESTA") : null;
    abrirFicha(conRecordatorio ? conRecordatorio.clienteId : p.filas[2].id);`);
  await esperar(900);
  await foto("06_ficha_cliente");
  if (esNova) {
    await js(`elegirPestanaFicha("historial");`);
    await esperar(500);
    await foto("06b_ficha_historial");
    await js(`elegirPestanaFicha("gestion"); cerrarFicha(); abrirPaleta(); const t = document.getElementById("paleta-texto"); t.value = "ma"; t.dispatchEvent(new Event("input"));`);
    await esperar(900);
    await foto("06c_paleta");
    await js(`document.getElementById("paleta").close(); document.getElementById("btn-perfil").click();`);
    await esperar(400);
    await foto("06d_menu_perfil");
    await js(`cerrarMenuPerfil();`);
  }

  // Importación con filas inválidas (vista previa + panel de validación).
  const conErrores = csvConErrores();
  await js(`irA("importar"); await seleccionarArchivo({ nombre: "cartera_con_errores.csv", ruta: ${JSON.stringify(conErrores)} });`);
  await esperar(900);
  await foto("07_importar_validacion");
  await js(`document.querySelectorAll(".observaciones details")[1]?.setAttribute("open", "");`);
  await bajar(330);
  await foto("08_importar_validacion_detalle");

  // Cola de llamadas: detenida, llamando (con el último intento) y resultado.
  await js(`irA("cola");`);
  await esperar(700);
  await foto("09_cola_detenida");
  await js(`mostrarCola(await Api.colaIniciar());`);
  if (conMotivos) {
    await esperar(300);
    await js(`mostrarCola(await Api.colaFinalizar("rechazada"));`);
    await esperar(400);
    await foto("10_cola_llamando_motivos");
  }
  for (let i = 0; i < 30; i++) {
    await esperar(500);
    const p = await js(`return estadoCola ? estadoCola.proceso : "";`);
    if (p === "ESPERANDO_RESULTADO") break;
  }
  await bajar(0);
  await foto("11_cola_resultado");
  await bajar(520);
  await foto("12_cola_resultado_recordatorio");
  await js(`mostrarCola(await Api.colaDetener());`);

  // Teléfono: llamadas con motivo y la tarjeta de llamada manual en curso.
  await js(`irA("telefono");`);
  await esperar(900);
  if (conMotivos) {
    await js(`$input("movil-numero").value = "+56 9 5511 2233"; document.getElementById("form-llamada-manual").requestSubmit();`);
    await esperar(1800);
  }
  await foto("13_telefono_llamadas");

  // Vinculación: buscar teléfonos y escribir el código.
  if (conVinculo) {
    await js(`cerrarLlamadaManual(); document.getElementById("contenido").scrollTo({ top: 0 }); document.getElementById("btn-buscar-movil").click();`);
    await esperar(5000);
    await foto("13b_telefono_buscar");
    await js(`abrirCodigo("127.0.0.1", "Samsung Galaxy A54");
      const d = Array.from(document.querySelectorAll("#otp input"));
      "4829".split("").forEach((c, i) => { d[i].value = c; d[i].classList.add("lleno"); });
      d[4].focus();`);
    await esperar(400);
    await foto("13c_telefono_codigo");
    await js(`cerrarCodigo();`);
  }

  // Ficha completa: cartera con todas las columnas (scripts/generar-ejemplo-ficha.js).
  const completa = path.join(raiz, "ejemplos", "cartera_ficha_completa.xlsx");
  if (fs.existsSync(completa)) {
    await js(`cerrarLlamadaManual?.(); const r = await Api.importar(${JSON.stringify(completa)}, App.contexto.periodo.id); aplicarContexto(r.contexto); irA("clientes");`);
    await esperar(900);
    await js(`
      const p = await Api.clientes({ orden: "nombre", porPagina: 200 });
      const c = p.filas.find((f) => f.nombre === "CRISTÓBAL GUZMÁN ESPINOZA") ?? p.filas[0];
      abrirFicha(c.id);`);
    await esperar(1000);
    await foto("14_ficha_completa");
    await js(`document.getElementById("ficha").scrollTo({ top: 760 });`);
    await foto("15_ficha_completa_contacto");
  }
}

app.on("browser-window-created", (_e, win) => {
  win.webContents.once("did-finish-load", () => {
    ejecutar(win)
      .then(() => console.log(`Capturas en ${salida}`))
      .catch((e) => {
        console.error(e);
        process.exitCode = 1;
      })
      .finally(() => app.quit());
  });
});

app.on("quit", () => {
  try {
    fs.rmSync(datos, { recursive: true, force: true });
  } catch {
    /* la base puede seguir abierta un instante */
  }
});

require(path.join(raiz, "dist", "main.js"));
