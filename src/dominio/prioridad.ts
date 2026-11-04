/**
 * @file prioridad.ts
 * @description Score de prioridad por cliente (RF-21), de 0 a 100.
 *
 * Combina cuatro factores para que el ejecutivo sepa a quién atender primero:
 *
 * | Factor                 | Peso | Cálculo                                              |
 * |------------------------|------|------------------------------------------------------|
 * | Monto de deuda         | 40   | percentil de la deuda dentro de la cartera del mes   |
 * | Días de mora           | 25   | lineal hasta 360 días                                |
 * | Estado de cobranza     | 20   | `peso` del estado (dominio/estados.ts)               |
 * | Días sin gestión       | 15   | lineal hasta 14 días (nunca gestionado = máximo)     |
 *
 * Se usa el PERCENTIL de deuda (no el monto bruto) para que el score
 * reparta a los clientes a lo largo de la escala aunque las deudas estén
 * concentradas. Un compromiso vencido cuenta como estado de peso máximo.
 * Los estados cerrados (Pagado, No contactar) siempre tienen prioridad 0.
 *
 * @since 0.3.0
 */
import { esCerrado, estadoPorCodigo } from "./estados";

export interface EntradaPrioridad {
  /** Posición de la deuda en la cartera, de 0 (menor) a 1 (mayor). */
  percentilDeuda: number;
  diasMora: number | null;
  estado: Phoenix.CodigoEstado;
  diasSinGestion: number | null;
  compromisoVencido: boolean;
}

/** @returns Score entero 0–100. */
export function calcularPrioridad(e: EntradaPrioridad): number {
  if (esCerrado(e.estado)) return 0;
  const deuda = Math.min(Math.max(e.percentilDeuda, 0), 1);
  const mora = e.diasMora === null ? 0.3 : Math.min(Math.max(e.diasMora, 0), 360) / 360;
  const estado = e.compromisoVencido ? 1 : estadoPorCodigo(e.estado).peso;
  const recencia = e.diasSinGestion === null ? 1 : Math.min(e.diasSinGestion, 14) / 14;
  return Math.round(deuda * 40 + mora * 25 + estado * 20 + recencia * 15);
}

/** Nivel legible del score. */
export function nivelPrioridad(score: number): Phoenix.NivelPrioridad {
  if (score >= 75) return "alta";
  if (score >= 50) return "media";
  return "baja";
}

/**
 * Percentil de cada deuda (0 = la menor, 1 = la mayor); los empates
 * reciben el mismo valor.
 */
export function percentiles(deudas: number[]): Map<number, number> {
  const unicas = [...new Set(deudas)].sort((a, b) => a - b);
  const mapa = new Map<number, number>();
  unicas.forEach((d, i) => mapa.set(d, unicas.length > 1 ? i / (unicas.length - 1) : 1));
  return mapa;
}
