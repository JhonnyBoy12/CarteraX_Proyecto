/**
 * @file contratos.d.ts
 * @description Contratos de datos (tipos) compartidos entre el BACKEND
 * (proceso principal de Electron y servidor HTTP) y el FRONTEND (renderer).
 *
 * ¿Por qué un archivo `.d.ts` global?
 * El renderer se compila como *script* de navegador (sin `import/export`),
 * por lo que no puede importar tipos desde módulos CommonJS sin romperse en
 * runtime. Un `.d.ts` sin `import/export` es **global** para todo el
 * proyecto TypeScript: lo ven tanto los módulos del backend como los scripts
 * del renderer, y no genera ningún `.js` (cero impacto en el empaquetado).
 *
 * Todos los tipos viven en el espacio de nombres `Phoenix` para no chocar
 * con tipos del DOM o de Node.
 *
 * @since 0.2.0 (integración cargador CSV/XLSX + Phoenix Mobile + servidor)
 */
declare namespace Phoenix {
  // -------------------------------------------------------------------
  // Respuesta genérica
  // -------------------------------------------------------------------

  /** Envoltorio estándar de respuesta para IPC y HTTP. */
  interface Respuesta<T> {
    ok: boolean;
    datos?: T;
    error?: string;
  }

  // -------------------------------------------------------------------
  // Cargador de archivos (CSV / XLSX)
  // -------------------------------------------------------------------

  /** Formatos que entiende el cargador. */
  type FormatoArchivo = "xlsx" | "xls" | "xlsm" | "ods" | "csv" | "tsv" | "txt";

  /** Columna detectada en una hoja y su campo interno (si fue reconocida). */
  interface ColumnaDetectada {
    /** Encabezado tal como venía en el archivo. */
    original: string;
    /** Campo interno al que se mapea, o `null` si no está en MAPEO_COLUMNAS. */
    campo: string | null;
  }

  /** Vista previa de una hoja / tabla antes de importarla. */
  interface PreviaHoja {
    hoja: string;
    totalFilas: number;
    filasSinRut: number;
    columnas: ColumnaDetectada[];
    /** Primeras filas, con las claves ORIGINALES del archivo. */
    muestra: Record<string, unknown>[];
  }

  /** Resultado de previsualizar un archivo completo. */
  interface PreviaArchivo {
    archivo: string;
    formato: FormatoArchivo;
    /** Sólo CSV: separador detectado (`;`, `,`, `\t`, `|`). */
    separador?: string;
    /** Sólo CSV: codificación detectada (`utf-8` o `latin1`). */
    codificacion?: string;
    hojas: PreviaHoja[];
  }

  /** Resultado de importar una hoja (mismo formato que la versión 0.1.0). */
  interface ResultadoHoja {
    hoja: string;
    cargados: number;
    corregidos: number;
    conError: number;
  }

  /** Resultado de importar un archivo (mismo formato que la versión 0.1.0). */
  interface ResultadoImportacion {
    archivo: string;
    hojas: ResultadoHoja[];
    /** Nuevo en 0.2.0: formato de origen detectado. */
    formato?: FormatoArchivo;
  }

  // -------------------------------------------------------------------
  // Cartera / panel
  // -------------------------------------------------------------------

  interface ClienteResumen {
    rut: string;
    nombre_cliente: string | null;
    monto_deuda: number | null;
    dias_mora: number | null;
    categoria_gestion: string | null;
  }

  interface CategoriaConteo {
    categoria_gestion: string;
    total: number;
  }

  interface TramoConteo {
    tramo_mora: string;
    total: number;
    deuda: number;
  }

  interface Indicadores {
    totalClientes: number;
    deudaTotal: number;
    moraPromedio: number | null;
    recuperacionPromedio: number | null;
    clientesConTelefono: number;
    totalImportaciones: number;
    llamadasHoy: number;
  }

  /** Respuesta de `resumen:obtener` (compatible con 0.1.0 + campos nuevos). */
  interface ResumenCartera {
    totalClientes: number;
    topDeuda: ClienteResumen[];
    categorias: CategoriaConteo[];
    /** Nuevo en 0.2.0 */
    indicadores?: Indicadores;
    /** Nuevo en 0.2.0 */
    tramos?: TramoConteo[];
  }

  interface ImportacionHistorial {
    archivo_nombre: string;
    hoja_nombre: string;
    fecha: string;
    registros_cargados: number;
    registros_corregidos: number;
    registros_con_error: number;
  }

  /** Cliente con datos de contacto para la vista "Clientes". */
  interface ClienteDetalle {
    id: string;
    rut: string;
    dv: string | null;
    nombre_cliente: string | null;
    monto_deuda: number | null;
    dias_mora: number | null;
    tramo_mora: string | null;
    pct_recuperacion: number | null;
    categoria_gestion: string | null;
    comuna: string | null;
    origen_archivo: string | null;
    telefonos: string[];
    correos: string[];
  }

  interface FiltroClientes {
    texto?: string;
    categoria?: string;
    pagina?: number;
    porPagina?: number;
  }

  interface PaginaClientes {
    total: number;
    pagina: number;
    porPagina: number;
    filas: ClienteDetalle[];
  }


  interface UsuarioSesion {
    id: string;
    nombre: string;
    apellido: string;
    email: string;
  }

  // -------------------------------------------------------------------
  // Phoenix Mobile (teléfono Android por Wi-Fi)
  // -------------------------------------------------------------------

  /** Respuesta de GET /ping de Phoenix Mobile. */
  interface EstadoMovil {
    conectado: boolean;
    ip: string | null;
    puerto: number;
    dispositivo?: string;
    permisoLlamadas?: boolean;
    llamadaDirecta?: boolean;
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
    prioridad: number;
    estadoTelefono: string;
    clienteId: string;
    rut: string;
    dv: string | null;
    nombreCliente: string;
    estadoImportado: string | null;
    deudaTotal: number;
  }

  interface EstadoColaLlamadas {
    pendientes: number;
    siguiente: ItemColaLlamadas | null;
    activa?: boolean;
    estadoProceso?: "DETENIDA" | "BUSCANDO" | "MARCANDO" | "EN_LLAMADA" | "ESPERANDO_FIN" | "FINALIZADA" | "ERROR";
    actual?: ItemColaLlamadas | null;
    mensaje?: string | null;
  }

  interface ResultadoColaLlamadas {
    item: ItemColaLlamadas;
    llamada: ResultadoLlamada;
  }

  interface LlamadaRegistrada {
    id: string;
    fecha: string;
    cliente_id: string | null;
    rut: string | null;
    nombre_cliente: string | null;
    texto_libre: string | null;
    resultado: string | null;
  }

  // -------------------------------------------------------------------
  // Servidor HTTP (cliente-servidor)
  // -------------------------------------------------------------------

  interface ConfigServidor {
    habilitado: boolean;
    puerto: number;
    /** `true` = escucha en 0.0.0.0 (otros PC de la red pueden conectarse). */
    accesoRed: boolean;
  }

  interface EstadoServidor extends ConfigServidor {
    activo: boolean;
    urls: string[];
    error?: string;
    modo: "electron" | "standalone";
  }
}
