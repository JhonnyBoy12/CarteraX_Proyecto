/**
 * @file rutas.ts
 * @description Tabla de canales IPC → servicios. NO importa Electron: las
 * operaciones que dependen del sistema (diálogos, PDF, reinicio) llegan por
 * la interfaz {@link Plataforma}. Así toda la lógica de canales se puede
 * probar con Node sin abrir una ventana.
 *
 * Toda operación sobre la cartera exige sesión iniciada (RF-01) y trabaja
 * sobre el ejecutivo y el mes de esa sesión (RF-16, RNF-05).
 *
 * @since 0.3.0
 */
import Database from "better-sqlite3";
import * as path from "path";

import * as auth from "../servicios/servicioAuth";
import * as cartera from "../servicios/servicioCartera";
import * as cola from "../servicios/servicioColaLlamadas";
import * as config from "../servicios/servicioConfiguracion";
import * as dashboard from "../servicios/servicioDashboard";
import * as exportar from "../servicios/servicioExportacion";
import * as movil from "../servicios/servicioMovil";
import * as periodos from "../servicios/servicioPeriodos";
import * as recordatorios from "../servicios/servicioRecordatorios";
import * as reportes from "../servicios/servicioReportes";
import { importarArchivo } from "../importacion/importador";
import { observacionesArchivo, previsualizarArchivo } from "../importacion/previsualizador";
import { fechaLocal } from "../servicios/fechas";

/** Operaciones que dependen del sistema operativo / Electron. */
export interface Plataforma {
  version: string;
  elegirArchivoCartera(): Promise<string | null>;
  elegirArchivoRespaldo(): Promise<string | null>;
  /** Pide dónde guardar y escribe. Devuelve la ruta o `null` si se canceló. */
  guardarArchivo(nombreSugerido: string, filtros: Array<{ name: string; extensions: string[] }>, datos: Buffer): Promise<string | null>;
  /** Pide dónde guardar un respaldo y devuelve la ruta elegida. */
  elegirDestinoRespaldo(nombreSugerido: string): Promise<string | null>;
  generarPdf(html: string): Promise<Buffer>;
  mostrarEnCarpeta(ruta: string): void;
  /** Reemplaza la base por el respaldo y reinicia la app. */
  restaurarYReiniciar(rutaRespaldo: string): Promise<void>;
}

interface Sesion {
  usuario: Phoenix.UsuarioSesion;
  periodoId: string;
  registroId: string;
}

type Manejador = (...args: any[]) => unknown;

/** Nombre de archivo seguro a partir de un texto. */
function nombreArchivo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Crea la tabla de manejadores.
 * @param obtenerDb Devuelve la conexión SQLite abierta.
 * @param plataforma Operaciones de sistema (implementadas en manejadoresIpc.ts).
 */
export function crearRutas(obtenerDb: () => Database.Database, plataforma: Plataforma) {
  let sesion: Sesion | null = null;

  const exigirSesion = (): Sesion => {
    if (!sesion) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    return sesion;
  };
  const ctx = (): periodos.Contexto => {
    const s = exigirSesion();
    return { usuarioId: s.usuario.id, periodoId: s.periodoId };
  };
  const contexto = (): Phoenix.Contexto => {
    const s = exigirSesion();
    const db = obtenerDb();
    return {
      usuario: s.usuario,
      periodo: periodos.obtenerPeriodo(db, s.usuario.id, s.periodoId),
      periodos: periodos.listarPeriodos(db, s.usuario.id),
      version: plataforma.version,
    };
  };
  const cerrarSesion = (motivo: string) => {
    if (!sesion) return;
    cola.detenerCola(obtenerDb(), null);
    movil.descartarSeguimiento();
    auth.registrarFinSesion(obtenerDb(), sesion.registroId, motivo);
    sesion = null;
  };

  const rutas: Record<string, Manejador> = {
    // ------------------------------ Sesión ------------------------------
    "auth:login": (email: string, password: string) => {
      const db = obtenerDb();
      const usuario = auth.iniciarSesion(db, email, password);
      cerrarSesion("nuevo inicio");
      auth.adoptarCarterasLegado(db, usuario.id);
      const generados = reportes.generarCierresPendientes(db, usuario.id);
      sesion = { usuario, periodoId: periodos.periodoPorDefecto(db, usuario.id), registroId: auth.registrarInicioSesion(db, usuario.id) };
      return { ...contexto(), cierresGenerados: generados.length };
    },
    "auth:sesion": () => (sesion ? contexto() : null),
    "auth:logout": (motivo?: string) => {
      cerrarSesion(motivo === "inactividad" ? "inactividad" : "manual");
      return true;
    },
    "auth:cambiar-password": (actual: string, nueva: string) => {
      auth.cambiarPassword(obtenerDb(), exigirSesion().usuario.id, actual, nueva);
      return true;
    },

    // ----------------------------- Contexto -----------------------------
    "contexto:obtener": () => contexto(),
    "contexto:cambiar-periodo": (periodoId: string) => {
      const s = exigirSesion();
      if (!periodos.esIdPeriodo(periodoId)) throw new Error("Mes inválido.");
      cola.detenerCola(obtenerDb(), null);
      s.periodoId = periodoId;
      return contexto();
    },
    "catalogo:estados": () => cartera.catalogoEstados(),

    // ---------------------------- Importación ----------------------------
    "importacion:elegir": () => plataforma.elegirArchivoCartera(),
    "importacion:previsualizar": (ruta: string) => previsualizarArchivo(ruta),
    "importacion:ejecutar": (ruta: string, periodoId?: string) => {
      const s = exigirSesion();
      const destino = periodos.esIdPeriodo(periodoId) ? periodoId : s.periodoId;
      const r = importarArchivo(obtenerDb(), ruta, { usuarioId: s.usuario.id, periodoId: destino });
      s.periodoId = destino; // tras importar se trabaja sobre ese mes
      return { resultado: r, contexto: contexto() };
    },
    "importacion:historial": () => cartera.historialImportaciones(obtenerDb(), exigirSesion().usuario.id),
    "importacion:exportar-observaciones": async (ruta: string) => {
      exigirSesion();
      const base = nombreArchivo(path.basename(String(ruta ?? ""), path.extname(String(ruta ?? "")))) || "Cartera";
      const destino = await plataforma.guardarArchivo(
        `Observaciones_${base}_${fechaLocal()}.xlsx`,
        [{ name: "Excel", extensions: ["xlsx"] }],
        exportar.archivoObservaciones(observacionesArchivo(ruta))
      );
      return destino ? { ruta: destino } : null;
    },

    // ------------------------------ Clientes ------------------------------
    "clientes:listar": (filtro: Phoenix.FiltroClientes) =>
      cartera.listarClientes(obtenerDb(), ctx(), filtro ?? {}, config.leerConfigApp(obtenerDb()).diasSinGestion),
    "clientes:opciones": () => cartera.opcionesFiltro(obtenerDb(), ctx()),
    "clientes:detalle": (clienteId: string) => cartera.detalleCliente(obtenerDb(), ctx(), clienteId),
    "clientes:gestionar": (solicitud: Phoenix.SolicitudGestion) => cartera.registrarGestion(obtenerDb(), ctx(), solicitud),
    "clientes:telefono": (telefonoId: string, valido: boolean) => {
      cartera.marcarTelefono(obtenerDb(), ctx(), telefonoId, Boolean(valido));
      return true;
    },
    "clientes:exportar": async (filtro: Phoenix.FiltroClientes, formato: "xlsx" | "csv") => {
      const db = obtenerDb();
      const c = ctx();
      const todos = cartera.listarClientes(db, c, { ...(filtro ?? {}), pagina: 1, porPagina: 500 }, config.leerConfigApp(db).diasSinGestion);
      const ids = new Set(todos.idsFiltrados);
      const filas = cartera.leerCartera(db, c).filter((f) => ids.has(f.id));
      const orden = new Map(todos.idsFiltrados.map((id, i) => [id, i]));
      filas.sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0));
      const ext = formato === "csv" ? "csv" : "xlsx";
      const ruta = await plataforma.guardarArchivo(
        `Clientes_${nombreArchivo(periodos.nombrePeriodo(c.periodoId))}_${fechaLocal()}.${ext}`,
        [{ name: ext === "csv" ? "CSV" : "Excel", extensions: [ext] }],
        exportar.archivoClientes(filas, ext)
      );
      return ruta ? { ruta } : null;
    },

    // ----------------------------- Dashboard -----------------------------
    "dashboard:obtener": () => dashboard.obtenerDashboard(obtenerDb(), ctx()),

    // ------------------------------ Reportes ------------------------------
    "reportes:listar": () => reportes.listarReportes(obtenerDb(), exigirSesion().usuario.id),
    "reportes:generar": (titulo?: string, notas?: string) => reportes.generarReporte(obtenerDb(), ctx(), { titulo, notas }),
    "reportes:obtener": (id: string) => reportes.obtenerReporte(obtenerDb(), exigirSesion().usuario.id, id),
    "reportes:eliminar": (id: string) => {
      reportes.eliminarReporte(obtenerDb(), exigirSesion().usuario.id, id);
      return true;
    },
    "reportes:descargar": async (id: string, formato: Phoenix.FormatoDescarga) => {
      const s = exigirSesion();
      const r = reportes.obtenerReporte(obtenerDb(), s.usuario.id, id);
      const base = nombreArchivo(`${r.titulo} ${fechaLocal()}`) || "Reporte";
      let ruta: string | null;
      if (formato === "pdf") {
        const pdf = await plataforma.generarPdf(exportar.htmlReporte(r, `${s.usuario.nombre} ${s.usuario.apellido}`.trim()));
        ruta = await plataforma.guardarArchivo(`${base}.pdf`, [{ name: "PDF", extensions: ["pdf"] }], pdf);
      } else if (formato === "csv") {
        const csv = exportar.archivoClientesReporte(r.clientesDetalle, "csv");
        ruta = await plataforma.guardarArchivo(`${base}.csv`, [{ name: "CSV", extensions: ["csv"] }], csv);
      } else {
        ruta = await plataforma.guardarArchivo(`${base}.xlsx`, [{ name: "Excel", extensions: ["xlsx"] }], exportar.excelReporte(r));
      }
      return ruta ? { ruta } : null;
    },

    // --------------------------- Phoenix Mobile ---------------------------
    "movil:obtener": () => ({ ip: movil.obtenerIpMovil(obtenerDb()) }),
    "movil:probar": (ip?: string) => movil.probarMovil(obtenerDb(), ip),
    // Con la cola en marcha el teléfono lo sigue la cola: llamada simple, como en v0.3.0.
    "movil:llamar": (numero: string, clienteId?: string | null) =>
      cola.colaActiva()
        ? movil.llamar(obtenerDb(), ctx(), numero, clienteId ?? null)
        : movil.llamarManual(obtenerDb(), ctx(), numero, clienteId ?? null),
    "movil:llamadas": () => movil.obtenerLlamadas(obtenerDb(), ctx()),
    "movil:seguimiento": () => {
      exigirSesion();
      return movil.seguirLlamadaManual(obtenerDb());
    },
    "movil:terminar-llamada": (motivo: Phoenix.MotivoLlamada, duracion?: number | null) => {
      exigirSesion();
      return movil.terminarLlamadaManual(obtenerDb(), motivo, duracion ?? null);
    },
    "movil:descartar-seguimiento": () => {
      movil.descartarSeguimiento();
      return true;
    },
    "movil:corregir-llamada": (gestionId: string, motivo: Phoenix.MotivoLlamada, duracion?: number | null) => {
      if (cola.esLlamadaEnCurso(gestionId)) throw new Error("Esa llamada sigue en curso en la cola.");
      movil.corregirLlamada(obtenerDb(), ctx(), gestionId, motivo, duracion);
      return true;
    },

    // ------------------------------- Cola -------------------------------
    "cola:estado": () => cola.obtenerEstadoCola(obtenerDb(), ctx()),
    "cola:iniciar": () => cola.iniciarCola(obtenerDb(), ctx()),
    "cola:actualizar": () => cola.actualizarCola(obtenerDb(), ctx()),
    "cola:pausar": () => cola.pausarCola(obtenerDb(), ctx()),
    "cola:reanudar": () => cola.reanudarCola(obtenerDb(), ctx()),
    "cola:detener": () => cola.detenerCola(obtenerDb(), ctx()),
    "cola:saltar": () => cola.saltarCliente(obtenerDb(), ctx()),
    // Acepta el booleano de v0.3.0 (contestó / no contestó) o un motivo.
    "cola:finalizar-llamada": (resultado: boolean | Phoenix.MotivoLlamada) =>
      cola.finalizarLlamada(
        obtenerDb(),
        ctx(),
        typeof resultado === "boolean" ? (resultado ? "contestada" : "no_contesta") : resultado,
        null
      ),
    "cola:corregir-intento": (motivo: Phoenix.MotivoLlamada) => cola.corregirUltimoIntento(obtenerDb(), ctx(), motivo),
    "cola:registrar-resultado": (resultado: Phoenix.ResultadoCola) => cola.registrarResultado(obtenerDb(), ctx(), resultado),

    // ---------------------------- Recordatorios ----------------------------
    "recordatorios:listar": () => recordatorios.listarRecordatorios(obtenerDb(), ctx()),
    "recordatorios:avisar": () => recordatorios.recordatoriosPorAvisar(obtenerDb(), ctx()),
    "recordatorios:posponer": (id: string, fechaHora: string) => {
      recordatorios.posponerRecordatorio(obtenerDb(), ctx(), id, fechaHora);
      return true;
    },
    "recordatorios:resolver": (id: string, estado: "HECHO" | "DESCARTADO") => {
      recordatorios.resolverRecordatorio(obtenerDb(), ctx(), id, estado);
      return true;
    },

    // --------------------------- Configuración ---------------------------
    "config:obtener": () => config.leerConfigApp(obtenerDb()),
    "config:guardar": (cambios: Partial<Phoenix.ConfigApp>) => {
      exigirSesion();
      return config.guardarConfigApp(obtenerDb(), cambios ?? {});
    },

    // ------------------------------ Respaldo ------------------------------
    "respaldo:crear": async () => {
      exigirSesion();
      const destino = await plataforma.elegirDestinoRespaldo(`CarteraX_respaldo_${fechaLocal()}.db`);
      if (!destino) return null;
      await obtenerDb().backup(destino);
      return { ruta: destino };
    },
    "respaldo:restaurar": async () => {
      exigirSesion();
      const origen = await plataforma.elegirArchivoRespaldo();
      if (!origen) return null;
      const prueba = new Database(origen, { readonly: true, fileMustExist: true });
      try {
        const tablas = prueba.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
        const nombres = new Set(tablas.map((t) => t.name));
        if (!["usuarios", "clientes", "carteras", "cartera_clientes"].every((t) => nombres.has(t))) {
          throw new Error("El archivo no es un respaldo de CarteraX.");
        }
      } finally {
        prueba.close();
      }
      cerrarSesion("restauración de respaldo");
      await plataforma.restaurarYReiniciar(origen);
      return true;
    },

    // ------------------------------ Sistema ------------------------------
    "sistema:mostrar-archivo": (ruta: string) => {
      if (typeof ruta !== "string" || !path.isAbsolute(ruta)) throw new Error("Ruta inválida.");
      plataforma.mostrarEnCarpeta(ruta);
      return true;
    },
  };

  return {
    rutas,
    /** Cierra la sesión activa (al salir de la app). */
    cerrarSesion,
  };
}
