/**
 * Pruebas de las reglas de negocio de CarteraX (base SQLite real, sin ventana).
 *
 * Ejecutar con:  npm run prueba
 * (corre con el Node de Electron, porque better-sqlite3 está compilado para él)
 *
 * Cubre: migraciones, login y bloqueo, importación por mes, aislamiento
 * entre ejecutivos, filtros y orden, reglas de gestión (compromiso, abono,
 * pago y reverso), cola de llamadas con el simulador, dashboard, reportes
 * mensuales congelados, cierre automático y exportaciones.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fork } = require("child_process");

const D = path.join(__dirname, "..", "dist");
const { obtenerConexion, cerrarConexion } = require(`${D}/db/conexion`);
const auth = require(`${D}/servicios/servicioAuth`);
const exportar = require(`${D}/servicios/servicioExportacion`);
const { crearRutas } = require(`${D}/ipc/rutas`);

const EJ = path.join(__dirname, "..", "ejemplos");
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "carterax-pruebas-"));
const rutaDb = path.join(carpeta, "prueba.db");

let ok = 0;
const fallas = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    ok++;
    console.log("  ✔", nombre);
  } catch (e) {
    fallas.push(nombre);
    console.log("  ✘", nombre, "→", e.message);
  }
}
async function lanza(fn, patron) {
  let error = null;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  assert.ok(error, "se esperaba un error");
  if (patron) assert.match(error.message, patron);
}

const plataforma = {
  version: "pruebas",
  elegirArchivoCartera: async () => null,
  elegirArchivoRespaldo: async () => null,
  guardarArchivo: async (nombre, _f, datos) => {
    const p = path.join(carpeta, nombre);
    fs.writeFileSync(p, datos);
    return p;
  },
  elegirDestinoRespaldo: async (n) => path.join(carpeta, n),
  generarPdf: async (html) => Buffer.from(html),
  mostrarEnCarpeta: () => {},
  restaurarYReiniciar: async () => {},
};

const mesActual = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();
const mesAnterior = (() => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();
const manana = (() => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = obtenerConexion(rutaDb);
  auth.asegurarUsuarioInicial(db);
  const { rutas } = crearRutas(() => db, plataforma);
  const r = (canal, ...a) => rutas[canal](...a);

  console.log("\nBase de datos y sesión");
  await prueba("las migraciones se pueden ejecutar dos veces", () => {
    require(`${D}/db/migraciones`).aplicarMigraciones(db);
    assert.strictEqual(db.pragma("user_version", { simple: true }), 4);
  });
  await prueba("sin sesión no se accede a la cartera (RF-01)", () => lanza(() => r("clientes:listar", {}), /sesión/));
  await prueba("credenciales incorrectas informan intentos restantes (RF-05)", () =>
    lanza(() => r("auth:login", "ejecutivo@carterax.cl", "mala"), /Te quedan 4/)
  );
  await prueba("el correo con formato inválido se rechaza", () => lanza(() => r("auth:login", "no-es-correo", "x"), /formato/));

  // Usuario aparte para probar el bloqueo sin afectar al resto.
  db.prepare("INSERT INTO usuarios (id, nombre, email, password_hash) VALUES ('u-bloqueo', 'B', 'bloqueo@x.cl', 'scrypt:00:00')").run();
  await prueba("tras 5 intentos fallidos la cuenta se bloquea", async () => {
    for (let i = 0; i < 4; i++) await lanza(() => r("auth:login", "bloqueo@x.cl", "x"));
    await lanza(() => r("auth:login", "bloqueo@x.cl", "x"), /bloqueada/);
    await lanza(() => r("auth:login", "bloqueo@x.cl", "x"), /bloqueada/);
  });

  const ctx = r("auth:login", "ejecutivo@carterax.cl", "CarteraX123!");
  await prueba("el login entrega el contexto con el mes actual", () => assert.strictEqual(ctx.periodo.id, mesActual));

  console.log("\nImportación por mes");
  let importado;
  await prueba("importa el Excel de ejemplo al mes indicado (RF-15)", () => {
    importado = r("importacion:ejecutar", path.join(EJ, "cartera_ejemplo.xlsx"), mesAnterior);
    assert.strictEqual(importado.resultado.periodoId, mesAnterior);
    assert.ok(importado.resultado.hojas.reduce((s, h) => s + h.cargados, 0) > 0);
  });
  await prueba("el mismo archivo no se importa dos veces en el mismo mes", () =>
    lanza(() => r("importacion:ejecutar", path.join(EJ, "cartera_ejemplo.xlsx"), mesAnterior), /ya fue importado/)
  );
  await prueba("el mismo archivo sí se puede cargar en otro mes", () => {
    r("importacion:ejecutar", path.join(EJ, "cartera_ejemplo.xlsx"), mesActual);
    r("importacion:ejecutar", path.join(EJ, "cartera_ejemplo_utf8.csv"), mesActual);
  });
  await prueba("los meses quedan separados", () => {
    r("contexto:cambiar-periodo", mesAnterior);
    const anterior = r("clientes:listar", {}).total;
    r("contexto:cambiar-periodo", mesActual);
    const actual = r("clientes:listar", {}).total;
    assert.ok(actual > anterior, `${actual} > ${anterior}`);
  });
  await prueba("la comuna se conserva aunque el archivo no traiga calle", () => {
    assert.ok(r("clientes:opciones").comunas.length > 0);
  });

  console.log("\nBúsqueda y filtros (RF-17)");
  const todos = r("clientes:listar", { porPagina: 500 });
  await prueba("filtro de deuda mínima y máxima", () => {
    const f = r("clientes:listar", { deudaMin: 1_000_000, deudaMax: 3_000_000, porPagina: 500 });
    assert.ok(f.filas.every((c) => c.deuda >= 1_000_000 && c.deuda <= 3_000_000));
    assert.strictEqual(f.total, todos.filas.filter((c) => c.deuda >= 1_000_000 && c.deuda <= 3_000_000).length);
  });
  await prueba("orden de menor a mayor deuda", () => {
    const d = r("clientes:listar", { orden: "deuda_asc", porPagina: 500 }).filas.map((c) => c.deuda);
    assert.deepStrictEqual(d, [...d].sort((a, b) => a - b));
  });
  await prueba("orden por prioridad descendente", () => {
    const p = r("clientes:listar", { orden: "prioridad", porPagina: 500 }).filas.map((c) => c.prioridad);
    assert.deepStrictEqual(p, [...p].sort((a, b) => b - a));
  });
  await prueba("búsqueda por RUT con puntos y guion", () => {
    const c = todos.filas[0];
    const conFormato = `${Number(c.rut).toLocaleString("es-CL")}-${c.dv}`;
    assert.ok(r("clientes:listar", { texto: conFormato }).filas.some((x) => x.id === c.id));
  });
  await prueba("búsqueda por nombre sin tildes", () => {
    assert.ok(r("clientes:listar", { texto: "munoz" }).total > 0);
  });
  await prueba("la prioridad no marca a toda la cartera como alta", () => {
    const altas = todos.filas.filter((c) => c.nivelPrioridad === "alta").length;
    assert.ok(altas < todos.total * 0.6, `${altas} de ${todos.total}`);
  });

  console.log("\nGestión del ejecutivo (RF-18)");
  const [a, b, c2, d] = r("clientes:listar", { estados: ["PENDIENTE", "NOTIFICADO", "NO_CONTESTA"], orden: "deuda_desc" }).filas;
  await prueba("sin estado ni comentario no se registra nada", () => lanza(() => r("clientes:gestionar", { clienteIds: [a.id] }), /comentario/));
  await prueba("compromiso exige fecha", () => lanza(() => r("clientes:gestionar", { clienteIds: [a.id], estado: "COMPROMISO" }), /fecha/));
  await prueba("compromiso no acepta fechas pasadas", () =>
    lanza(() => r("clientes:gestionar", { clienteIds: [a.id], estado: "COMPROMISO", fechaCompromiso: "2020-01-01" }), /anterior/)
  );
  await prueba("un comentario posterior conserva el compromiso", () => {
    r("clientes:gestionar", { clienteIds: [a.id], estado: "COMPROMISO", fechaCompromiso: manana, monto: 100000, comentario: "Paga mañana" });
    r("clientes:gestionar", { clienteIds: [a.id], comentario: "Confirmó por WhatsApp" });
    const f = r("clientes:detalle", a.id);
    assert.strictEqual(f.estado, "COMPROMISO");
    assert.strictEqual(f.fechaCompromiso, manana);
    assert.strictEqual(f.montoCompromiso, 100000);
    assert.strictEqual(f.ultimoComentario, "Confirmó por WhatsApp");
  });
  await prueba("abono exige monto y suma lo recuperado", async () => {
    await lanza(() => r("clientes:gestionar", { clienteIds: [b.id], estado: "ABONO" }), /monto/);
    r("clientes:gestionar", { clienteIds: [b.id], estado: "ABONO", monto: 250000 });
    assert.strictEqual(r("clientes:detalle", b.id).montoRecuperado, 250000);
  });
  await prueba("pagado sin monto registra el saldo pendiente", () => {
    r("clientes:gestionar", { clienteIds: [b.id], estado: "PAGADO" });
    const f = r("clientes:detalle", b.id);
    assert.strictEqual(f.montoRecuperado, f.deuda);
  });
  await prueba("salir de pagado revierte el pago", () => {
    r("clientes:gestionar", { clienteIds: [b.id], estado: "NO_PAGADO", comentario: "Se registró por error" });
    assert.strictEqual(r("clientes:detalle", b.id).montoRecuperado, 250000);
  });
  await prueba("el historial guarda cada gestión con su comentario (RF-33)", () => {
    const g = r("clientes:detalle", a.id).gestiones;
    assert.ok(g.some((x) => x.comentario === "Paga mañana" && x.estadoNuevo === "COMPROMISO"));
  });
  await prueba("cambio de estado masivo", () => {
    const res = r("clientes:gestionar", { clienteIds: [c2.id, d.id], estado: "NOTIFICADO", comentario: "Carta enviada" });
    assert.strictEqual(res.actualizados, 2);
  });

  console.log("\nRecordatorios de vuelta de gestión (v0.3.1)");
  const libres = r("clientes:listar", { conTelefono: "si", porPagina: 500 }).filas.filter((x) => ![a, b, c2, d].some((y) => y.id === x.id));
  const [e1, e2, e3, e4, e5] = libres;
  const pendientesDe = (id) => r("recordatorios:listar").filter((x) => x.clienteId === id);
  const ahoraLocal = (ms = 0) => {
    const f = new Date(Date.now() + ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${f.getFullYear()}-${p(f.getMonth() + 1)}-${p(f.getDate())}T${p(f.getHours())}:${p(f.getMinutes())}`;
  };
  await prueba("«No contesta» agenda volver a llamar en el futuro", () => {
    r("clientes:gestionar", { clienteIds: [e1.id], estado: "NO_CONTESTA" });
    const p = pendientesDe(e1.id);
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].motivo, "Volver a llamar");
    assert.ok(p[0].fechaHora > ahoraLocal(), p[0].fechaHora);
  });
  await prueba("el compromiso se recuerda el día comprometido", () => {
    r("clientes:gestionar", { clienteIds: [e2.id], estado: "COMPROMISO", fechaCompromiso: manana, monto: 5000 });
    assert.strictEqual(pendientesDe(e2.id)[0].fechaHora, `${manana}T17:00`);
  });
  await prueba("una gestión nueva cumple el recordatorio pendiente", () => {
    r("clientes:gestionar", { clienteIds: [e1.id], comentario: "Volvió a llamar él", recordatorio: null });
    assert.strictEqual(pendientesDe(e1.id).length, 0);
  });
  await prueba("los cambios masivos no agendan recordatorios solos", () => {
    r("clientes:gestionar", { clienteIds: [e3.id, e4.id], estado: "NOTIFICADO", comentario: "Carta" });
    assert.strictEqual(pendientesDe(e3.id).length + pendientesDe(e4.id).length, 0);
  });
  await prueba("un recordatorio vencido se avisa una sola vez", () => {
    r("clientes:gestionar", { clienteIds: [e3.id], comentario: "Llamar", recordatorio: { fechaHora: ahoraLocal(-60_000), motivo: "Prueba" } });
    assert.ok(r("recordatorios:avisar").some((x) => x.clienteId === e3.id));
    assert.ok(!r("recordatorios:avisar").some((x) => x.clienteId === e3.id));
  });
  await prueba("posponer vuelve a avisar a la nueva hora y «hecho» lo cierra", () => {
    const id = pendientesDe(e3.id)[0].id;
    r("recordatorios:posponer", id, ahoraLocal(-30_000));
    assert.ok(r("recordatorios:avisar").some((x) => x.id === id));
    r("recordatorios:resolver", id, "HECHO");
    assert.strictEqual(pendientesDe(e3.id).length, 0);
    assert.throws(() => r("recordatorios:resolver", id, "HECHO"), /ya no está pendiente/);
  });
  await prueba("una hora de recordatorio inválida se rechaza", () =>
    lanza(() => r("clientes:gestionar", { clienteIds: [e3.id], comentario: "x", recordatorio: { fechaHora: "mañana" } }), /no son válidas/)
  );
  await prueba("el dashboard incluye la agenda de seguimiento", () => {
    const ag = r("dashboard:obtener").agenda;
    assert.ok(ag.hoy + ag.proximos + ag.atrasados >= 1);
  });

  console.log("\nAislamiento entre ejecutivos (RF-16)");
  await prueba("otro ejecutivo no ve la cartera ajena", () => {
    db.prepare("INSERT INTO usuarios (id, nombre, email, password_hash) VALUES ('u-otro', 'Otro', 'otro@x.cl', ?)").run(
      db.prepare("SELECT password_hash FROM usuarios WHERE email = 'ejecutivo@carterax.cl'").get().password_hash
    );
    const sesionOtro = crearRutas(() => db, plataforma).rutas;
    sesionOtro["auth:login"]("otro@x.cl", "CarteraX123!");
    assert.strictEqual(sesionOtro["clientes:listar"]({}).total, 0);
    assert.throws(() => sesionOtro["clientes:detalle"](a.id), /no pertenece|No hay cartera/);
  });

  console.log("\nDashboard (RF-22)");
  await prueba("la deuda por estado suma la deuda total", () => {
    const dash = r("dashboard:obtener");
    const suma = dash.porEstado.reduce((s, e) => s + e.deuda, 0);
    assert.ok(Math.abs(suma - dash.kpis.deudaTotal) < 1);
    assert.ok(dash.kpis.recuperado >= 250000);
    assert.ok(dash.actividad.length >= 1);
  });

  console.log("\nCola de llamadas (RF-30 a RF-32)");
  const simulador = fork(path.join(__dirname, "..", "scripts", "simulador-movil.js"), ["--contesta=siempre", "--duracion=1", "--codigo=123456"], { silent: true });
  // El simulador corre con el Node de Electron: puede tardar en abrir el puerto.
  const simuladorListo = async () => {
    for (let i = 0; i < 40; i++) {
      if ((await r("movil:probar", "127.0.0.1")).conectado) return;
      await esperar(250);
    }
  };
  await simuladorListo();
  try {
    await prueba("sin vincular, el teléfono responde pero no acepta órdenes", async () => {
      const e = await r("movil:probar", "127.0.0.1");
      assert.strictEqual(e.conectado, true);
      assert.strictEqual(e.requiereVinculo, true);
      await lanza(() => r("movil:llamar", "+56911112222", null), /no está vinculado|Primero vincula/);
    });
    await prueba("buscar teléfonos encuentra el simulador", async () => {
      const lista = await r("movil:buscar");
      assert.ok(lista.some((m) => m.idEquipo === "sim000000001" && m.admiteVinculo));
    });
    await prueba("un código incorrecto no vincula", () => lanza(() => r("movil:vincular", "127.0.0.1", "000000"), /incorrecto/));
    await prueba("con el código correcto queda vinculado", async () => {
      const e = await r("movil:vincular", "127.0.0.1", "123456");
      assert.strictEqual(e.vinculado, true);
      assert.strictEqual(e.requiereVinculo, false);
      assert.strictEqual((await r("movil:probar")).vinculado, true);
    });
    await prueba("sin clientes en cola no se puede iniciar", async () => {
      await r("movil:probar");
      await lanza(() => r("cola:iniciar"), /En cola/);
    });
    await prueba("enviar a la cola reactiva los teléfonos", () => {
      r("clientes:gestionar", { clienteIds: [c2.id], estado: "EN_COLA" });
      const f = r("clientes:detalle", c2.id);
      assert.ok(f.telefonos.filter((t) => t.valido).every((t) => t.estadoLlamada === "PENDIENTE"));
    });
    await prueba("si contesta, la cola espera el resultado del ejecutivo", async () => {
      let e = await r("cola:iniciar");
      assert.strictEqual(e.actual.clienteId, c2.id);
      for (let i = 0; i < 20 && e.proceso !== "ESPERANDO_RESULTADO"; i++) {
        await esperar(400);
        e = await r("cola:actualizar");
      }
      assert.strictEqual(e.proceso, "ESPERANDO_RESULTADO");
    });
    await prueba("el resultado no puede ser «En cola»", () => lanza(() => r("cola:registrar-resultado", { estado: "EN_COLA" }), /distinto/));
    await prueba("registrar el resultado guarda la gestión y termina la cola", async () => {
      const e = await r("cola:registrar-resultado", { estado: "CONTACTADO", comentario: "Llamar el viernes" });
      assert.strictEqual(e.proceso, "FINALIZADA");
      const f = r("clientes:detalle", c2.id);
      assert.strictEqual(f.estado, "CONTACTADO");
      assert.ok(f.gestiones.some((g) => g.tipo === "llamada" && g.resultado === "contestada"));
    });
    await prueba("la llamada contestada guarda sus segundos y su motivo", () => {
      const g = r("clientes:detalle", c2.id).gestiones.find((x) => x.tipo === "llamada" && x.resultado === "contestada");
      assert.ok(g.duracion >= 1, `duración ${g.duracion}`);
      assert.strictEqual(g.motivoLlamada, "contestada");
    });
    await prueba("detener la cola con una llamada en curso la deja «cortada»", async () => {
      r("clientes:gestionar", { clienteIds: [e5.id], estado: "EN_COLA" });
      await r("cola:iniciar");
      r("cola:detener");
      const l = r("movil:llamadas")[0];
      assert.strictEqual(l.resultado, "cortada");
      assert.strictEqual(l.motivo_llamada, "cortada");
    });
    await prueba("una llamada se puede corregir después con sus minutos", () => {
      const l = r("movil:llamadas")[0];
      r("movil:corregir-llamada", l.id, "contestada", 125);
      const c = r("movil:llamadas").find((x) => x.id === l.id);
      assert.strictEqual(c.resultado, "contestada");
      assert.strictEqual(c.duracion, 125);
      assert.throws(() => r("movil:corregir-llamada", l.id, "volando"), /no válido/);
    });
  } finally {
    simulador.kill();
  }

  console.log("\nCola sin registro de llamadas: minutos y motivos (v0.3.1)");
  await esperar(300);
  const simSinRegistro = fork(path.join(__dirname, "..", "scripts", "simulador-movil.js"), ["--contesta=siempre", "--duracion=1", "--sin-registro", "--codigo=654321"], { silent: true });
  await esperar(400);
  await simuladorListo();
  await r("movil:vincular", "127.0.0.1", "654321");
  const esperarFin = async () => {
    let e = await r("cola:actualizar");
    for (let i = 0; i < 25 && !e.terminoSinDatos && e.proceso !== "FINALIZADA"; i++) {
      await esperar(300);
      e = await r("cola:actualizar");
    }
    return e;
  };
  try {
    await prueba("si el teléfono no sabe si contestaron, la cola pregunta", async () => {
      r("clientes:gestionar", { clienteIds: [e5.id], estado: "EN_COLA" });
      await r("cola:iniciar");
      const e = await esperarFin();
      assert.strictEqual(e.terminoSinDatos, true);
      assert.notStrictEqual(e.proceso, "ESPERANDO_RESULTADO");
    });
    await prueba("«Contestó» a mano registra minutos aproximados y se pueden ajustar", async () => {
      const e = await r("cola:finalizar-llamada", "contestada");
      assert.strictEqual(e.proceso, "ESPERANDO_RESULTADO");
      assert.ok(r("movil:llamadas")[0].duracion > 0);
      await r("cola:registrar-resultado", { estado: "CONTACTADO", comentario: "Habló", duracion: 95 });
      const l = r("movil:llamadas").find((x) => x.cliente_id === e5.id && x.resultado === "contestada" && x.duracion === 95);
      assert.ok(l, "la duración ajustada quedó guardada");
    });
    await prueba("número inexistente: sale de la cola y el cliente queda Inubicable", async () => {
      r("clientes:gestionar", { clienteIds: [e4.id], estado: "EN_COLA" });
      let e = await r("cola:iniciar");
      for (let i = 0; i < 6 && e.proceso !== "FINALIZADA"; i++) {
        e = await esperarFin();
        if (e.terminoSinDatos) e = await r("cola:finalizar-llamada", "inexistente");
      }
      const f = r("clientes:detalle", e4.id);
      assert.strictEqual(f.estado, "INUBICABLE");
      assert.ok(f.telefonos.every((t) => !t.valido));
    });
    await prueba("el motivo del último intento se corrige sin detener la cola", async () => {
      r("clientes:gestionar", { clienteIds: [e2.id], estado: "EN_COLA" });
      await r("cola:iniciar");
      await esperarFin();
      let e = await r("cola:finalizar-llamada", "no_contesta");
      e = await r("cola:corregir-intento", "apagado");
      assert.strictEqual(e.ultimoIntento.motivo, "apagado");
      assert.ok(r("movil:llamadas").some((x) => x.id === e.ultimoIntento.gestionId && x.motivo_llamada === "apagado"));
      r("cola:detener");
    });
    await prueba("el dashboard resume las llamadas por motivo y tiempo hablado", () => {
      const ll = r("dashboard:obtener").llamadas;
      assert.ok(ll.total >= 4);
      assert.ok(ll.segundosHablados >= 95 + 125);
      assert.ok((ll.porMotivo.inexistente ?? 0) >= 1);
      assert.ok((ll.porMotivo.apagado ?? 0) >= 1);
    });
  } finally {
    simSinRegistro.kill();
  }

  console.log("\nCortes rápidos, teléfono sin señal y versión anterior (v0.4)");
  await esperar(300);
  const simRapido = fork(path.join(__dirname, "..", "scripts", "simulador-movil.js"), ["--contesta=rapido", "--codigo=111111"], { silent: true });
  await esperar(400);
  await simuladorListo();
  await r("movil:vincular", "127.0.0.1", "111111");
  const llamarHastaTerminar = async (clienteId) => {
    r("clientes:gestionar", { clienteIds: [clienteId], estado: "EN_COLA" });
    let e = await r("cola:iniciar");
    for (let i = 0; i < 40 && e.activa && e.actual && e.actual.clienteId === clienteId; i++) {
      await esperar(300);
      e = await r("cola:actualizar");
    }
    r("cola:detener");
    return e;
  };
  try {
    await prueba("una llamada que se corta en segundos queda como «apagado» (detectado)", async () => {
      await llamarHastaTerminar(e3.id);
      const l = r("movil:llamadas").find((x) => x.cliente_id === e3.id && x.motivo_llamada === "apagado");
      assert.ok(l, "quedó como apagado");
      assert.match(l.texto_libre, /detección automática/);
    });
    await prueba("al tercer corte rápido el número se descarta («no existe»)", async () => {
      const antes = r("clientes:detalle", e3.id).telefonos.find((t) => t.valido);
      for (let i = 0; i < 4; i++) {
        const t = r("clientes:detalle", e3.id).telefonos.find((x) => x.numero === antes.numero);
        if (!t.valido) break;
        await llamarHastaTerminar(e3.id);
      }
      const t = r("clientes:detalle", e3.id).telefonos.find((x) => x.numero === antes.numero);
      assert.strictEqual(t.valido, false);
      assert.ok(r("movil:llamadas").some((x) => x.motivo_llamada === "inexistente" && /detección automática/.test(x.texto_libre)));
    });
  } finally {
    simRapido.kill();
  }

  await esperar(300);
  const simSinSenal = fork(path.join(__dirname, "..", "scripts", "simulador-movil.js"), ["--no-marca", "--codigo=222222"], { silent: true });
  await esperar(400);
  await simuladorListo();
  await r("movil:vincular", "127.0.0.1", "222222");
  try {
    await prueba("si el teléfono no puede marcar, la cola se pausa y el número sigue pendiente", async () => {
      r("clientes:gestionar", { clienteIds: [e2.id], estado: "EN_COLA" });
      let e = await r("cola:iniciar");
      for (let i = 0; i < 20 && e.proceso !== "ERROR"; i++) {
        await esperar(300);
        e = await r("cola:actualizar");
      }
      assert.strictEqual(e.proceso, "ERROR");
      assert.match(e.mensaje, /no pudo marcar/);
      const f = r("clientes:detalle", e2.id);
      assert.ok(f.telefonos.some((t) => t.valido && t.estadoLlamada === "PENDIENTE"));
      r("cola:detener");
    });
  } finally {
    simSinSenal.kill();
  }

  await esperar(300);
  const simAnterior = fork(path.join(__dirname, "..", "scripts", "simulador-movil.js"), ["--sin-vinculo", "--contesta=siempre", "--duracion=1"], { silent: true });
  await esperar(400);
  await simuladorListo();
  try {
    await prueba("Phoenix Mobile 0.3 (sin código) se sigue conectando por IP", async () => {
      const e = await r("movil:probar", "127.0.0.1");
      assert.strictEqual(e.conectado, true);
      assert.ok(!e.requiereVinculo);
      const l = await r("movil:llamar", "+56933334444", null);
      assert.ok(l.gestionId);
      r("movil:descartar-seguimiento");
    });
  } finally {
    simAnterior.kill();
  }

  console.log("\nReportes mensuales (RF-25)");
  let reporte;
  await prueba("guardar un reporte del mes", () => {
    reporte = r("reportes:generar", "Corte de prueba", "nota");
    assert.strictEqual(reporte.periodoId, mesActual);
  });
  await prueba("el reporte queda congelado aunque la cartera cambie", () => {
    const antes = r("reportes:obtener", reporte.id).dashboard.kpis.recuperado;
    r("clientes:gestionar", { clienteIds: [d.id], estado: "PAGADO" });
    assert.strictEqual(r("reportes:obtener", reporte.id).dashboard.kpis.recuperado, antes);
    assert.ok(r("dashboard:obtener").kpis.recuperado > antes);
  });
  await prueba("al iniciar sesión se genera el cierre de los meses terminados, una sola vez", () => {
    r("auth:logout");
    const c1 = r("auth:login", "ejecutivo@carterax.cl", "CarteraX123!");
    assert.strictEqual(c1.cierresGenerados, 1);
    r("auth:logout");
    const c3 = r("auth:login", "ejecutivo@carterax.cl", "CarteraX123!");
    assert.strictEqual(c3.cierresGenerados, 0);
    assert.ok(r("reportes:listar").some((x) => x.periodoId === mesAnterior && x.automatico));
  });
  await prueba("descarga en Excel, PDF y CSV", async () => {
    const x = await r("reportes:descargar", reporte.id, "xlsx");
    assert.strictEqual(fs.readFileSync(x.ruta).subarray(0, 2).toString(), "PK");
    const p = await r("reportes:descargar", reporte.id, "pdf");
    assert.match(fs.readFileSync(p.ruta, "utf-8"), /Corte de prueba/);
    const c = await r("reportes:descargar", reporte.id, "csv");
    assert.match(fs.readFileSync(c.ruta, "utf-8"), /RUT;Nombre;Estado/);
  });
  await prueba("exportar el listado filtrado de clientes", async () => {
    const x = await r("clientes:exportar", { estados: ["PAGADO"] }, "xlsx");
    assert.ok(fs.statSync(x.ruta).size > 1000);
  });
  await prueba("eliminar un reporte", () => {
    r("reportes:eliminar", reporte.id);
    assert.ok(!r("reportes:listar").some((x) => x.id === reporte.id));
  });

  console.log("\nConfiguración y respaldo");
  await prueba("valida la configuración", () => lanza(() => r("config:guardar", { diasSinGestion: 0 }), /entre/));
  await prueba("la contraseña nueva debe combinar letras y números", () =>
    lanza(() => r("auth:cambiar-password", "CarteraX123!", "soloLetras"), /letras y números/)
  );
  await prueba("crear un respaldo de la base", async () => {
    const res = await r("respaldo:crear");
    assert.ok(fs.statSync(res.ruta).size > 0);
  });
  void exportar;

  cerrarConexion();
  fs.rmSync(carpeta, { recursive: true, force: true });
  console.log(`\n${ok} pruebas correctas, ${fallas.length} con fallas.`);
  process.exit(fallas.length ? 1 : 0);
})();
