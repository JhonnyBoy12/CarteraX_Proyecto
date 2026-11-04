-- =========================================================
-- CARTERAX - ESQUEMA NORMALIZADO DEL PROTOTIPO DE INTEGRACION
-- =========================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    ultimo_acceso TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS periodos (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (fecha_fin >= fecha_inicio)
);

CREATE TABLE IF NOT EXISTS clientes (
    id TEXT PRIMARY KEY,
    rut TEXT NOT NULL,
    dv TEXT,
    nombre TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rut, dv)
);

CREATE TABLE IF NOT EXISTS operaciones (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    periodo_id TEXT NOT NULL,
    numero_operacion TEXT NOT NULL,
    deuda_total REAL NOT NULL DEFAULT 0,
    monto_contenido REAL,
    monto_cuota REAL,
    cuotas_pactadas INTEGER,
    cuotas_pagadas INTEGER,
    cuotas_morosas INTEGER,
    fecha_otorgamiento TEXT,
    fecha_primer_vencimiento TEXT,
    fecha_ultimo_pago TEXT,
    dias_mora INTEGER,
    tramo_mora TEXT,
    pct_recuperacion REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (periodo_id) REFERENCES periodos(id),
    UNIQUE (numero_operacion, periodo_id)
);

CREATE TABLE IF NOT EXISTS telefonos (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    numero TEXT NOT NULL,
    tipo TEXT,
    valido INTEGER NOT NULL DEFAULT 1 CHECK (valido IN (0, 1)),
    prioridad INTEGER NOT NULL DEFAULT 1,
    estado_llamada TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado_llamada IN ('PENDIENTE','ENVIADA','NO_CONTESTA','CONTACTADO','INVALIDO')),
    intentos_llamada INTEGER NOT NULL DEFAULT 0,
    ultima_llamada TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    UNIQUE (cliente_id, numero)
);

CREATE TABLE IF NOT EXISTS correos (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    correo TEXT NOT NULL,
    valido INTEGER NOT NULL DEFAULT 1 CHECK (valido IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    UNIQUE (cliente_id, correo)
);

CREATE TABLE IF NOT EXISTS direcciones (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    direccion TEXT NOT NULL,
    comuna TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    UNIQUE (cliente_id, direccion, comuna)
);

CREATE TABLE IF NOT EXISTS vehiculos (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    marca TEXT,
    modelo TEXT,
    patente TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    UNIQUE (cliente_id, patente)
);

CREATE TABLE IF NOT EXISTS carteras (
    id TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL,
    periodo_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (periodo_id) REFERENCES periodos(id),
    UNIQUE (usuario_id, periodo_id)
);

CREATE TABLE IF NOT EXISTS cartera_clientes (
    id TEXT PRIMARY KEY,
    cartera_id TEXT NOT NULL,
    cliente_id TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','EN_GESTION','CONTACTADO','NO_CONTACTADO','COMPROMISO','CERRADO')),
    categoria_gestion TEXT,
    texto_gestion TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cartera_id) REFERENCES carteras(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
    UNIQUE (cartera_id, cliente_id)
);

CREATE TABLE IF NOT EXISTS importaciones (
    id TEXT PRIMARY KEY,
    cartera_id TEXT NOT NULL,
    nombre_archivo TEXT NOT NULL,
    archivo_hash TEXT,
    hoja_nombre TEXT,
    fecha_importacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_registros INTEGER NOT NULL DEFAULT 0 CHECK (total_registros >= 0),
    registros_importados INTEGER NOT NULL DEFAULT 0 CHECK (registros_importados >= 0),
    registros_corregidos INTEGER NOT NULL DEFAULT 0 CHECK (registros_corregidos >= 0),
    registros_rechazados INTEGER NOT NULL DEFAULT 0 CHECK (registros_rechazados >= 0),
    estado TEXT NOT NULL DEFAULT 'PROCESANDO'
        CHECK (estado IN ('PROCESANDO','COMPLETADA','COMPLETADA_CON_ERRORES','FALLIDA')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cartera_id) REFERENCES carteras(id)
);

CREATE TABLE IF NOT EXISTS errores_importacion (
    id TEXT PRIMARY KEY,
    importacion_id TEXT NOT NULL,
    numero_fila INTEGER,
    campo TEXT,
    valor_original TEXT,
    descripcion TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (importacion_id) REFERENCES importaciones(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gestiones (
    id TEXT PRIMARY KEY,
    cliente_id TEXT,
    usuario_id TEXT,
    cartera_id TEXT,
    fecha TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    texto_libre TEXT,
    categoria TEXT,
    resultado TEXT,
    proxima_accion TEXT,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (cartera_id) REFERENCES carteras(id)
);

CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT,
    actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_importaciones_hash ON importaciones(cartera_id, archivo_hash);
CREATE INDEX IF NOT EXISTS idx_clientes_rut ON clientes(rut);
CREATE INDEX IF NOT EXISTS idx_operaciones_cliente ON operaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_periodo ON operaciones(periodo_id);
CREATE INDEX IF NOT EXISTS idx_telefonos_cliente ON telefonos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_correos_cliente ON correos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cartera_clientes_cartera ON cartera_clientes(cartera_id);
CREATE INDEX IF NOT EXISTS idx_cartera_clientes_cliente ON cartera_clientes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_importaciones_cartera ON importaciones(cartera_id);
CREATE INDEX IF NOT EXISTS idx_gestiones_cliente ON gestiones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_gestiones_categoria ON gestiones(categoria);

-- Vista de compatibilidad para el panel heredado del piloto. Mantiene la UI
-- desacoplada del detalle normalizado de operaciones y cartera.
CREATE VIEW IF NOT EXISTS v_clientes_resumen AS
SELECT
    c.id,
    c.rut,
    c.dv,
    c.nombre AS nombre_cliente,
    COALESCE(SUM(o.deuda_total), 0) AS monto_deuda,
    MAX(o.dias_mora) AS dias_mora,
    MAX(o.tramo_mora) AS tramo_mora,
    AVG(o.pct_recuperacion) AS pct_recuperacion,
    MAX(cc.categoria_gestion) AS categoria_gestion,
    MAX(d.comuna) AS comuna,
    MAX(i.nombre_archivo) AS origen_archivo
FROM clientes c
LEFT JOIN operaciones o ON o.cliente_id = c.id
LEFT JOIN cartera_clientes cc ON cc.cliente_id = c.id
LEFT JOIN direcciones d ON d.cliente_id = c.id
LEFT JOIN importaciones i ON i.cartera_id = cc.cartera_id
GROUP BY c.id, c.rut, c.dv, c.nombre;
