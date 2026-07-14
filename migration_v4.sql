-- ============================================================
--  NEXORA v4 — Auditoría de ediciones + corrección de asistencia
--  Ejecutar en: Supabase > SQL Editor > New query
-- ============================================================

-- 1. Auditoría de ediciones en reembolsos (quién editó los campos y cuándo;
--    separado de historial_estados, que solo registra cambios de estado)
ALTER TABLE reembolsos
  ADD COLUMN IF NOT EXISTS editado_por    BIGINT REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS fecha_edicion  TIMESTAMPTZ DEFAULT NULL;

-- 2. Auditoría de ediciones en asistencia (necesaria para el nuevo endpoint
--    de corrección manual de registros, PUT /api/attendance/:id)
ALTER TABLE asistencia
  ADD COLUMN IF NOT EXISTS editado_por    BIGINT REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS fecha_edicion  TIMESTAMPTZ DEFAULT NULL;
