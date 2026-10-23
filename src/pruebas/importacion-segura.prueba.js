/**
 * Protección de integridad: una importación sin RUT utilizable no debe borrar
 * la cartera existente del período seleccionado.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { importarArchivo } = require('../dist/importacion/importador');

const db = new Database(':memory:');
const schema = fs.readFileSync(path.join(__dirname, '..', 'dist', 'db', 'schema.sql'), 'utf8');
db.pragma('foreign_keys = ON');
db.exec(schema);

db.prepare(`INSERT INTO usuarios (id, nombre, apellido, email, password_hash)
  VALUES ('ejecutivo-local', 'Ejecutivo', 'Local', 'ejecutivo.local@carterax.local', 'PENDIENTE_LOGIN')`).run();
db.prepare(`INSERT INTO periodos (id, nombre, fecha_inicio, fecha_fin)
  VALUES ('2026-09', '2026-09', '2026-09-01', '2026-09-30')`).run();
db.prepare(`INSERT INTO carteras (id, usuario_id, periodo_id, nombre)
  VALUES ('cartera-ejecutivo-local-2026-09', 'ejecutivo-local', '2026-09', 'Cartera 2026-09')`).run();
db.prepare(`INSERT INTO clientes (id, rut, dv, nombre) VALUES ('cliente-existente', '12345678', '9', 'Cliente Conservado')`).run();
db.prepare(`INSERT INTO cartera_clientes (id, cartera_id, cliente_id, categoria_gestion, texto_gestion)
  VALUES ('cc-existente', 'cartera-ejecutivo-local-2026-09', 'cliente-existente', 'contactado', 'Seguimiento previo')`).run();

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'carterax-importacion-segura-'));
const archivo = path.join(carpeta, 'cartera_sin_rut.csv');
fs.writeFileSync(archivo, 'RUT;NOMBRE\n;Fila sin RUT\nABC;RUT inválido\n', 'utf8');

try {
  assert.throws(
    () => importarArchivo(db, archivo, null, undefined, '2026-09'),
    /no se encontró ninguna fila con un RUT utilizable/i,
    'Debe cancelar la importación antes de tocar la cartera.'
  );
  const conservado = db.prepare(`SELECT COUNT(*) AS total FROM cartera_clientes WHERE id = 'cc-existente'`).get();
  assert.strictEqual(conservado.total, 1, 'El cliente anterior debe seguir en la cartera.');
  console.log('  ✔ Importación sin RUT utilizable no modifica la cartera existente');
} finally {
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
}
