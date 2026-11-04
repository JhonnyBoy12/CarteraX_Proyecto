-- =====================================================================
-- CarteraX Phoenix — esquema SQLite local (v0.3.0)
--
-- Se ejecuta en cada arranque (CREATE ... IF NOT EXISTS). Las columnas
-- agregadas en versiones posteriores a una tabla existente se crean en
-- db/migraciones.ts, para que las bases antiguas se actualicen sin perder
-- datos.
--
-- Modelo de trabajo:
--   usuario (ejecutivo) ─┬─ cartera por período (mes) ── cartera_clientes
--                        │        (estado de cobranza, compromiso, montos)
--                        └─ reportes_mensuales (fotografías congeladas)
--   clientes ── operaciones (por período), teléfonos, correos, direcciones,
--               vehículos y gestiones (historial de cada caso)
-- =====================================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    ultimo_acceso TEXT,
    intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RF-06: inicio y cierre de cada sesión.
CREATE TABLE IF NOT EXISTS sesiones_log (
    id TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL,
    inicio TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fin TEXT,
    motivo_fin TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- Un período es un mes de gestión (id = 'AAAA-MM').
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

-- Un cliente dentro de la cartera de un mes. `estado_cobranza` es el
-- estado ejecutivo (ver dominio/estados.ts); `estado` es la columna
-- heredada del prototipo y ya no se usa.
CREATE TABLE IF NOT EXISTS cartera_clientes (
    id TEXT PRIMARY KEY,
    cartera_id TEXT NOT NULL,
    cliente_id TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','EN_GESTION','CONTACTADO','NO_CONTACTADO','COMPROMISO','CERRADO')),
    categoria_gestion TEXT,
    texto_gestion TEXT,
    estado_cobranza TEXT NOT NULL DEFAULT 'PENDIENTE',
    fecha_compromiso TEXT,
    monto_compromiso REAL,
    proxima_gestion TEXT,
    ultima_gestion TEXT,
    monto_recuperado REAL NOT NULL DEFAULT 0,
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

-- Historial del caso (RF-18, RF-33). `tipo`:
--   comentario | cambio_estado | llamada
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
    tipo TEXT NOT NULL DEFAULT 'comentario',
    estado_anterior TEXT,
    estado_nuevo TEXT,
    monto REAL,
    fecha_compromiso TEXT,
    telefono TEXT,
    duracion INTEGER,
    -- Llamadas: contestada | no_contesta | ocupado | rechazada | apagado | inexistente | cortada
    motivo_llamada TEXT,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (cartera_id) REFERENCES carteras(id)
);

-- Recordatorios de vuelta de gestión (v0.3.1). Se crean al registrar una
-- gestión según el estado (dominio/estados.ts → recordatorio) o con la hora
-- que elija el ejecutivo. `fecha_hora` es hora LOCAL 'AAAA-MM-DDTHH:MM'.
-- Una gestión nueva sobre el cliente da por cumplidos los pendientes.
CREATE TABLE IF NOT EXISTS recordatorios (
    id TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL,
    cartera_id TEXT NOT NULL,
    cliente_id TEXT NOT NULL,
    fecha_hora TEXT NOT NULL,
    motivo TEXT NOT NULL,
    estado_origen TEXT,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','HECHO','DESCARTADO')),
    avisado INTEGER NOT NULL DEFAULT 0 CHECK (avisado IN (0, 1)),
    creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resuelto_en TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (cartera_id) REFERENCES carteras(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);

-- Fotografía congelada de un mes (RF-25): KPIs, gráficos y detalle de
-- clientes en JSON, para consultar y descargar meses anteriores aunque la
-- cartera cambie después.
CREATE TABLE IF NOT EXISTS reportes_mensuales (
    id TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL,
    periodo_id TEXT NOT NULL,
    titulo TEXT NOT NULL,
    automatico INTEGER NOT NULL DEFAULT 0 CHECK (automatico IN (0, 1)),
    notas TEXT,
    deuda_total REAL NOT NULL DEFAULT 0,
    recuperado REAL NOT NULL DEFAULT 0,
    clientes INTEGER NOT NULL DEFAULT 0,
    datos TEXT NOT NULL,
    generado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (periodo_id) REFERENCES periodos(id)
);

CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT,
    actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
);

-- La vista del prototipo mezclaba todos los meses; se reemplaza por
-- consultas acotadas al período en servicios/servicioCartera.ts.
DROP VIEW IF EXISTS v_clientes_resumen;
