/**
 * @file contratos.d.ts
 * @description Tipos compartidos entre el BACKEND (proceso principal de
 * Electron) y el FRONTEND (renderer). Es un `.d.ts` global sin
 * import/export: lo ven los módulos del backend y los scripts del renderer,
 * y no genera ningún `.js`.
 */
declare namespace Phoenix {
  /** Envoltorio estándar de respuesta IPC. */
  interface Respuesta<T> {
    ok: boolean;
    datos?: T;
    error?: string;
  }

  // ===================================================================
  // Sesión y contexto
  // ===================================================================

  interface UsuarioSesion {
    id: string;
    nombre: string;
    apellido: string;
    email: string;
  }

  interface Periodo {
    /** 'AAAA-MM' */
    id: string;
    /** 'Octubre 2026' */
    nombre: string;
    fechaInicio: string;
    fechaFin: string;
    clientes: number;
    deuda: number;
    /** `true` para el mes calendario en curso. */
    esActual: boolean;
  }

  /** Lo que la interfaz necesita saber al iniciar sesión o cambiar de mes. */
  interface Contexto {
    usuario: UsuarioSesion;
    periodo: Periodo;
    periodos: Periodo[];
    version: string;
  }

  // ===================================================================
  // Estados de cobranza
  // ===================================================================

  type CodigoEstado =
    | "PENDIENTE"
    | "EN_COLA"
    | "CONTACTADO"
    | "NO_CONTESTA"
    | "NOTIFICADO"
    | "COMPROMISO"
    | "ABONO"
    | "PAGADO"
    | "NO_PAGADO"
    | "ALERTA"
    | "INUBICABLE"
    | "NO_CONTACTAR";

  interface EstadoCobranza {
    codigo: CodigoEstado;
    nombre: string;
    descripcion: string;
    /** Nombre del tono de color (clase CSS `tono-<tono>`). */
    tono: string;
    grupo: "abierto" | "cerrado";
    /** Peso en el score de prioridad (0–1). */
    peso: number;
    pideFecha?: boolean;
    pideMonto?: boolean;
    montoObligatorio?: boolean;
    /** Recordatorio de vuelta de gestión que se sugiere al pasar a este estado. */
    recordatorio?: ReglaRecordatorio;
  }

  /**
   * Cuándo volver a gestionar un caso según su estado. `desde: "compromiso"`
   * cuenta desde la fecha comprometida; si no, desde ahora.
   */
  interface ReglaRecordatorio {
    motivo: string;
    dias?: number;
    horas?: number;
    hora?: string;
    desde?: "ahora" | "compromiso";
  }

  type NivelPrioridad = "alta" | "media" | "baja";

  // ===================================================================
  // Importación (CSV / Excel)
  // ===================================================================

  type FormatoArchivo = "xlsx" | "xls" | "xlsm" | "ods" | "csv" | "tsv" | "txt";

  interface ColumnaDetectada {
    original: string;
    campo: string | null;
  }

  interface PreviaHoja {
    hoja: string;
    totalFilas: number;
    filasSinRut: number;
    columnas: ColumnaDetectada[];
    muestra: Record<string, unknown>[];
    /** Revisión fila a fila de lo que se cargará (no escribe nada). */
    validacion?: ValidacionHoja;
  }

  /** `rechazo`: la fila no se carga. `aviso`: se carga, con un dato descartado o dudoso. */
  type NivelObservacion = "rechazo" | "aviso";

  interface FilaObservada {
    /** Número de fila tal como se ve en Excel (encabezado = fila 1). */
    fila: number;
    rut: string | null;
    nombre: string | null;
    campo: string | null;
    valor: string | null;
  }

  interface ObservacionImportacion {
    codigo: string;
    nivel: NivelObservacion;
    titulo: string;
    /** Qué hará CarteraX con esas filas. */
    efecto: string;
    /** Qué debe hacer el ejecutivo. */
    accion: string;
    total: number;
    filas: FilaObservada[];
  }

  interface ValidacionHoja {
    filasValidas: number;
    filasConAvisos: number;
    filasRechazadas: number;
    observaciones: ObservacionImportacion[];
    /** Fila (como en Excel) → campos con problema, para marcar la muestra. */
    marcas: Record<number, string[]>;
  }

  interface PreviaArchivo {
    archivo: string;
    formato: FormatoArchivo;
    separador?: string;
    codificacion?: string;
    hojas: PreviaHoja[];
  }

  interface ResultadoHoja {
    hoja: string;
    cargados: number;
    corregidos: number;
    conError: number;
  }

  interface ResultadoImportacion {
    archivo: string;
    hojas: ResultadoHoja[];
    formato?: FormatoArchivo;
    periodoId?: string;
  }

  interface ImportacionHistorial {
    archivo_nombre: string;
    hoja_nombre: string;
    fecha: string;
    periodo: string;
    registros_cargados: number;
    registros_corregidos: number;
    registros_con_error: number;
    estado: string;
  }

  // ===================================================================
  // Cartera y clientes
  // ===================================================================

  interface TelefonoCliente {
    id: string;
    numero: string;
    prioridad: number;
    valido: boolean;
    estadoLlamada: string;
    intentos: number;
    ultimaLlamada: string | null;
  }

  interface ClienteFila {
    id: string;
    rut: string;
    dv: string | null;
    nombre: string;
    deuda: number;
    diasMora: number | null;
    tramo: string | null;
    pctRecuperacion: number | null;
    comuna: string | null;
    patentes: string[];
    estado: CodigoEstado;
    categoriaImportada: string | null;
    telefonos: TelefonoCliente[];
    correos: string[];
    ultimaGestion: string | null;
    diasSinGestion: number | null;
    ultimoComentario: string | null;
    proximaGestion: string | null;
    fechaCompromiso: string | null;
    montoCompromiso: number | null;
    compromisoVencido: boolean;
    montoRecuperado: number;
    totalGestiones: number;
    prioridad: number;
    nivelPrioridad: NivelPrioridad;
  }

  type OrdenClientes =
    | "prioridad"
    | "deuda_desc"
    | "deuda_asc"
    | "mora_desc"
    | "mora_asc"
    | "nombre"
    | "ultima_gestion"
    | "compromiso";

  type FiltroRapido =
    | ""
    | "compromisos_vencidos"
    | "compromisos_semana"
    | "sin_gestion"
    | "gestionados_hoy"
    | "proxima_gestion_hoy";

  interface FiltroClientes {
    texto?: string;
    estados?: CodigoEstado[];
    tramo?: string;
    comuna?: string;
    deudaMin?: number | null;
    deudaMax?: number | null;
    moraMin?: number | null;
    moraMax?: number | null;
    conTelefono?: "" | "si" | "no";
    prioridad?: "" | NivelPrioridad;
    rapido?: FiltroRapido;
    orden?: OrdenClientes;
    pagina?: number;
    porPagina?: number;
  }

  interface PaginaClientes {
    total: number;
    pagina: number;
    porPagina: number;
    filas: ClienteFila[];
    /** Suma de deuda de TODAS las filas filtradas (no sólo la página). */
    sumaDeuda: number;
    /** Conteo por estado con el resto de filtros aplicados (para los chips). */
    conteoEstados: Partial<Record<CodigoEstado, number>>;
    /** Ids de todas las filas filtradas (para "seleccionar todo"). */
    idsFiltrados: string[];
  }

  interface OpcionesFiltro {
    tramos: string[];
    comunas: string[];
    deudaMaxima: number;
  }

  interface Operacion {
    numero: string;
    deuda: number;
    cuota: number | null;
    cuotasPactadas: number | null;
    cuotasPagadas: number | null;
    cuotasMorosas: number | null;
    diasMora: number | null;
    tramo: string | null;
    fechaVencimiento: string | null;
    fechaUltimoPago: string | null;
  }

  type TipoGestion = "comentario" | "cambio_estado" | "llamada";

  interface Gestion {
    id: string;
    fecha: string;
    tipo: TipoGestion;
    estadoAnterior: CodigoEstado | null;
    estadoNuevo: CodigoEstado | null;
    comentario: string | null;
    resultado: string | null;
    monto: number | null;
    fechaCompromiso: string | null;
    proximaGestion: string | null;
    telefono: string | null;
    duracion: number | null;
    motivoLlamada: MotivoLlamada | null;
    usuario: string | null;
  }

  interface DetalleCliente extends ClienteFila {
    direcciones: Array<{ direccion: string; comuna: string | null }>;
    vehiculos: Array<{ marca: string | null; modelo: string | null; patente: string | null }>;
    operaciones: Operacion[];
    gestiones: Gestion[];
    textoGestionImportada: string | null;
  }

  /** Registrar una gestión sobre uno o varios clientes (RF-18). */
  interface SolicitudGestion {
    clienteIds: string[];
    /** Nuevo estado; omitido = sólo comentario. */
    estado?: CodigoEstado | null;
    comentario?: string | null;
    monto?: number | null;
    fechaCompromiso?: string | null;
    proximaGestion?: string | null;
    /**
     * Recordatorio de vuelta de gestión. Omitido: se aplica la regla del
     * estado (sólo con un cliente). `null`: sin recordatorio.
     */
    recordatorio?: NuevoRecordatorio | null;
  }

  interface NuevoRecordatorio {
    /** Hora local 'AAAA-MM-DDTHH:MM'. */
    fechaHora: string;
    motivo?: string | null;
  }

  // ===================================================================
  // Recordatorios (vuelta de gestión)
  // ===================================================================

  interface Recordatorio {
    id: string;
    clienteId: string;
    nombre: string;
    rut: string;
    dv: string | null;
    /** Hora local 'AAAA-MM-DDTHH:MM'. */
    fechaHora: string;
    motivo: string;
    estadoOrigen: CodigoEstado | null;
    estadoActual: CodigoEstado;
    deuda: number;
  }

  interface ResultadoGestion {
    actualizados: number;
    omitidos: number;
  }

  // ===================================================================
  // Dashboard
  // ===================================================================

  interface Kpis {
    clientes: number;
    deudaTotal: number;
    deudaPendiente: number;
    recuperado: number;
    pctRecuperado: number;
    metaMensual: number;
    pctMeta: number | null;
    compromisosVigentes: number;
    montoCompromisos: number;
    compromisosVencidos: number;
    gestionados: number;
    pctGestionados: number;
    moraPromedio: number | null;
    enCola: number;
    llamadasPeriodo: number;
    contactadasPeriodo: number;
    pctContactabilidad: number | null;
    llamadasHoy: number;
    gestionesHoy: number;
    prioridadAlta: number;
  }

  interface SerieEstado {
    estado: CodigoEstado;
    clientes: number;
    deuda: number;
  }

  interface SerieTramo {
    tramo: string;
    clientes: number;
    deuda: number;
  }

  interface SerieRango {
    rango: string;
    desde: number;
    hasta: number | null;
    clientes: number;
    deuda: number;
  }

  interface SerieActividad {
    fecha: string;
    gestiones: number;
    llamadas: number;
    cambios: number;
    recuperado: number;
  }

  type TipoAlerta = "compromiso_vencido" | "compromiso_hoy" | "alta_sin_gestion" | "estado_alerta" | "proxima_gestion";

  interface Alerta {
    tipo: TipoAlerta;
    nivel: "alta" | "media";
    clienteId: string;
    nombre: string;
    rut: string;
    detalle: string;
  }

  /** Resumen de llamadas del mes por resultado. */
  interface ResumenLlamadas {
    total: number;
    contestadas: number;
    porMotivo: Partial<Record<MotivoLlamada, number>>;
    /** Llamadas enviadas cuyo término nunca se confirmó. */
    sinConfirmar: number;
    segundosHablados: number;
    duracionPromedio: number | null;
  }

  interface AgendaSeguimiento {
    atrasados: number;
    hoy: number;
    proximos: number;
    lista: Recordatorio[];
  }

  interface Dashboard {
    periodo: Periodo;
    generado: string;
    kpis: Kpis;
    /** Desde v0.3.1 (los reportes anteriores no lo traen). */
    llamadas?: ResumenLlamadas;
    agenda?: AgendaSeguimiento;
    porEstado: SerieEstado[];
    porTramo: SerieTramo[];
    porRango: SerieRango[];
    actividad: SerieActividad[];
    topDeuda: ClienteFila[];
    proximosCompromisos: ClienteFila[];
    alertas: Alerta[];
  }

  // ===================================================================
  // Reportes mensuales
  // ===================================================================

  interface ReporteResumen {
    id: string;
    periodoId: string;
    periodoNombre: string;
    titulo: string;
    automatico: boolean;
    notas: string | null;
    generadoEn: string;
    deudaTotal: number;
    recuperado: number;
    clientes: number;
  }

  interface ClienteReporte {
    rut: string;
    dv: string | null;
    nombre: string;
    deuda: number;
    diasMora: number | null;
    tramo: string | null;
    estado: CodigoEstado;
    recuperado: number;
    prioridad: number;
    ultimaGestion: string | null;
    ultimoComentario: string | null;
    fechaCompromiso: string | null;
    montoCompromiso: number | null;
    telefonos: string;
  }

  interface ReporteDetalle extends ReporteResumen {
    dashboard: Dashboard;
    clientesDetalle: ClienteReporte[];
  }

  type FormatoDescarga = "xlsx" | "pdf" | "csv";

  // ===================================================================
  // Configuración y respaldo
  // ===================================================================

  interface ConfigApp {
    /** Meta de recuperación del mes en pesos (0 = sin meta). */
    metaMensual: number;
    /** Días sin gestión para alertar un cliente de prioridad alta. */
    diasSinGestion: number;
    /** Minutos de inactividad antes de cerrar la sesión (RNF-07). */
    inactividadMinutos: number;
  }

  interface ArchivoGuardado {
    ruta: string;
  }

  // ===================================================================
  // Phoenix Mobile y cola de llamadas
  // ===================================================================

  interface EstadoMovil {
    conectado: boolean;
    ip: string | null;
    puerto: number;
    dispositivo?: string;
    permisoLlamadas?: boolean;
    seguimientoLlamadas?: boolean;
    version?: string;
    detalle?: string;
  }

  interface ResultadoLlamada {
    numero: string;
    accion: string;
    gestionId: string | null;
  }

  interface ItemColaLlamadas {
    telefonoId: string;
    numero: string;
    clienteId: string;
    rut: string;
    dv: string | null;
    nombre: string;
    deuda: number;
    diasMora: number | null;
    prioridad: number;
    telefonosPendientes: number;
    ultimoComentario: string | null;
  }

  type ProcesoCola =
    | "DETENIDA"
    | "MARCANDO"
    | "EN_LLAMADA"
    | "ESPERANDO_FIN"
    | "ESPERANDO_RESULTADO"
    | "PAUSADA"
    | "FINALIZADA"
    | "ERROR";

  /**
   * Cómo terminó un intento de llamada. Android sólo distingue contestó / no
   * contestó; el resto lo indica el ejecutivo (o lo corrige después).
   */
  type MotivoLlamada =
    | "contestada"
    | "no_contesta"
    | "ocupado"
    | "rechazada"
    | "apagado"
    | "inexistente"
    | "cortada";

  /** Último intento cerrado, para corregir su motivo sin detener la cola. */
  interface IntentoLlamada {
    gestionId: string;
    nombre: string;
    numero: string;
    motivo: MotivoLlamada;
    duracion: number | null;
  }

  /** Seguimiento de una llamada manual (fuera de la cola). */
  interface SeguimientoLlamada {
    gestionId: string;
    numero: string;
    nombre: string | null;
    /** Segundos desde que se marcó. */
    transcurrido: number;
    /** `true` si el teléfono informa el término de la llamada. */
    automatico: boolean;
    terminada: boolean;
    motivo: MotivoLlamada | null;
    duracion: number | null;
  }

  interface EstadoColaLlamadas {
    activa: boolean;
    pausada: boolean;
    proceso: ProcesoCola;
    actual: ItemColaLlamadas | null;
    /** El teléfono colgó pero no informó si contestaron: se pide el resultado. */
    terminoSinDatos?: boolean;
    ultimoIntento?: IntentoLlamada | null;
    /** Clientes en estado EN_COLA con algún teléfono pendiente. */
    pendientes: number;
    /** Clientes EN_COLA sin teléfonos válidos pendientes. */
    sinTelefono: number;
    proximos: ItemColaLlamadas[];
    mensaje: string | null;
    duracionUltima: number | null;
    sesion: { llamadas: number; contestadas: number; noContesta: number; gestionados: number; inicio: string | null };
  }

  interface ResultadoCola {
    estado: CodigoEstado;
    comentario?: string | null;
    monto?: number | null;
    fechaCompromiso?: string | null;
    proximaGestion?: string | null;
    recordatorio?: NuevoRecordatorio | null;
    /** Segundos de conversación, si el ejecutivo los ajusta. */
    duracion?: number | null;
  }

  interface LlamadaRegistrada {
    id: string;
    fecha: string;
    cliente_id: string | null;
    rut: string | null;
    nombre_cliente: string | null;
    telefono: string | null;
    texto_libre: string | null;
    resultado: string | null;
    duracion: number | null;
    motivo_llamada: MotivoLlamada | null;
  }
}
