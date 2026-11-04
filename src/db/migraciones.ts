/**
 * @file migraciones.ts
 * @description Actualiza bases SQLite creadas por versiones anteriores sin
 * perder datos. Cada paso es idempotente: se puede ejecutar en cada arranque.
 *
 * `schema.sql` ya trae todas las columnas para bases nuevas; aquí sólo se
 * agregan las que falten en bases antiguas, se crean los índices y se
 * completan datos derivados la primera vez.
 *
 * @since 0.3.0
 */
import Database from "better-sqlite3";

import { estadoInicialDesdeCategoria } from "../dominio/estados";

/** Versión del esquema que deja esta migración (PRAGMA user_version). */
export const VERSION_ESQUEMA = 4;

/** Columnas que pudieron no existir en bases de versiones anteriores. */
const COLUMNAS: Array<[tabla: string, columna: string, definicion: string]> = [
  ["importaciones", "archivo_hash", "TEXT"],
  ["telefonos", "estado_llamada", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
  ["telefonos", "intentos_llamada", "INTEGER NOT NULL DEFAULT 0"],
  ["telefonos", "ultima_llamada", "TEXT"],
  ["usuarios", "intentos_fallidos", "INTEGER NOT NULL DEFAULT 0"],
  ["usuarios", "bloqueado_hasta", "TEXT"],
  ["cartera_clientes", "estado_cobranza", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
  ["cartera_clientes", "fecha_compromiso", "TEXT"],
  ["cartera_clientes", "monto_compromiso", "REAL"],
  ["cartera_clientes", "proxima_gestion", "TEXT"],
  ["cartera_clientes", "ultima_gestion", "TEXT"],
  ["cartera_clientes", "monto_recuperado", "REAL NOT NULL DEFAULT 0"],
  ["gestiones", "tipo", "TEXT NOT NULL DEFAULT 'comentario'"],
  ["gestiones", "estado_anterior", "TEXT"],
  ["gestiones", "estado_nuevo", "TEXT"],
  ["gestiones", "monto", "REAL"],
  ["gestiones", "fecha_compromiso", "TEXT"],
  ["gestiones", "telefono", "TEXT"],
  ["gestiones", "duracion", "INTEGER"],
  ["gestiones", "motivo_llamada", "TEXT"],
];

const INDICES = [
  "CREATE INDEX IF NOT EXISTS idx_importaciones_hash ON importaciones(cartera_id, archivo_hash)",
  "CREATE INDEX IF NOT EXISTS idx_importaciones_cartera ON importaciones(cartera_id)",
  "CREATE INDEX IF NOT EXISTS idx_clientes_rut ON clientes(rut)",
  "CREATE INDEX IF NOT EXISTS idx_operaciones_cliente_periodo ON operaciones(cliente_id, periodo_id)",
  "CREATE INDEX IF NOT EXISTS idx_operaciones_periodo ON operaciones(periodo_id)",
  "CREATE INDEX IF NOT EXISTS idx_telefonos_cliente ON telefonos(cliente_id)",
  "CREATE INDEX IF NOT EXISTS idx_correos_cliente ON correos(cliente_id)",
  "CREATE INDEX IF NOT EXISTS idx_direcciones_cliente ON direcciones(cliente_id)",
  "CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente ON vehiculos(cliente_id)",
  "CREATE INDEX IF NOT EXISTS idx_cartera_clientes_cartera ON cartera_clientes(cartera_id, estado_cobranza)",
  "CREATE INDEX IF NOT EXISTS idx_cartera_clientes_cliente ON cartera_clientes(cliente_id)",
  "CREATE INDEX IF NOT EXISTS idx_gestiones_cliente ON gestiones(cliente_id, cartera_id, fecha)",
  "CREATE INDEX IF NOT EXISTS idx_gestiones_cartera ON gestiones(cartera_id, fecha)",
  "CREATE INDEX IF NOT EXISTS idx_reportes_usuario ON reportes_mensuales(usuario_id, periodo_id)",
  "CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones_log(usuario_id, inicio)",
  "CREATE INDEX IF NOT EXISTS idx_recordatorios_pendientes ON recordatorios(cartera_id, estado, fecha_hora)",
  "CREATE INDEX IF NOT EXISTS idx_recordatorios_cliente ON recordatorios(cliente_id, estado)",
];

/** Nombres de las columnas actuales de una tabla. */
function columnasDe(db: Database.Database, tabla: string): Set<string> {
  const filas = db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>;
  return new Set(filas.map((f) => f.name));
}

/**
 * Aplica todas las migraciones pendientes.
 * @param db Conexión recién abierta (con `schema.sql` ya ejecutado).
 */
export function aplicarMigraciones(db: Database.Database): void {
  const agregadas = new Set<string>();

  db.transaction(() => {
    for (const [tabla, columna, definicion] of COLUMNAS) {
      if (!columnasDe(db, tabla).has(columna)) {
        db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
        agregadas.add(`${tabla}.${columna}`);
      }
    }
    for (const sql of INDICES) db.exec(sql);

    // Primera vez con estados ejecutivos: se parte desde la categoría que
    // traía el Excel (ej. "pago realizado" → PAGADO).
    if (agregadas.has("cartera_clientes.estado_cobranza")) {
      const filas = db.prepare("SELECT id, categoria_gestion FROM cartera_clientes").all() as Array<{
        id: string;
        categoria_gestion: string | null;
      }>;
      const actualizar = db.prepare("UPDATE cartera_clientes SET estado_cobranza = ? WHERE id = ?");
      for (const f of filas) actualizar.run(estadoInicialDesdeCategoria(f.categoria_gestion), f.id);
    }

    // Las llamadas del prototipo se guardaban con categoria = 'llamada'.
    if (agregadas.has("gestiones.tipo")) {
      db.exec("UPDATE gestiones SET tipo = 'llamada' WHERE categoria = 'llamada'");
    }

    // Llamadas ya cerradas antes de existir el motivo.
    if (agregadas.has("gestiones.motivo_llamada")) {
      db.exec(`UPDATE gestiones SET motivo_llamada = CASE resultado WHEN 'contestada' THEN 'contestada' ELSE 'no_contesta' END
                WHERE tipo = 'llamada' AND resultado IN ('contestada', 'no contesta')`);
    }

    db.pragma(`user_version = ${VERSION_ESQUEMA}`);
  })();
}
