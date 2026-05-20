-- ============================================================
--  NEXORA — Schema para Supabase (PostgreSQL)
--  Ejecutar este archivo en: Supabase > SQL Editor > New query
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id         BIGSERIAL PRIMARY KEY,
  dni        TEXT UNIQUE NOT NULL,
  nombre     TEXT NOT NULL,
  password   TEXT NOT NULL,
  rol        TEXT DEFAULT 'worker',
  tipo       TEXT DEFAULT 'planilla',
  empresa    TEXT DEFAULT '',
  ruc        TEXT DEFAULT '',
  email      TEXT DEFAULT '',
  telefono   TEXT DEFAULT '',
  activo     INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asistencia (
  id                 BIGSERIAL PRIMARY KEY,
  usuario_id         BIGINT NOT NULL REFERENCES usuarios(id),
  fecha              TEXT NOT NULL,
  hora_entrada       TEXT,
  hora_salida        TEXT,
  lat_entrada        REAL,
  lng_entrada        REAL,
  direccion_entrada  TEXT DEFAULT '',
  lat_salida         REAL,
  lng_salida         REAL,
  direccion_salida   TEXT DEFAULT '',
  estado             TEXT DEFAULT 'activo',
  notas              TEXT DEFAULT '',
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reembolsos (
  id                BIGSERIAL PRIMARY KEY,
  usuario_id        BIGINT NOT NULL REFERENCES usuarios(id),
  fecha             TEXT NOT NULL,
  concepto          TEXT NOT NULL,
  monto             REAL NOT NULL,
  ruc_proveedor     TEXT DEFAULT '',
  nombre_proveedor  TEXT DEFAULT '',
  tipo_comprobante  TEXT DEFAULT '',
  numero_documento  TEXT DEFAULT '',
  estado            TEXT DEFAULT 'pending',
  archivos          TEXT DEFAULT '[]',
  notas             TEXT DEFAULT '',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documentos (
  id             BIGSERIAL PRIMARY KEY,
  usuario_id     BIGINT NOT NULL REFERENCES usuarios(id),
  tipo           TEXT NOT NULL,
  titulo         TEXT NOT NULL,
  periodo        TEXT DEFAULT '',
  nombre_archivo TEXT NOT NULL,
  tamano         TEXT DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS empresas_drive (
  id             BIGSERIAL PRIMARY KEY,
  nombre_empresa TEXT NOT NULL,
  ruc            TEXT DEFAULT '',
  gmail_drive    TEXT DEFAULT '',
  ruta_onedrive  TEXT DEFAULT '',
  activo         INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT DEFAULT ''
);

-- Datos iniciales
INSERT INTO usuarios (dni, nombre, password, rol, tipo, empresa, ruc) VALUES
  ('12345678', 'Wendy Administradora', '1234', 'admin',  'planilla', 'JVN General Services SAC',  '20603607342'),
  ('87654321', 'Carlos Tecnico',       '1234', 'worker', 'planilla', 'JVN General Services SAC',  '20603607342'),
  ('11223344', 'Maria Lopez',          '1234', 'worker', 'externo',  'Freelance',                 ''),
  ('55667788', 'Jorge Perez',          '1234', 'worker', 'planilla', 'PEVAL Corporacion EIRL',    '20611965479')
ON CONFLICT (dni) DO NOTHING;

INSERT INTO empresas_drive (nombre_empresa, ruc, gmail_drive) VALUES
  ('JVN General Services SAC',  '20603607342', 'generalservicesjvn@gmail.com'),
  ('PEVAL Corporacion EIRL',    '20611965479', 'pevalcorp@gmail.com')
ON CONFLICT DO NOTHING;

INSERT INTO configuracion (clave, valor) VALUES
  ('nombre_sistema',    'NEXORA'),
  ('empresa_principal', 'JVN General Services SAC'),
  ('ruc_principal',     '20603607342')
ON CONFLICT (clave) DO NOTHING;
