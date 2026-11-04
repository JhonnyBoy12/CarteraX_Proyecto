/**
 * @file previsualizador.ts
 * @description Vista previa de un archivo de cartera ANTES de importarlo:
 * hojas, cantidad de filas, columnas reconocidas / no reconocidas y una
 * muestra de filas. No escribe nada en la base de datos.
 *
 * Sirve para que el usuario confirme que el mapeo (RF-09) es correcto y,
 * si aparece una columna "no reconocida", agregarla a `MAPEO_COLUMNAS`.
 *
 * @since 0.2.0
 */
import { leerArchivoTabular } from "./lectorArchivos";
import { asignarCampos } from "./mapeoColumnas";
import { limpiarTexto } from "./normalizador";

/**
 * Convierte valores no serializables (Date) a texto para enviarlos por IPC/HTTP.
 * @param fila Fila cruda.
 */
function serializarFila(fila: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fila)) {
    salida[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  }
  return salida;
}

/**
 * Lee un archivo y arma su vista previa.
 *
 * @param ruta Ruta del archivo en disco.
 * @param nombreOriginal Nombre a mostrar (opcional, para subidas HTTP).
 * @param filasMuestra Cuántas filas incluir de ejemplo por hoja (por defecto 8).
 * @returns Información por hoja: filas, columnas mapeadas y muestra.
 * @example
 * const previa = previsualizarArchivo("cartera.csv");
 * previa.hojas[0].columnas.filter(c => !c.campo); // columnas sin mapear
 */
export function previsualizarArchivo(
  ruta: string,
  nombreOriginal?: string,
  filasMuestra = 8
): Phoenix.PreviaArchivo {
  const leido = leerArchivoTabular(ruta, nombreOriginal);

  const hojas: Phoenix.PreviaHoja[] = leido.tablas
    .filter((t) => t.filas.length > 0)
    .map((t) => {
      const campos = asignarCampos(t.encabezados);
      const columnas = t.encabezados.map((original, i) => ({ original, campo: campos[i] }));
      const colRut = columnas.filter((c) => c.campo === "rut").map((c) => c.original);
      const filasSinRut = colRut.length
        ? t.filas.filter((f) => colRut.every((c) => !limpiarTexto(f[c]))).length
        : t.filas.length;

      return {
        hoja: t.nombre,
        totalFilas: t.filas.length,
        filasSinRut,
        columnas,
        muestra: t.filas.slice(0, filasMuestra).map(serializarFila),
      };
    });

  return {
    archivo: leido.archivo,
    formato: leido.formato,
    separador: leido.separador,
    codificacion: leido.codificacion,
    hojas,
  };
}
