/**
 * Pruebas del cargador CSV/XLSX (sin base de datos, sin Electron).
 * Ejecutar con:  npm run prueba
 *
 * Cubre: normalizador (números, fechas, RUT), parser CSV, detección de
 * separador/codificación, mapeo de columnas y lectura de los archivos de
 * ./ejemplos. Incluye casos que verifican que el comportamiento de la
 * v0.1.0 NO cambió (marcados "v0.1.0").
 *
 * @since 0.2.0
 */
const assert = require("assert");
const path = require("path");
const n = require("../dist/importacion/normalizador");
const L = require("../dist/importacion/lectorArchivos");
const M = require("../dist/importacion/mapeoColumnas");
const P = require("../dist/importacion/previsualizador");

const EJ = path.join(__dirname, "..", "ejemplos");
let ok = 0;
const fallas = [];

/** Registra una prueba con nombre legible. */
function prueba(nombre, fn) {
  try {
    fn();
    ok++;
    console.log("  ✔", nombre);
  } catch (e) {
    fallas.push(nombre);
    console.log("  ✘", nombre, "→", e.message);
  }
}
const igual = (a, b) => assert.deepStrictEqual(a, b);

console.log("\nNormalizador — números");
prueba("v0.1.0: número de Excel queda igual", () => igual(n.limpiarNumero(1500), 1500));
prueba("v0.1.0: texto '12.5' es decimal", () => igual(n.limpiarNumero("12.5"), 12.5));
prueba("'$ 1.234.567' → 1234567", () => igual(n.limpiarNumero("$ 1.234.567"), 1234567));
prueba("'1.500' (miles CL) → 1500", () => igual(n.limpiarNumero("1.500"), 1500));
prueba("'1.234,56' → 1234.56", () => igual(n.limpiarNumero("1.234,56"), 1234.56));
prueba("'1,234.56' → 1234.56", () => igual(n.limpiarNumero("1,234.56"), 1234.56));
prueba("'12,5' → 12.5", () => igual(n.limpiarNumero("12,5"), 12.5));
prueba("texto no numérico → null", () => igual(n.limpiarNumero("abc"), null));

console.log("\nNormalizador — fechas");
prueba("v0.1.0: 20230629 → 2023-06-29", () => igual(n.limpiarFechaYYYYMMDD(20230629), "2023-06-29"));
prueba("v0.1.0: 0 → null", () => igual(n.limpiarFechaYYYYMMDD(0), null));
prueba("'29/06/2023' → 2023-06-29", () => igual(n.limpiarFechaYYYYMMDD("29/06/2023"), "2023-06-29"));
prueba("'29.06.2023' → 2023-06-29", () => igual(n.limpiarFechaYYYYMMDD("29.06.2023"), "2023-06-29"));
prueba("serial Excel 45106 → 2023-06-29", () => igual(n.limpiarFechaYYYYMMDD(45106), "2023-06-29"));
prueba("31/02/2023 inexistente → null", () => igual(n.limpiarFechaYYYYMMDD("31/02/2023"), null));

console.log("\nNormalizador — RUT");
prueba("'12.345.678-k' se separa", () => igual(n.separarRut("12.345.678-k"), { rut: "12345678", dv: "K" }));
prueba("RUT sin guion queda igual", () => igual(n.separarRut("12345678"), { rut: "12345678", dv: null }));

console.log("\nCSV");
prueba("comillas, ; y salto de línea dentro de comillas", () =>
  igual(L.parsearCsv('a;"b;c"\r\n1;"x""y\nz"', ";"), [["a", "b;c"], ["1", 'x"y\nz']]));
prueba("detecta tabulador", () => igual(L.detectarSeparador("a\tb\tc\n1\t2\t3").separador, "\t"));
prueba("respeta 'sep=|'", () => igual(L.detectarSeparador("sep=|\na|b").separador, "|"));
prueba("Windows-1252 (Ñ) se decodifica", () =>
  igual(L.decodificarTexto(Buffer.from("MUÑOZ", "latin1")), { texto: "MUÑOZ", codificacion: "windows-1252" }));
prueba("encabezados repetidos → COL, COL_1", () =>
  igual(L.matrizAObjetos([["A", "A"], ["1", "2"]]).encabezados, ["A", "A_1"]));

console.log("\nMapeo de columnas");
prueba("v0.1.0: 'DEUDA TOTAL' → monto_deuda", () => igual(M.resolverColumna("DEUDA TOTAL"), "monto_deuda"));
prueba("tildes y minúsculas: 'Teléfono' → fono1", () => igual(M.resolverColumna("Teléfono"), "fono1"));
prueba("TELEFONO + CELULAR → fono1 + fono2", () => igual(M.asignarCampos(["TELEFONO", "CELULAR"]), ["fono1", "fono2"]));
prueba("no se pierde el segundo teléfono al mapear filas", () =>
  igual(M.mapearFilas([{ TELEFONO: "911", CELULAR: "922" }]), [{ fono1: "911", fono2: "922" }]));

console.log("\nArchivos de ejemplo");
prueba("XLSX: 2 hojas, 40 + 15 filas", () => {
  const p = P.previsualizarArchivo(path.join(EJ, "cartera_ejemplo.xlsx"));
  igual(p.hojas.map((h) => h.totalFilas), [40, 15]);
});
prueba("CSV Excel Chile: ';' + windows-1252 + 1 fila sin RUT", () => {
  const p = P.previsualizarArchivo(path.join(EJ, "cartera_ejemplo_excel_cl.csv"));
  igual([p.separador, p.codificacion, p.hojas[0].totalFilas, p.hojas[0].filasSinRut], [";", "windows-1252", 31, 1]);
});
prueba("CSV UTF-8 con BOM y ','", () => {
  const p = P.previsualizarArchivo(path.join(EJ, "cartera_ejemplo_utf8.csv"));
  igual([p.separador, p.codificacion, p.hojas[0].columnas[0].campo], [",", "utf-8 (BOM)", "rut"]);
});
prueba("formato no soportado da error claro", () =>
  assert.throws(() => L.detectarFormato("cartera.pdf"), /Formato no soportado/));

console.log(`\n${ok} correctas, ${fallas.length} con falla\n`);
process.exit(fallas.length ? 1 : 0);
