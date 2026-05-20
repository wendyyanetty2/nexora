-- ============================================================
--  NEXORA v3 — Migración de mejoras
--  Ejecutar en: Supabase > SQL Editor > New query
-- ============================================================

-- 1. Nuevos campos en tabla usuarios
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS tipo_relacion TEXT DEFAULT 'planilla_jvn',
  ADD COLUMN IF NOT EXISTS cargo TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS empresa_principal_id BIGINT DEFAULT NULL;

-- 2. Migrar roles al nuevo esquema
UPDATE usuarios SET rol = 'trabajador'       WHERE rol = 'worker';
UPDATE usuarios SET rol = 'administrador'    WHERE rol = 'admin';

-- 3. Nuevos campos en tabla reembolsos
ALTER TABLE reembolsos
  ADD COLUMN IF NOT EXISTS tipo_gasto          TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS empresa_obra_id     BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS empresa_obra_nombre TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS motivo_id           BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS motivo_nombre       TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS motivo_libre        TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS descripcion_id      BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS descripcion_nombre  TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS descripcion_libre   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS vehiculo_id         BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vehiculo_nombre     TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS medio_pago          TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS numero_operacion    TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS aprobado_por        BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fecha_aprobacion    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS motivo_rechazo      TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS historial_estados   TEXT DEFAULT '[]';

-- 4. Migrar estados de reembolsos al nuevo esquema
UPDATE reembolsos SET estado = 'enviado'   WHERE estado = 'pending';
UPDATE reembolsos SET estado = 'aprobado'  WHERE estado = 'approved';
UPDATE reembolsos SET estado = 'rechazado' WHERE estado = 'rejected';
UPDATE reembolsos SET estado = 'pagado'    WHERE estado = 'paid';

-- Permitir concepto vacío
ALTER TABLE reembolsos ALTER COLUMN concepto SET DEFAULT '';

-- 5. Catálogo de empresas/obras
CREATE TABLE IF NOT EXISTS catalogo_empresas (
  id             BIGSERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  codigo         TEXT DEFAULT '',
  activo         BOOLEAN DEFAULT TRUE,
  orden          INTEGER DEFAULT 0,
  creado_por     BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Catálogo de vehículos
CREATE TABLE IF NOT EXISTS catalogo_vehiculos (
  id             BIGSERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  placa          TEXT DEFAULT '',
  activo         BOOLEAN DEFAULT TRUE,
  creado_por     BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Catálogo de descripciones de gasto
CREATE TABLE IF NOT EXISTS catalogo_descripciones (
  id             BIGSERIAL PRIMARY KEY,
  tipo_gasto     TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  activo         BOOLEAN DEFAULT TRUE,
  orden          INTEGER DEFAULT 0,
  creado_por     BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Catálogo de motivos/actividades
CREATE TABLE IF NOT EXISTS catalogo_motivos (
  id             BIGSERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  activo         BOOLEAN DEFAULT TRUE,
  orden          INTEGER DEFAULT 0,
  creado_por     BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Configuración de potestades de aprobación
CREATE TABLE IF NOT EXISTS config_potestades (
  rol           TEXT PRIMARY KEY,
  puede_aprobar BOOLEAN DEFAULT FALSE
);

INSERT INTO config_potestades (rol, puede_aprobar) VALUES
  ('supervisor',    FALSE),
  ('gerente',       FALSE),
  ('administrador', FALSE)
ON CONFLICT (rol) DO NOTHING;

-- 10. Seeds: catálogo de empresas/obras
INSERT INTO catalogo_empresas (nombre, orden) VALUES
  ('San Pablo', 1), ('Mall Bellavista', 2), ('La Victoria - San Pablo', 3),
  ('San Pablo - Surco', 4), ('San Gabriel', 5), ('Santa Martha', 6),
  ('San Juan Bautista', 7), ('Jesús del Norte', 8), ('Instituto San Pablo', 9),
  ('Huaraz', 10), ('Club Retamas', 11), ('Torre San Pedro', 12),
  ('Supermercados Peruanos', 13), ('PEVAL', 14);

-- 11. Seeds: vehículos
INSERT INTO catalogo_vehiculos (nombre) VALUES ('KIA - JVÑ'), ('Hyundai - Alexis');

-- 12. Seeds: descripciones de gasto
INSERT INTO catalogo_descripciones (tipo_gasto, nombre, orden) VALUES
  ('transporte', 'Taxi', 1), ('transporte', 'Peaje', 2),
  ('transporte', 'Combustible', 3), ('transporte', 'Estacionamiento', 4),
  ('transporte', 'Pasaje bus/combi', 5),
  ('viaticos', 'Desayuno', 1), ('viaticos', 'Almuerzo', 2),
  ('viaticos', 'Cena', 3), ('viaticos', 'Hospedaje / Hotel', 4),
  ('viaticos', 'Pernocte', 5),
  ('compras', 'Materiales', 1), ('compras', 'Suministros', 2),
  ('compras', 'Herramientas', 3), ('compras', 'Equipos', 4);

-- 13. Seeds: motivos/actividades
INSERT INTO catalogo_motivos (nombre, orden) VALUES
  ('Desplazamiento por servicio a ejecutar', 1),
  ('Desplazamiento a reuniones con clientes', 2),
  ('Desplazamiento a reuniones con proveedores', 3),
  ('Traslado para entrega de documentos', 4),
  ('Traslado para recepción de documentos', 5),
  ('Trámites administrativos', 6),
  ('Visitas técnicas', 7),
  ('Compra de materiales', 8);
