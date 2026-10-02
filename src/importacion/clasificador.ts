/**
 * @file clasificador.ts
 * @description Clasificación del texto libre de gestión en categorías
 * estándar mediante palabras clave (RF-34, sin ML).
 * v0.2.0: sólo se agregó documentación; la lógica no cambia.
 * Para agregar reglas, editar `REGLAS_CLASIFICACION` (el orden importa:
 * gana la primera categoría cuya palabra clave aparezca en el texto).
 */

/** Quita tildes para que la comparación de palabras clave sea insensible a acentos. */
function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Pares [categoría, palabras clave]. Evaluadas en orden. */
const REGLAS_CLASIFICACION: Array<[string, string[]]> = [
  ["pago realizado", ["paga", "pago realizado", "cumple compromiso", "cupon enviado paga"]],
  [
    "en negociacion",
    ["compromiso", "condiciones", "campana pre-aprobada", "simulacion", "reconduccion"],
  ],
  ["sin contacto", ["sin contacto", "no contactado", "no da respuesta", "no conoce"]],
  ["informado", ["recibe informacion", "se entrega informacion", "titular entrevistado"]],
];

/**
 * Clasifica el texto libre de gestión en una categoría estandarizada. RF-34 (sin ML).
 * @param textoLibre Texto de la columna GESTION.
 * @returns `"pago realizado" | "en negociacion" | "sin contacto" | "informado" | "otro" | "sin gestion"`
 * @example clasificarGestion("Cliente paga cuota") // "pago realizado"
 */
export function clasificarGestion(textoLibre: string | null): string {
  if (!textoLibre) return "sin gestion";
  const texto = sinTildes(textoLibre.toLowerCase());

  for (const [categoria, palabrasClave] of REGLAS_CLASIFICACION) {
    for (const palabra of palabrasClave) {
      if (texto.includes(sinTildes(palabra))) {
        return categoria;
      }
    }
  }
  return "otro";
}
