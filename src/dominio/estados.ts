/**
 * @file estados.ts
 * @description Catálogo ÚNICO de estados ejecutivos de cobranza.
 *
 * El backend lo entrega a la interfaz por IPC (`catalogo:estados`), así que
 * para agregar o renombrar un estado basta con editar este archivo.
 *
 * Reglas clave:
 *  - EN_COLA es el único estado que entra a la cola automática de llamadas.
 *  - Los estados "cerrados" (PAGADO, NO_CONTACTAR) no suman prioridad ni
 *    generan alertas.
 *  - COMPROMISO exige fecha; ABONO exige monto; PAGADO registra el monto
 *    pagado (por defecto, el saldo pendiente).
 *
 * @since 0.3.0
 */

export const ESTADOS: Phoenix.EstadoCobranza[] = [
  {
    codigo: "PENDIENTE",
    nombre: "Sin gestionar",
    descripcion: "Aún no se trabaja el caso este mes.",
    tono: "gris",
    grupo: "abierto",
    peso: 1,
  },
  {
    codigo: "EN_COLA",
    nombre: "En cola",
    descripcion: "Entra a la cola automática de llamadas de Phoenix Mobile.",
    tono: "azul",
    grupo: "abierto",
    peso: 0.9,
  },
  {
    codigo: "CONTACTADO",
    nombre: "Contactado",
    recordatorio: { motivo: "Retomar la conversación y buscar un acuerdo", dias: 2, hora: "10:00" },
    descripcion: "Se habló con el titular, sin acuerdo todavía.",
    tono: "celeste",
    grupo: "abierto",
    peso: 0.55,
  },
  {
    codigo: "NO_CONTESTA",
    nombre: "No contesta",
    recordatorio: { motivo: "Volver a llamar", dias: 1, hora: "10:00" },
    descripcion: "Se llamó y nadie respondió.",
    tono: "ambar",
    grupo: "abierto",
    peso: 0.8,
  },
  {
    codigo: "NOTIFICADO",
    nombre: "Notificado",
    recordatorio: { motivo: "Confirmar que recibió la notificación", dias: 3, hora: "10:00" },
    descripcion: "Se informó la deuda (llamada, correo o carta).",
    tono: "violeta",
    grupo: "abierto",
    peso: 0.6,
  },
  {
    codigo: "COMPROMISO",
    nombre: "Compromiso de pago",
    recordatorio: { motivo: "Verificar el pago comprometido", desde: "compromiso", dias: 0, hora: "17:00" },
    descripcion: "El cliente se comprometió a pagar en una fecha.",
    tono: "naranja",
    grupo: "abierto",
    peso: 0.35,
    pideFecha: true,
    pideMonto: true,
  },
  {
    codigo: "ABONO",
    nombre: "Abono parcial",
    recordatorio: { motivo: "Seguimiento del saldo pendiente", dias: 7, hora: "10:00" },
    descripcion: "Pagó una parte de la deuda.",
    tono: "verde-claro",
    grupo: "abierto",
    peso: 0.45,
    pideMonto: true,
    montoObligatorio: true,
  },
  {
    codigo: "PAGADO",
    nombre: "Pagado",
    descripcion: "Deuda regularizada.",
    tono: "verde",
    grupo: "cerrado",
    peso: 0,
    pideMonto: true,
  },
  {
    codigo: "NO_PAGADO",
    nombre: "No pagado",
    recordatorio: { motivo: "Contactar por el incumplimiento", dias: 1, hora: "10:00" },
    descripcion: "Incumplió el compromiso o se niega a pagar.",
    tono: "rojo",
    grupo: "abierto",
    peso: 1,
  },
  {
    codigo: "ALERTA",
    nombre: "Alerta",
    recordatorio: { motivo: "Revisar el caso en alerta", horas: 2 },
    descripcion: "Requiere atención: reclamo, riesgo o caso especial.",
    tono: "rojo-fuerte",
    grupo: "abierto",
    peso: 1,
  },
  {
    codigo: "INUBICABLE",
    nombre: "Inubicable",
    recordatorio: { motivo: "Buscar datos de contacto nuevos", dias: 7, hora: "10:00" },
    descripcion: "Teléfonos erróneos o el titular no es ubicable.",
    tono: "pizarra",
    grupo: "abierto",
    peso: 0.3,
  },
  {
    codigo: "NO_CONTACTAR",
    nombre: "No contactar",
    descripcion: "Pidió no ser llamado o está en cobranza judicial.",
    tono: "negro",
    grupo: "cerrado",
    peso: 0,
  },
];

const POR_CODIGO = new Map(ESTADOS.map((e) => [e.codigo, e]));

/** Devuelve la definición de un estado o lanza si el código no existe. */
export function estadoPorCodigo(codigo: string): Phoenix.EstadoCobranza {
  const e = POR_CODIGO.get(codigo as Phoenix.CodigoEstado);
  if (!e) throw new Error(`Estado de cobranza desconocido: ${codigo}`);
  return e;
}

/** `true` si el código corresponde a un estado del catálogo. */
export function esEstadoValido(codigo: unknown): codigo is Phoenix.CodigoEstado {
  return typeof codigo === "string" && POR_CODIGO.has(codigo as Phoenix.CodigoEstado);
}

/** `true` para estados cerrados (no suman prioridad ni alertas). */
export function esCerrado(codigo: string): boolean {
  return POR_CODIGO.get(codigo as Phoenix.CodigoEstado)?.grupo === "cerrado";
}

/**
 * Estado con el que entra un cliente recién importado, a partir de la
 * categoría que el clasificador (RF-20) dedujo del texto de gestión del Excel.
 * @param categoria Resultado de `clasificarGestion`.
 */
export function estadoInicialDesdeCategoria(categoria: string | null): Phoenix.CodigoEstado {
  switch ((categoria ?? "").toLowerCase()) {
    case "pago realizado":
      return "PAGADO";
    case "en negociacion":
    case "informado":
      return "NOTIFICADO";
    case "sin contacto":
      return "NO_CONTESTA";
    default:
      return "PENDIENTE";
  }
}
