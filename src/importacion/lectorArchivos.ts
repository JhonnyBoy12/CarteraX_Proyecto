/**
 * @file lectorArchivos.ts
 * @description Cargador unificado de archivos tabulares: Excel (`.xlsx`,
 * `.xls`, `.xlsm`, `.ods`) y texto delimitado (`.csv`, `.tsv`, `.txt`).
 *
 * Entrega SIEMPRE la misma estructura (`ArchivoLeido`: una lista de tablas
 * con filas `{encabezado: valor}`), idéntica a lo que antes producía
 * `XLSX.utils.sheet_to_json(hoja, { defval: null, raw: true })`. Así el
 * importador original sigue funcionando sin saber de qué formato viene.
 *
 * CSV — qué se detecta automáticamente:
 *  - Codificación: UTF-8 (con o sin BOM), UTF-16 (BOM) o Windows-1252/Latin-1
 *    (lo que genera Excel en Windows en español al "Guardar como CSV").
 *  - Separador: `;` (Excel Chile), `,`, tabulador o `|`. También respeta la
 *    línea especial `sep=;` que Excel agrega a veces.
 *  - Comillas RFC 4180: `"campo; con separador"`, comillas dobles `""` y
 *    saltos de línea dentro de comillas.
 *  - Los valores se conservan como TEXTO (no se pierden ceros a la izquierda
 *    en RUT o teléfonos); `normalizador.ts` convierte números y fechas.
 *
 * @since 0.2.0
 */
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";

/** Extensiones aceptadas por el cargador (en minúsculas, sin punto). */
export const EXTENSIONES_EXCEL = ["xlsx", "xls", "xlsm", "ods"] as const;
export const EXTENSIONES_TEXTO = ["csv", "tsv", "txt"] as const;
export const EXTENSIONES_SOPORTADAS: string[] = [...EXTENSIONES_EXCEL, ...EXTENSIONES_TEXTO];

/** Tamaño máximo aceptado (protege la app de archivos gigantes por error). */
export const TAMANO_MAXIMO_BYTES = 80 * 1024 * 1024;

/** Una hoja de Excel o el contenido completo de un CSV. */
export interface TablaLeida {
  /** Nombre de la hoja (Excel) o del archivo sin extensión (CSV). */
  nombre: string;
  /** Encabezados en el orden del archivo. */
  encabezados: string[];
  /** Filas como objetos `{ encabezado: valor }`; celdas vacías = `null`. */
  filas: Record<string, unknown>[];
}

/** Resultado completo de leer un archivo. */
export interface ArchivoLeido {
  archivo: string;
  formato: Phoenix.FormatoArchivo;
  separador?: string;
  codificacion?: string;
  tablas: TablaLeida[];
}

/**
 * Determina el formato a partir de la extensión.
 * @param nombreArchivo Nombre o ruta del archivo.
 * @throws Error si la extensión no está soportada.
 */
export function detectarFormato(nombreArchivo: string): Phoenix.FormatoArchivo {
  const ext = path.extname(nombreArchivo).slice(1).toLowerCase();
  if (!EXTENSIONES_SOPORTADAS.includes(ext)) {
    throw new Error(
      `Formato no soportado (.${ext || "sin extensión"}). Usa: ${EXTENSIONES_SOPORTADAS.map((e) => "." + e).join(", ")}`
    );
  }
  return ext as Phoenix.FormatoArchivo;
}

/**
 * Lee un archivo de cartera (Excel o CSV) y lo devuelve en formato común.
 *
 * @param ruta Ruta en disco del archivo.
 * @param nombreOriginal Nombre a mostrar/guardar como origen (útil cuando el
 *        archivo llegó por HTTP y se guardó en una carpeta temporal).
 * @returns Tablas con sus filas.
 * @throws Error si el formato no es soportado o el archivo excede el tamaño.
 * @example
 * const leido = leerArchivoTabular("C:/carteras/julio.csv");
 * leido.tablas[0].filas[0]; // { RUT: "12345678", NOMBRE: "JUAN PEREZ", ... }
 */
export function leerArchivoTabular(ruta: string, nombreOriginal?: string): ArchivoLeido {
  const archivo = nombreOriginal ?? path.basename(ruta);
  const formato = detectarFormato(archivo);

  const tamano = fs.statSync(ruta).size;
  if (tamano > TAMANO_MAXIMO_BYTES) {
    throw new Error(`El archivo pesa ${(tamano / 1048576).toFixed(1)} MB; el máximo es ${TAMANO_MAXIMO_BYTES / 1048576} MB.`);
  }

  if ((EXTENSIONES_EXCEL as readonly string[]).includes(formato)) {
    return { archivo, formato, tablas: leerLibroExcel(ruta) };
  }

  const { texto, codificacion } = decodificarTexto(fs.readFileSync(ruta));
  const { separador, cuerpo } = formato === "tsv" ? { separador: "\t", cuerpo: texto } : detectarSeparador(texto);
  const matriz = parsearCsv(cuerpo, separador);
  const { encabezados, filas } = matrizAObjetos(matriz);

  return {
    archivo,
    formato,
    separador,
    codificacion,
    tablas: [{ nombre: path.basename(archivo, path.extname(archivo)), encabezados, filas }],
  };
}

/**
 * Lee todas las hojas de un libro Excel exactamente como lo hacía la
 * versión 0.1.0 (`defval: null`, `raw: true`).
 * @param ruta Ruta del libro.
 */
function leerLibroExcel(ruta: string): TablaLeida[] {
  const libro = XLSX.readFile(ruta);
  return libro.SheetNames.map((nombre) => {
    const hoja = libro.Sheets[nombre];
    const filas: Record<string, unknown>[] = XLSX.utils.sheet_to_json(hoja, { defval: null, raw: true });
    const encabezados = filas.length ? Object.keys(filas[0]) : [];
    return { nombre, encabezados, filas };
  });
}

/**
 * Convierte los bytes de un archivo de texto a string detectando la
 * codificación.
 *
 * Orden: BOM UTF-8 → BOM UTF-16 LE/BE → UTF-8 estricto → Windows-1252.
 *
 * @param buffer Contenido binario del archivo.
 * @returns Texto decodificado y nombre de la codificación usada.
 */
export function decodificarTexto(buffer: Buffer): { texto: string; codificacion: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { texto: buffer.subarray(3).toString("utf-8"), codificacion: "utf-8 (BOM)" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { texto: new TextDecoder("utf-16le").decode(buffer.subarray(2)), codificacion: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { texto: new TextDecoder("utf-16be").decode(buffer.subarray(2)), codificacion: "utf-16be" };
  }
  try {
    return { texto: new TextDecoder("utf-8", { fatal: true }).decode(buffer), codificacion: "utf-8" };
  } catch {
    // Excel en Windows (español) guarda CSV en Windows-1252: Ñ, tildes, etc.
    try {
      return { texto: new TextDecoder("windows-1252").decode(buffer), codificacion: "windows-1252" };
    } catch {
      return { texto: buffer.toString("latin1"), codificacion: "latin1" };
    }
  }
}

/** Separadores candidatos, en orden de preferencia ante empate. */
const SEPARADORES = [";", ",", "\t", "|"];

/**
 * Detecta el separador de un CSV analizando las primeras líneas.
 * Gana el candidato que aparece la MISMA cantidad de veces en más líneas
 * (fuera de comillas). Si el archivo empieza con `sep=X` se usa `X`.
 *
 * @param texto Contenido completo del CSV.
 * @returns Separador y el cuerpo (sin la línea `sep=` si existía).
 */
export function detectarSeparador(texto: string): { separador: string; cuerpo: string } {
  const pista = texto.match(/^sep=(.)\r?\n/i);
  if (pista) return { separador: pista[1], cuerpo: texto.slice(pista[0].length) };

  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 20);
  let mejor = { separador: ";", puntaje: 0 };

  for (const sep of SEPARADORES) {
    const conteos = lineas.map((l) => contarFueraDeComillas(l, sep));
    const frecuencia = new Map<number, number>();
    for (const c of conteos) if (c > 0) frecuencia.set(c, (frecuencia.get(c) ?? 0) + 1);
    let puntaje = 0;
    for (const [cantidad, veces] of frecuencia) puntaje = Math.max(puntaje, veces * 1000 + cantidad);
    if (puntaje > mejor.puntaje) mejor = { separador: sep, puntaje };
  }
  return { separador: mejor.separador, cuerpo: texto };
}

/** Cuenta apariciones de `sep` en una línea ignorando lo que está entre comillas. */
function contarFueraDeComillas(linea: string, sep: string): number {
  let enComillas = false;
  let n = 0;
  for (const ch of linea) {
    if (ch === '"') enComillas = !enComillas;
    else if (ch === sep && !enComillas) n++;
  }
  return n;
}

/**
 * Parser CSV (RFC 4180) sin dependencias.
 * Soporta comillas, comillas escapadas (`""`), separador y saltos de línea
 * dentro de comillas, y finales de línea `\n`, `\r\n` o `\r`.
 *
 * @param texto Contenido del CSV.
 * @param separador Separador de campos.
 * @returns Matriz de celdas (filas × columnas) como texto.
 * @example parsearCsv('a;"b;c"\n1;2', ";") // [["a","b;c"],["1","2"]]
 */
export function parsearCsv(texto: string, separador: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let enComillas = false;
  let i = 0;

  while (i < texto.length) {
    const ch = texto[i];

    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i += 2;
          continue;
        }
        enComillas = false;
      } else {
        celda += ch;
      }
      i++;
      continue;
    }

    if (ch === '"' && celda === "") {
      enComillas = true;
    } else if (ch === separador) {
      fila.push(celda);
      celda = "";
    } else if (ch === "\n" || ch === "\r") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
      if (ch === "\r" && texto[i + 1] === "\n") i++;
    } else {
      celda += ch;
    }
    i++;
  }

  if (celda !== "" || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

/**
 * Convierte una matriz CSV en objetos usando la primera fila no vacía como
 * encabezado. Replica el comportamiento de SheetJS:
 *  - encabezados repetidos → `COL`, `COL_1`, `COL_2`…
 *  - encabezados vacíos → `__EMPTY`, `__EMPTY_1`…
 *  - celdas vacías → `null`; filas totalmente vacías se omiten.
 *
 * @param matriz Resultado de `parsearCsv`.
 */
export function matrizAObjetos(matriz: string[][]): { encabezados: string[]; filas: Record<string, unknown>[] } {
  const esVacia = (f: string[]) => f.every((c) => c.trim() === "");
  const inicio = matriz.findIndex((f) => !esVacia(f));
  if (inicio === -1) return { encabezados: [], filas: [] };

  const usados = new Map<string, number>();
  const encabezados = matriz[inicio].map((crudo) => {
    const base = crudo.trim() === "" ? "__EMPTY" : crudo.trim();
    const n = usados.get(base) ?? 0;
    usados.set(base, n + 1);
    return n === 0 ? base : `${base}_${n}`;
  });

  const filas: Record<string, unknown>[] = [];
  for (const f of matriz.slice(inicio + 1)) {
    if (esVacia(f)) continue;
    const obj: Record<string, unknown> = {};
    encabezados.forEach((enc, idx) => {
      const v = f[idx];
      obj[enc] = v === undefined || v.trim() === "" ? null : v.trim();
    });
    filas.push(obj);
  }
  return { encabezados, filas };
}
