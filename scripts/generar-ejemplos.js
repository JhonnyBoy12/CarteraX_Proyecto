/**
 * Genera archivos de ejemplo (datos FICTICIOS) en ./ejemplos para probar el
 * cargador sin usar carteras reales:
 *  - cartera_ejemplo.xlsx        2 hojas, columnas del formato real del banco
 *  - cartera_ejemplo_excel_cl.csv  ; + Windows-1252 + $1.234.567 + dd/mm/aaaa
 *  - cartera_ejemplo_utf8.csv      , + UTF-8 con BOM + RUT con guion
 *
 * Uso: node scripts/generar-ejemplos.js
 * @since 0.2.0
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const salida = path.join(__dirname, "..", "ejemplos");
fs.mkdirSync(salida, { recursive: true });

const nombres = ["ANA MUÑOZ ROJAS", "PEDRO SOTO DÍAZ", "CAMILA NÚÑEZ PIZARRO", "JORGE ARAYA FUENTES", "VALENTINA PEÑA LAGOS",
  "RODRIGO CASTRO VERA", "FERNANDA TORO ORTIZ", "MATÍAS REYES SILVA", "JAVIERA CONTRERAS MORA", "DIEGO HERRERA PAZ",
  "CONSTANZA VIDAL RÍOS", "SEBASTIÁN FLORES ROA", "IGNACIA MOLINA CID", "TOMÁS SEPÚLVEDA LARA"];
const gestiones = ["Cliente paga cuota de julio", "Compromiso de pago para el 15", "Sin contacto, no da respuesta",
  "Titular entrevistado, recibe informacion", "Se envía simulación de reconducción", "Buzón de voz", null];
const tramos = ["1-30", "31-60", "61-90", "91-180", "181-360", "+360"];
const comunas = ["SANTIAGO", "MAIPÚ", "PUENTE ALTO", "ÑUÑOA", "LA FLORIDA", "VALPARAÍSO"];

let semilla = 7;
const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280);
const elegir = (arr) => arr[Math.floor(azar() * arr.length)];

function cliente(i) {
  const rut = 10_000_000 + Math.floor(azar() * 15_000_000);
  const pactadas = 24 + Math.floor(azar() * 36);
  const anio = 2022 + Math.floor(azar() * 3);
  const mes = 1 + Math.floor(azar() * 12);
  return {
    rut, dv: elegir(["1", "2", "5", "7", "9", "K"]), nombre: nombres[i % nombres.length],
    deuda: Math.round((300_000 + azar() * 14_000_000) / 100) * 100, pactadas,
    pagadas: Math.floor(azar() * pactadas), morosas: 1 + Math.floor(azar() * 8),
    vcto: anio * 10000 + mes * 100 + 10, gestion: elegir(gestiones), tramo: elegir(tramos),
    fono: "9" + String(10_000_000 + Math.floor(azar() * 89_999_999)).slice(0, 8),
    fono2: azar() > 0.5 ? "22" + String(1_000_000 + Math.floor(azar() * 8_999_999)) : null,
    correo: azar() > 0.4 ? `cliente${i}@correo.cl` : null, comuna: elegir(comunas),
  };
}

// ---------------- XLSX con el formato de columnas real ----------------
const hojaXlsx = (desde, n) =>
  Array.from({ length: n }, (_, k) => {
    const c = cliente(desde + k);
    return {
      RUT: c.rut, DDAS_DRT_PPAL: c.dv, NOMBRE: c.nombre, "DEUDA TOTAL": c.deuda, GESTION: c.gestion,
      TRAMO_MORA: c.tramo, DDAS_NROCUO_PACTADAS: c.pactadas, DDAS_NROCUO_PAGADAS: c.pagadas,
      DDAS_NROCUO_MOROSAS: c.morosas, DDAS_FEC_1ER_VCTO: c.vcto, DDAS_FEC_ULT_PAGO: 0,
      MARCA: elegir(["KIA", "CHEVROLET", "SUZUKI", "NISSAN"]), PATENTE: "XX" + (1000 + k), COMUNA1: c.comuna,
      FONO1: c.fono, FONO2: c.fono2, CORREO_1: c.correo, OBSERVACION_INTERNA: "columna no mapeada",
    };
  });
const libro = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hojaXlsx(0, 40)), "CARTERA");
XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hojaXlsx(40, 15)), "RECO OTROS");
XLSX.writeFile(libro, path.join(salida, "cartera_ejemplo.xlsx"));

// ---------------- CSV estilo Excel Chile (; y Windows-1252) ----------------
const filasCl = ["RUT;Nombre Cliente;Deuda;Teléfono;Celular;Email;Gestión;Tramo Mora;DDAS_FEC_1ER_VCTO;Comuna"];
for (let i = 0; i < 30; i++) {
  const c = cliente(100 + i);
  const rutFmt = c.rut.toLocaleString("es-CL") + "-" + c.dv;
  const v = String(c.vcto);
  filasCl.push([
    rutFmt, c.nombre, "$ " + c.deuda.toLocaleString("es-CL"), c.fono2 ? "+56 " + c.fono2 : "", c.fono, c.correo ?? "",
    c.gestion ? `"${c.gestion}; seguimiento"` : "", c.tramo, `${v.slice(6)}/${v.slice(4, 6)}/${v.slice(0, 4)}`, c.comuna,
  ].join(";"));
}
filasCl.push(";;;;;;;;;"); // fila vacía típica de Excel
filasCl.push(";SIN RUT;$ 10.000;;;;;;;"); // fila sin RUT → error esperado
const latin1 = Buffer.from(filasCl.join("\r\n"), "latin1");
fs.writeFileSync(path.join(salida, "cartera_ejemplo_excel_cl.csv"), latin1);

// ---------------- CSV UTF-8 con BOM y coma ----------------
const filasUtf = ["rut,nombre,deuda_total,fono1,correo_1,gestion,tramo_mora,DDAS_FEC_1ER_VCTO"];
for (let i = 0; i < 12; i++) {
  const c = cliente(200 + i);
  filasUtf.push([`${c.rut}-${c.dv}`, `"${c.nombre}"`, c.deuda, c.fono, c.correo ?? "", `"${c.gestion ?? ""}"`, c.tramo, c.vcto].join(","));
}
fs.writeFileSync(path.join(salida, "cartera_ejemplo_utf8.csv"), "\uFEFF" + filasUtf.join("\n"), "utf-8");

console.log("Ejemplos generados en", salida);
