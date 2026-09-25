--- Creación de tabla usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,

    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL,

    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,

    activo INTEGER NOT NULL DEFAULT 1
        CHECK (activo IN (0, 1)),

    ultimo_acceso TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

----Creación de tabla periodos

CREATE TABLE IF NOT EXISTS periodos (
    id TEXT PRIMARY KEY,

    nombre TEXT NOT NULL,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,

    activo INTEGER NOT NULL DEFAULT 1
        CHECK (activo IN (0, 1)),

    created_at TEXT NOT NULL,

    CHECK (fecha_fin >= fecha_inicio)
);

---- Creación tabala clientes

CREATE TABLE IF NOT EXISTS clientes (
    id TEXT PRIMARY KEY,

    rut TEXT NOT NULL,
    dv TEXT,
    nombre TEXT NOT NULL,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    UNIQUE (rut, dv)
);

--- Creación de tabla operaciones
---- Aquí relacionamos al cliente con su crédito/deuda y con el período correspondiente.
CREATE TABLE IF NOT EXISTS operaciones (
    id TEXT PRIMARY KEY,

    cliente_id TEXT NOT NULL,
    periodo_id TEXT NOT NULL,

    numero_operacion TEXT NOT NULL,

    deuda_total INTEGER NOT NULL DEFAULT 0,
    monto_cuota INTEGER,
    cuotas_pactadas INTEGER,
    cuotas_pagadas INTEGER,

    dias_mora INTEGER,
    tramo_mora TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (cliente_id)
        REFERENCES clientes(id),

    FOREIGN KEY (periodo_id)
        REFERENCES periodos(id),

    UNIQUE (numero_operacion, periodo_id)
);


----Tabla Telefono enfocado en Cola de llamada

CREATE TABLE IF NOT EXISTS telefonos (
    id TEXT PRIMARY KEY,

    cliente_id TEXT NOT NULL,

    numero TEXT NOT NULL,
    tipo TEXT,

    valido INTEGER NOT NULL DEFAULT 1
        CHECK (valido IN (0, 1)),

    prioridad INTEGER NOT NULL DEFAULT 1,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (cliente_id)
        REFERENCES clientes(id),

    UNIQUE (cliente_id, numero)
);

--- TABLA CARTERAS
CREATE TABLE IF NOT EXISTS carteras (
    id TEXT PRIMARY KEY,

    usuario_id TEXT NOT NULL,
    periodo_id TEXT NOT NULL,

    nombre TEXT NOT NULL,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id),

    FOREIGN KEY (periodo_id)
        REFERENCES periodos(id),

    UNIQUE (usuario_id, periodo_id)
);

----TABLA CARTERA_CLIENTES

CREATE TABLE IF NOT EXISTS cartera_clientes (
    id TEXT PRIMARY KEY,

    cartera_id TEXT NOT NULL,
    cliente_id TEXT NOT NULL,

    estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (
            estado IN (
                'PENDIENTE',
                'EN_GESTION',
                'CONTACTADO',
                'NO_CONTACTADO',
                'COMPROMISO',
                'CERRADO'
            )
        ),

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (cartera_id)
        REFERENCES carteras(id),

    FOREIGN KEY (cliente_id)
        REFERENCES clientes(id),

    UNIQUE (cartera_id, cliente_id)
);