/**
 * Genera una cartera de ejemplo (datos FICTICIOS) con TODAS las columnas que
 * reconoce el importador, para ver la ficha del cliente completa:
 *  - RUT con dígito verificador válido (la revisión de datos queda limpia)
 *  - días de mora variados (desde DDAS_FEC_1ER_VCTO) y tramo coherente
 *  - cuotas pactadas / pagadas / morosas, monto de cuota, último pago
 *  - vehículo (marca, modelo, patente), dirección, hasta 4 teléfonos y 3 correos
 *  - clientes con dos operaciones, gestión previa, red, concesionario y juicio
 *
 * Salida: ejemplos/cartera_ficha_completa.xlsx y ejemplos/cartera_ficha_completa.csv
 * Uso:    node scripts/generar-ejemplo-ficha.js
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const salida = path.join(__dirname, "..", "ejemplos");
fs.mkdirSync(salida, { recursive: true });

let semilla = 41;
const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280);
const elegir = (arr) => arr[Math.floor(azar() * arr.length)];
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));

/** Dígito verificador chileno (módulo 11). */
function dv(rut) {
  let suma = 0;
  let factor = 2;
  for (const d of String(rut).split("").reverse()) {
    suma += Number(d) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

/** Fecha AAAAMMDD a `dias` días de hoy (negativo = en el pasado). */
function aaaammdd(dias) {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return f.getFullYear() * 10000 + (f.getMonth() + 1) * 100 + f.getDate();
}

function tramo(diasMora) {
  if (diasMora <= 30) return "1-30";
  if (diasMora <= 60) return "31-60";
  if (diasMora <= 90) return "61-90";
  if (diasMora <= 180) return "91-180";
  if (diasMora <= 360) return "181-360";
  return "+360";
}

const personas = [
  "FRANCISCA ALARCÓN BRAVO", "CRISTÓBAL GUZMÁN ESPINOZA", "MARÍA JOSÉ VALENZUELA TAPIA", "BENJAMÍN FUENTES SAAVEDRA",
  "ANTONIA CÁCERES MEDINA", "VICENTE ROJAS ORELLANA", "CATALINA PIZARRO SOTO", "JOAQUÍN MUÑOZ CARRASCO",
  "ISIDORA HERNÁNDEZ VERA", "AGUSTÍN LÓPEZ CORNEJO", "TRINIDAD SALINAS FARÍAS", "MARTÍN ARAYA GALLARDO",
  "EMILIA NAVARRO RIQUELME", "LUCAS SEPÚLVEDA OLIVARES", "JOSEFA CASTILLO MORALES", "TOMÁS ESPINOZA PARRA",
  "AMANDA REYES CONTRERAS", "MAXIMILIANO VEGA SANDOVAL", "FLORENCIA MORALES ÁLVAREZ", "GASPAR TORRES BUSTOS",
];
const vehiculos = [
  ["KIA", "MORNING"], ["CHEVROLET", "SAIL"], ["SUZUKI", "SWIFT"], ["NISSAN", "VERSA"], ["HYUNDAI", "ACCENT"],
  ["TOYOTA", "YARIS"], ["MAZDA", "3"], ["PEUGEOT", "208"], ["MG", "ZS"], ["CHERY", "TIGGO 2"],
];
const calles = ["AV. PAJARITOS", "LOS CARRERA", "AV. VICUÑA MACKENNA", "IRARRÁZAVAL", "SANTA ROSA", "AV. ARGENTINA", "GRAN AVENIDA"];
const comunas = ["MAIPÚ", "PUENTE ALTO", "ÑUÑOA", "LA FLORIDA", "SANTIAGO", "VALPARAÍSO", "SAN BERNARDO", "CONCEPCIÓN"];
const gestiones = [
  "Cliente indica que paga el 5 del próximo mes", "Compromiso de pago para el 15", "Sin contacto, buzón de voz",
  "Titular entrevistado, solicita simulación de repactación", "Reclama cobro de seguro no contratado",
  "Cliente paga cuota atrasada por transferencia", "Número equivocado, contesta un tercero", null,
];
const redes = ["RED NORTE", "RED CENTRO", "RED SUR"];
const concesionarios = ["AUTOMOTORA PROVIDENCIA", "DERCO CENTER MAIPÚ", "AUTOMOTRIZ DEL SUR", "KOVACS FLORIDA"];
const coordinadores = ["P. GÓMEZ", "L. FERNÁNDEZ", "R. SILVA"];
const tribunales = ["1° JUZGADO CIVIL DE SANTIAGO", "2° JUZGADO CIVIL DE PUENTE ALTO", "JUZGADO CIVIL DE SAN BERNARDO"];

/** Días de mora pensados para cubrir todos los tramos. */
const MORAS = [12, 25, 38, 55, 72, 88, 104, 150, 175, 210, 260, 330, 390, 480, 610, 750, 45, 95, 15, 520];

const filas = [];
personas.forEach((nombre, i) => {
  const rut = 9_000_000 + entre(0, 16_000_000);
  const [marca, modelo] = vehiculos[i % vehiculos.length];
  const patente = String.fromCharCode(66 + (i % 20), 67 + ((i * 3) % 20), 68 + ((i * 7) % 20), 70 + ((i * 5) % 18)) + String(10 + entre(0, 89));
  const fonos = [
    "9" + String(entre(10_000_000, 99_999_999)),
    azar() > 0.25 ? "9" + String(entre(10_000_000, 99_999_999)) : "",
    azar() > 0.5 ? "22" + String(entre(1_000_000, 9_999_999)) : "",
    azar() > 0.75 ? "9" + String(entre(10_000_000, 99_999_999)) : "",
  ];
  const usuario = nombre.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const correos = [`${usuario}.${i}@correo.cl`, azar() > 0.5 ? `${usuario}${i}@gmail.com` : "", azar() > 0.8 ? `${usuario}@empresa.cl` : ""];
  const juicio = i % 6 === 5;
  // Uno de cada cuatro clientes tiene dos créditos (dos operaciones).
  const nOperaciones = i % 4 === 1 ? 2 : 1;

  for (let k = 0; k < nOperaciones; k++) {
    const diasMora = k === 0 ? MORAS[i % MORAS.length] : Math.max(5, Math.round(MORAS[i % MORAS.length] / 3));
    const pactadas = elegir([24, 36, 48, 60]);
    const morosas = Math.max(1, Math.round(diasMora / 30));
    const pagadas = Math.max(0, Math.min(pactadas - morosas, entre(2, pactadas - 2)));
    const cuota = Math.round(entre(120_000, 480_000) / 100) * 100;
    const deuda = cuota * morosas + Math.round((pactadas - pagadas - morosas) * cuota * 0.55);
    filas.push({
      RUT: rut,
      DDAS_DRT_PPAL: dv(rut),
      NOMBRE: nombre,
      OPERACION: `${700000 + i * 10 + k}`,
      "DEUDA TOTAL": deuda,
      CUOTA: cuota,
      CONTENIDO: Math.round(deuda * 0.82),
      GESTION: k === 0 ? elegir(gestiones) : "Segundo crédito del cliente, al día hasta hace poco",
      TRAMO_MORA: tramo(diasMora),
      CICLO: tramo(diasMora),
      DDAS_NROCUO_PACTADAS: pactadas,
      DDAS_NROCUO_PAGADAS: pagadas,
      DDAS_NROCUO_MOROSAS: morosas,
      DDAS_FEC_OTOR_CDTO: aaaammdd(-30 * (pagadas + morosas) - 25),
      DDAS_FEC_1ER_VCTO: aaaammdd(-diasMora),
      DDAS_FEC_ULT_PAGO: pagadas > 0 ? aaaammdd(-diasMora - entre(1, 20)) : 0,
      MARCA: marca,
      MODELO: modelo,
      PATENTE: patente,
      CALLE1: elegir(calles),
      NUMERO1: entre(100, 9800),
      COMUNA1: comunas[i % comunas.length],
      RED: elegir(redes),
      COORDINADOR: elegir(coordinadores),
      CONCESIONARIO: elegir(concesionarios),
      ESTADO_JUICIO: juicio ? "DEMANDA PRESENTADA" : "",
      ROL: juicio ? `C-${entre(1000, 9999)}-2025` : "",
      TRIBUNAL: juicio ? elegir(tribunales) : "",
      FONO1: fonos[0],
      FONO2: fonos[1],
      FONO3: fonos[2],
      FONO4: fonos[3],
      CORREO_1: correos[0],
      CORREO_2: correos[1],
      CORREO_3: correos[2],
    });
  }
});

const libro = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), "CARTERA");
XLSX.writeFile(libro, path.join(salida, "cartera_ficha_completa.xlsx"));

// Mismo contenido en CSV UTF-8 con BOM (se abre bien en Excel).
const columnas = Object.keys(filas[0]);
const celda = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
const csv = [columnas.join(","), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(","))].join("\n");
fs.writeFileSync(path.join(salida, "cartera_ficha_completa.csv"), "﻿" + csv, "utf-8");

console.log(`${filas.length} operaciones de ${personas.length} clientes en ${salida}`);
