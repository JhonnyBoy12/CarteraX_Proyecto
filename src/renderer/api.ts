/**
 * @file api.ts (renderer)
 * @description Acceso tipado al backend. Cada método invoca un canal IPC
 * (ver `ipc/rutas.ts`) a través de `window.phoenixAPI.invocar` y lanza
 * `Error` si el backend responde `{ ok: false }`.
 *
 * Es un *script* global (sin import/export): lo comparten todas las vistas.
 */

interface PuenteIpc {
  invocar(canal: string, ...args: unknown[]): Promise<Phoenix.Respuesta<unknown>>;
  rutaDeArchivo(archivo: File): string;
}

const puente = (window as unknown as { phoenixAPI?: PuenteIpc }).phoenixAPI;

/** Se dispara cuando el backend informa que la sesión expiró. */
let alExpirarSesion: (() => void) | null = null;

async function invocar<T>(canal: string, ...args: unknown[]): Promise<T> {
  if (!puente) throw new Error("La interfaz debe abrirse desde la aplicación de escritorio CarteraX.");
  const r = await puente.invocar(canal, ...args);
  if (!r.ok) {
    if (r.error?.startsWith("Tu sesión expiró")) alExpirarSesion?.();
    throw new Error(r.error ?? "Error desconocido");
  }
  return r.datos as T;
}

type ContextoLogin = Phoenix.Contexto & { cierresGenerados: number };

const Api = {
  // Sesión
  login: (email: string, password: string) => invocar<ContextoLogin>("auth:login", email, password),
  sesion: () => invocar<Phoenix.Contexto | null>("auth:sesion"),
  logout: (motivo?: "inactividad") => invocar<boolean>("auth:logout", motivo),
  cambiarPassword: (actual: string, nueva: string) => invocar<boolean>("auth:cambiar-password", actual, nueva),

  // Contexto
  contexto: () => invocar<Phoenix.Contexto>("contexto:obtener"),
  cambiarPeriodo: (id: string) => invocar<Phoenix.Contexto>("contexto:cambiar-periodo", id),
  estados: () => invocar<Phoenix.EstadoCobranza[]>("catalogo:estados"),

  // Importación
  elegirArchivo: () => invocar<string | null>("importacion:elegir"),
  rutaDeArchivo: (f: File) => (puente ? puente.rutaDeArchivo(f) : ""),
  previsualizar: (ruta: string) => invocar<Phoenix.PreviaArchivo>("importacion:previsualizar", ruta),
  importar: (ruta: string, periodoId: string) =>
    invocar<{ resultado: Phoenix.ResultadoImportacion; contexto: Phoenix.Contexto }>("importacion:ejecutar", ruta, periodoId),
  historialImportaciones: () => invocar<Phoenix.ImportacionHistorial[]>("importacion:historial"),
  exportarObservaciones: (ruta: string) => invocar<Phoenix.ArchivoGuardado | null>("importacion:exportar-observaciones", ruta),

  // Clientes
  clientes: (f: Phoenix.FiltroClientes) => invocar<Phoenix.PaginaClientes>("clientes:listar", f),
  opcionesFiltro: () => invocar<Phoenix.OpcionesFiltro>("clientes:opciones"),
  detalle: (id: string) => invocar<Phoenix.DetalleCliente>("clientes:detalle", id),
  gestionar: (s: Phoenix.SolicitudGestion) => invocar<Phoenix.ResultadoGestion>("clientes:gestionar", s),
  marcarTelefono: (id: string, valido: boolean) => invocar<boolean>("clientes:telefono", id, valido),
  exportarClientes: (f: Phoenix.FiltroClientes, formato: "xlsx" | "csv") =>
    invocar<Phoenix.ArchivoGuardado | null>("clientes:exportar", f, formato),

  // Dashboard y reportes
  dashboard: () => invocar<Phoenix.Dashboard>("dashboard:obtener"),
  reportes: () => invocar<Phoenix.ReporteResumen[]>("reportes:listar"),
  generarReporte: (titulo: string, notas: string) => invocar<Phoenix.ReporteResumen>("reportes:generar", titulo, notas),
  reporte: (id: string) => invocar<Phoenix.ReporteDetalle>("reportes:obtener", id),
  eliminarReporte: (id: string) => invocar<boolean>("reportes:eliminar", id),
  descargarReporte: (id: string, formato: Phoenix.FormatoDescarga) =>
    invocar<Phoenix.ArchivoGuardado | null>("reportes:descargar", id, formato),

  // Teléfono
  movil: () => invocar<{ ip: string | null }>("movil:obtener"),
  probarMovil: (ip?: string) => invocar<Phoenix.EstadoMovil>("movil:probar", ip),
  llamar: (numero: string, clienteId?: string | null) =>
    invocar<Phoenix.ResultadoLlamada & { seguimiento?: Phoenix.SeguimientoLlamada | null }>("movil:llamar", numero, clienteId ?? null),
  llamadas: () => invocar<Phoenix.LlamadaRegistrada[]>("movil:llamadas"),
  seguimientoLlamada: () => invocar<Phoenix.SeguimientoLlamada | null>("movil:seguimiento"),
  terminarLlamada: (motivo: Phoenix.MotivoLlamada, duracion: number | null) =>
    invocar<Phoenix.SeguimientoLlamada | null>("movil:terminar-llamada", motivo, duracion),
  descartarSeguimiento: () => invocar<boolean>("movil:descartar-seguimiento"),
  corregirLlamada: (id: string, motivo: Phoenix.MotivoLlamada, duracion?: number | null) =>
    invocar<boolean>("movil:corregir-llamada", id, motivo, duracion),

  // Recordatorios
  recordatorios: () => invocar<Phoenix.Recordatorio[]>("recordatorios:listar"),
  recordatoriosAvisar: () => invocar<Phoenix.Recordatorio[]>("recordatorios:avisar"),
  posponerRecordatorio: (id: string, fechaHora: string) => invocar<boolean>("recordatorios:posponer", id, fechaHora),
  resolverRecordatorio: (id: string, estado: "HECHO" | "DESCARTADO") => invocar<boolean>("recordatorios:resolver", id, estado),

  // Cola
  cola: () => invocar<Phoenix.EstadoColaLlamadas>("cola:estado"),
  colaIniciar: () => invocar<Phoenix.EstadoColaLlamadas>("cola:iniciar"),
  colaActualizar: () => invocar<Phoenix.EstadoColaLlamadas>("cola:actualizar"),
  colaPausar: () => invocar<Phoenix.EstadoColaLlamadas>("cola:pausar"),
  colaReanudar: () => invocar<Phoenix.EstadoColaLlamadas>("cola:reanudar"),
  colaDetener: () => invocar<Phoenix.EstadoColaLlamadas>("cola:detener"),
  colaSaltar: () => invocar<Phoenix.EstadoColaLlamadas>("cola:saltar"),
  colaFinalizar: (resultado: boolean | Phoenix.MotivoLlamada) => invocar<Phoenix.EstadoColaLlamadas>("cola:finalizar-llamada", resultado),
  colaCorregirIntento: (motivo: Phoenix.MotivoLlamada) => invocar<Phoenix.EstadoColaLlamadas>("cola:corregir-intento", motivo),
  colaResultado: (r: Phoenix.ResultadoCola) => invocar<Phoenix.EstadoColaLlamadas>("cola:registrar-resultado", r),

  // Configuración y respaldo
  config: () => invocar<Phoenix.ConfigApp>("config:obtener"),
  guardarConfig: (c: Partial<Phoenix.ConfigApp>) => invocar<Phoenix.ConfigApp>("config:guardar", c),
  respaldar: () => invocar<Phoenix.ArchivoGuardado | null>("respaldo:crear"),
  restaurar: () => invocar<boolean | null>("respaldo:restaurar"),
  mostrarArchivo: (ruta: string) => invocar<boolean>("sistema:mostrar-archivo", ruta),
};
