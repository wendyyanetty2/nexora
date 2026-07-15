'use strict';

const express      = require('express');
const { Pool }     = require('pg');
const { createClient } = require('@supabase/supabase-js');
const multer       = require('multer');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3001;

// ─── Zona horaria Perú ──────────────────────────────────────────
// El servidor (Render) corre en UTC; usar new Date().toISOString() para
// fecha/hora hace que los registros salten al día siguiente después de
// las 19:00 hora Perú (UTC-5). Estos helpers fijan la zona horaria.
const PERU_TZ = 'America/Lima';
const fechaPeru = () => new Date().toLocaleDateString('en-CA', { timeZone: PERU_TZ }); // YYYY-MM-DD
const horaPeru  = () => new Date().toLocaleTimeString('es-PE',  { timeZone: PERU_TZ, hour12: false });

// ─── Base de datos ────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const one = async (sql, params = []) => { const r = await pool.query(sql, params); return r.rows[0] || null; };
const all = async (sql, params = []) => { const r = await pool.query(sql, params); return r.rows; };

// ─── Supabase Storage ─────────────────────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'nexora-uploads';
async function uploadFile(buffer, storagePath, contentType) {
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new Error('Error subiendo archivo: ' + error.message);
}
async function getSignedUrl(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (error) return null;
  return data.signedUrl;
}
async function deleteFile(storagePath) {
  await supabase.storage.from(BUCKET).remove([storagePath]);
}

// ─── Multer ───────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ─── Sesiones ─────────────────────────────────────────────────
const sessions = new Map();
const SESSION_COOKIE = 'nexora_sid';
const SESSION_HOURS  = 8;
const createSession = (user) => {
  const sid = uuidv4();
  sessions.set(sid, { user, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  return sid;
};
const getSession = (req) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return null;
  const sess = sessions.get(sid);
  if (!sess || sess.exp < Date.now()) { sessions.delete(sid); return null; }
  return sess.user;
};

// ─── Jerarquía de roles ───────────────────────────────────────
const ROLE_LEVELS = { trabajador: 1, supervisor: 2, gerente: 3, administrador: 4, superadministrador: 5 };
const hasMinRole  = (rol, min) => (ROLE_LEVELS[rol] || 0) >= (ROLE_LEVELS[min] || 0);
const isAdmin     = (rol) => hasMinRole(rol, 'administrador');
const isSuperAdmin = (rol) => rol === 'superadministrador';
const canViewAll  = (rol) => hasMinRole(rol, 'supervisor');

const canApprove = async (rol) => {
  if (rol === 'superadministrador') return true;
  if (!['administrador', 'gerente', 'supervisor'].includes(rol)) return false;
  const cfg = await one('SELECT puede_aprobar FROM config_potestades WHERE rol=$1', [rol]);
  return cfg?.puede_aprobar === true;
};

// ─── Middleware ────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  const user = getSession(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  req.user = user;
  next();
};
const requireAdmin = (req, res, next) => {
  if (!isAdmin(req.user?.rol)) return res.status(403).json({ error: 'Solo administradores' });
  next();
};
const requireSuperAdmin = (req, res, next) => {
  if (!isSuperAdmin(req.user?.rol)) return res.status(403).json({ error: 'Solo super administradores' });
  next();
};

// ─── App ──────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Archivos (redirect a Supabase Storage) ───────────────────
app.get('/api/uploads/reembolsos/:filename', requireAuth, async (req, res) => {
  const url = await getSignedUrl(`reembolsos/${req.params.filename}`);
  if (!url) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.redirect(url);
});
app.get('/api/uploads/documentos/:dni/:filename', requireAuth, async (req, res) => {
  const url = await getSignedUrl(`documentos/${req.params.dni}/${req.params.filename}`);
  if (!url) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.redirect(url);
});

// ════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  try {
    const { dni, password } = req.body;
    if (!dni || !password) return res.status(400).json({ error: 'DNI y contraseña requeridos' });
    const user = await one('SELECT * FROM usuarios WHERE dni=$1 AND activo=1', [String(dni).trim()]);
    if (!user || user.password !== String(password))
      return res.status(401).json({ error: 'DNI o contraseña incorrectos' });
    const { password: _p, ...safeUser } = user;
    const sid = createSession(safeUser);
    res.cookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_HOURS * 3600 * 1000 });
    res.json({ ok: true, user: safeUser });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) sessions.delete(sid);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getSession(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  res.json({ user });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { passwordActual, passwordNueva } = req.body;
    if (!passwordActual || !passwordNueva)
      return res.status(400).json({ error: 'Debes ingresar la contraseña actual y la nueva' });
    if (passwordNueva.length < 4)
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
    const user = await one('SELECT * FROM usuarios WHERE id=$1', [req.user.id]);
    if (!user || user.password !== String(passwordActual))
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    await pool.query('UPDATE usuarios SET password=$1 WHERE id=$2', [String(passwordNueva), req.user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Potestad del usuario actual (para el frontend)
app.get('/api/config/potestades/me', requireAuth, async (req, res) => {
  try {
    if (req.user.rol === 'superadministrador') return res.json({ puede_aprobar: true });
    const cfg = await one('SELECT puede_aprobar FROM config_potestades WHERE rol=$1', [req.user.rol]);
    res.json({ puede_aprobar: cfg?.puede_aprobar || false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  ASISTENCIA
// ════════════════════════════════════════════════════════════
app.get('/api/attendance', requireAuth, async (req, res) => {
  try {
    const { date, userId, from, to } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `SELECT a.*, u.nombre, u.dni, u.tipo, u.empresa, eu.nombre AS editado_por_nombre
               FROM asistencia a JOIN usuarios u ON u.id=a.usuario_id
               LEFT JOIN usuarios eu ON eu.id=a.editado_por WHERE 1=1`;
    if (!canViewAll(req.user.rol)) sql += ` AND a.usuario_id=${p(req.user.id)}`;
    else if (userId) sql += ` AND a.usuario_id=${p(userId)}`;
    if (date) sql += ` AND a.fecha=${p(date)}`;
    if (from) sql += ` AND a.fecha>=${p(from)}`;
    if (to)   sql += ` AND a.fecha<=${p(to)}`;
    sql += ' ORDER BY a.created_at DESC LIMIT 500';
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendance/checkin', requireAuth, async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    const fecha = fechaPeru();
    const hora  = horaPeru();
    const existing = await one(
      'SELECT id FROM asistencia WHERE usuario_id=$1 AND fecha=$2 AND hora_salida IS NULL ORDER BY id DESC LIMIT 1',
      [req.user.id, fecha]
    );
    if (existing) return res.status(400).json({ error: 'Ya tienes una entrada activa. Marca tu salida primero.' });
    const row = await one(
      'INSERT INTO asistencia (usuario_id,fecha,hora_entrada,lat_entrada,lng_entrada,direccion_entrada) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [req.user.id, fecha, hora, lat||null, lng||null, address||'']
    );
    res.json({ ok: true, id: row.id, hora, fecha, direccion: address });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendance/checkout', requireAuth, async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    const fecha = fechaPeru();
    const hora  = horaPeru();
    const active = await one(
      'SELECT id FROM asistencia WHERE usuario_id=$1 AND fecha=$2 AND hora_salida IS NULL ORDER BY id DESC LIMIT 1',
      [req.user.id, fecha]
    );
    if (!active) return res.status(400).json({ error: 'No hay entrada activa para marcar salida.' });
    await pool.query(
      `UPDATE asistencia SET hora_salida=$1,lat_salida=$2,lng_salida=$3,direccion_salida=$4,estado='completado' WHERE id=$5`,
      [hora, lat||null, lng||null, address||'', active.id]
    );
    res.json({ ok: true, hora, fecha, direccion: address });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/attendance/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const a = await one('SELECT * FROM asistencia WHERE id=$1', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Registro de asistencia no encontrado' });

    const { fecha, hora_entrada, hora_salida, estado, notas } = req.body;
    if (!fecha)         return res.status(400).json({ error: 'La fecha es obligatoria' });
    if (!hora_entrada)  return res.status(400).json({ error: 'La hora de entrada es obligatoria' });
    const validos = ['activo', 'completado'];
    if (estado && !validos.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    if (estado === 'completado' && !hora_salida) {
      return res.status(400).json({ error: 'La hora de salida es obligatoria para marcar el registro como completado' });
    }

    await pool.query(`
      UPDATE asistencia SET
        fecha=$1, hora_entrada=$2, hora_salida=$3, estado=$4, notas=$5,
        editado_por=$6, fecha_edicion=NOW()
      WHERE id=$7
    `, [fecha, hora_entrada, hora_salida || null, estado || a.estado, notas ?? a.notas, req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/attendance/export', requireAuth, async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `SELECT a.fecha, u.dni, u.nombre, u.tipo, u.empresa,
               a.hora_entrada, a.hora_salida, a.direccion_entrada, a.direccion_salida, a.estado, a.notas
               FROM asistencia a JOIN usuarios u ON u.id=a.usuario_id WHERE 1=1`;
    if (!canViewAll(req.user.rol)) sql += ` AND a.usuario_id=${p(req.user.id)}`;
    else if (userId) sql += ` AND a.usuario_id=${p(userId)}`;
    if (from) sql += ` AND a.fecha>=${p(from)}`;
    if (to)   sql += ` AND a.fecha<=${p(to)}`;
    sql += ' ORDER BY a.fecha DESC, u.nombre';
    const rows = await all(sql, params);
    const bom = '﻿';
    const header = 'Fecha,DNI,Trabajador,Tipo,Empresa,Hora Entrada,Hora Salida,Ubicacion Entrada,Ubicacion Salida,Estado,Notas\n';
    const csv = rows.map(r => [
      r.fecha, r.dni, `"${r.nombre}"`, r.tipo, `"${r.empresa}"`,
      r.hora_entrada||'', r.hora_salida||'',
      `"${(r.direccion_entrada||'').replace(/"/g,'""')}"`,
      `"${(r.direccion_salida||'').replace(/"/g,'""')}"`,
      r.estado, `"${(r.notas||'').replace(/"/g,'""')}"`
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="asistencia_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(bom + header + csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  REEMBOLSOS
// ════════════════════════════════════════════════════════════
// Conteo de solicitudes pendientes para badge/notificación
app.get('/api/reimbursements/pending-count', requireAuth, async (req, res) => {
  try {
    let count = 0;
    if (canViewAll(req.user.rol)) {
      // Admins/supervisores: enviado + en_revision (esperan su acción)
      const r = await one("SELECT COUNT(*) as c FROM reembolsos WHERE estado IN ('enviado','en_revision')");
      count = parseInt(r.c) || 0;
    } else {
      // Trabajadores: sus propias solicitudes en revisión o enviadas
      const r = await one("SELECT COUNT(*) as c FROM reembolsos WHERE usuario_id=$1 AND estado IN ('enviado','en_revision')", [req.user.id]);
      count = parseInt(r.c) || 0;
    }
    res.json({ count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reimbursements/export', requireAuth, async (req, res) => {
  try {
    const { from, to, userId, status } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `SELECT r.fecha, u.dni, u.nombre, u.tipo, u.empresa,
               r.concepto, r.tipo_gasto, r.empresa_obra_nombre, r.motivo_nombre, r.descripcion_nombre,
               r.monto, r.ruc_proveedor, r.nombre_proveedor, r.tipo_comprobante, r.numero_documento,
               r.medio_pago, r.estado, r.motivo_rechazo, r.notas
               FROM reembolsos r JOIN usuarios u ON u.id=r.usuario_id WHERE 1=1`;
    if (!canViewAll(req.user.rol)) sql += ` AND r.usuario_id=${p(req.user.id)}`;
    else if (userId) sql += ` AND r.usuario_id=${p(userId)}`;
    if (status) sql += ` AND r.estado=${p(status)}`;
    if (from)   sql += ` AND r.fecha>=${p(from)}`;
    if (to)     sql += ` AND r.fecha<=${p(to)}`;
    sql += ' ORDER BY r.fecha DESC';
    const rows = await all(sql, params);
    const bom = '﻿';
    const header = 'Fecha,DNI,Trabajador,Tipo,Empresa,Concepto,Tipo Gasto,Empresa Obra,Motivo,Descripcion,Monto S/,RUC Proveedor,Proveedor,Tipo Doc,N Doc,Medio Pago,Estado,Motivo Rechazo,Notas\n';
    const csv = rows.map(r => [
      r.fecha, r.dni, `"${r.nombre}"`, r.tipo, `"${r.empresa}"`,
      `"${(r.concepto||'').replace(/"/g,'""')}"`, r.tipo_gasto||'',
      `"${(r.empresa_obra_nombre||'').replace(/"/g,'""')}"`,
      `"${(r.motivo_nombre||'').replace(/"/g,'""')}"`,
      `"${(r.descripcion_nombre||'').replace(/"/g,'""')}"`,
      r.monto, r.ruc_proveedor||'',
      `"${(r.nombre_proveedor||'').replace(/"/g,'""')}"`,
      r.tipo_comprobante||'', r.numero_documento||'', r.medio_pago||'',
      r.estado,
      `"${(r.motivo_rechazo||'').replace(/"/g,'""')}"`,
      `"${(r.notas||'').replace(/"/g,'""')}"`
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reembolsos_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(bom + header + csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reimbursements', requireAuth, async (req, res) => {
  try {
    const { status, userId, from, to } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `SELECT r.*, u.nombre, u.dni, u.tipo, u.empresa, eu.nombre AS editado_por_nombre
               FROM reembolsos r JOIN usuarios u ON u.id=r.usuario_id
               LEFT JOIN usuarios eu ON eu.id=r.editado_por WHERE 1=1`;
    if (!canViewAll(req.user.rol)) sql += ` AND r.usuario_id=${p(req.user.id)}`;
    else if (userId) sql += ` AND r.usuario_id=${p(userId)}`;
    if (status) sql += ` AND r.estado=${p(status)}`;
    if (from)   sql += ` AND r.fecha>=${p(from)}`;
    if (to)     sql += ` AND r.fecha<=${p(to)}`;
    sql += ' ORDER BY r.created_at DESC LIMIT 500';
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reimbursements', requireAuth, upload.array('archivos', 5), async (req, res) => {
  try {
    const {
      tipo_gasto, empresa_obra_id, empresa_obra_nombre,
      motivo_id, motivo_nombre, motivo_libre,
      descripcion_id, descripcion_nombre, descripcion_libre,
      vehiculo_id, vehiculo_nombre,
      monto, ruc_proveedor, nombre_proveedor, tipo_comprobante, numero_documento,
      fecha_factura, notas
    } = req.body;
    if (!monto) return res.status(400).json({ error: 'El monto es obligatorio' });
    const concepto = descripcion_nombre || descripcion_libre || tipo_gasto || 'Reembolso';
    const fecha = fechaPeru();
    const archivos = [];
    for (const file of (req.files || [])) {
      const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `${ts}_${req.user.dni}_${safe}`;
      await uploadFile(file.buffer, `reembolsos/${filename}`, file.mimetype);
      archivos.push(filename);
    }
    const historial = JSON.stringify([{
      estado: 'enviado', usuario_id: req.user.id,
      usuario_nombre: req.user.nombre, fecha: new Date().toISOString(), comentario: ''
    }]);
    const row = await one(`
      INSERT INTO reembolsos (
        usuario_id, fecha, concepto, monto,
        tipo_gasto, empresa_obra_id, empresa_obra_nombre,
        motivo_id, motivo_nombre, motivo_libre,
        descripcion_id, descripcion_nombre, descripcion_libre,
        vehiculo_id, vehiculo_nombre,
        ruc_proveedor, nombre_proveedor, tipo_comprobante, numero_documento,
        fecha_factura, estado, archivos, notas, historial_estados
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'enviado',$21,$22,$23)
      RETURNING id
    `, [
      req.user.id, fecha, concepto, parseFloat(monto)||0,
      tipo_gasto||'', empresa_obra_id||null, empresa_obra_nombre||'',
      motivo_id||null, motivo_nombre||'', motivo_libre||'',
      descripcion_id||null, descripcion_nombre||'', descripcion_libre||'',
      vehiculo_id||null, vehiculo_nombre||'',
      ruc_proveedor||'', nombre_proveedor||'', tipo_comprobante||'', numero_documento||'',
      fecha_factura||null,
      JSON.stringify(archivos), notas||'', historial
    ]);
    res.json({ ok: true, id: row.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/reimbursements/:id', requireAuth, async (req, res) => {
  try {
    const r = await one('SELECT * FROM reembolsos WHERE id=$1', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const { status, motivo_rechazo } = req.body;

    if (status) {
      // Cambio de estado — requiere potestad
      const ok = await canApprove(req.user.rol);
      if (!ok) return res.status(403).json({ error: 'No tienes potestad para cambiar el estado de solicitudes' });
      const validos = ['enviado', 'en_revision', 'aprobado', 'rechazado', 'pagado'];
      if (!validos.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
      const historial = JSON.parse(r.historial_estados || '[]');
      historial.push({
        estado: status, usuario_id: req.user.id, usuario_nombre: req.user.nombre,
        fecha: new Date().toISOString(), comentario: motivo_rechazo || ''
      });
      await pool.query(`
        UPDATE reembolsos SET
          estado=$1, motivo_rechazo=$2,
          aprobado_por=CASE WHEN $1 IN ('aprobado','rechazado','pagado') THEN $3 ELSE aprobado_por END,
          fecha_aprobacion=CASE WHEN $1 IN ('aprobado','rechazado','pagado') THEN NOW() ELSE fecha_aprobacion END,
          historial_estados=$4
        WHERE id=$5
      `, [status, motivo_rechazo||'', req.user.id, JSON.stringify(historial), req.params.id]);
      return res.json({ ok: true });
    }

    // Edición de campos — trabajadores solo pueden editar sus propias en estado 'enviado'
    if (!isAdmin(req.user.rol)) {
      if (Number(r.usuario_id) !== Number(req.user.id)) return res.status(403).json({ error: 'No autorizado' });
      if (r.estado !== 'enviado') return res.status(400).json({ error: 'Solo puedes editar solicitudes en estado enviado' });
    }
    const {
      tipo_gasto, empresa_obra_id, empresa_obra_nombre,
      motivo_id, motivo_nombre, motivo_libre,
      descripcion_id, descripcion_nombre, descripcion_libre,
      vehiculo_id, vehiculo_nombre,
      monto, ruc_proveedor, nombre_proveedor, tipo_comprobante, numero_documento,
      fecha_factura, notas
    } = req.body;
    if (monto !== undefined && (isNaN(parseFloat(monto)) || parseFloat(monto) <= 0)) {
      return res.status(400).json({ error: 'El monto debe ser un número mayor a cero' });
    }
    const concepto = descripcion_nombre || descripcion_libre || tipo_gasto || r.concepto || '';
    await pool.query(`
      UPDATE reembolsos SET concepto=$1,monto=$2,
        tipo_gasto=$3,empresa_obra_id=$4,empresa_obra_nombre=$5,
        motivo_id=$6,motivo_nombre=$7,motivo_libre=$8,
        descripcion_id=$9,descripcion_nombre=$10,descripcion_libre=$11,
        vehiculo_id=$12,vehiculo_nombre=$13,
        ruc_proveedor=$14,nombre_proveedor=$15,tipo_comprobante=$16,numero_documento=$17,
        fecha_factura=$18,notas=$19,
        editado_por=$20,fecha_edicion=NOW()
      WHERE id=$21
    `, [
      concepto, parseFloat(monto)||r.monto,
      tipo_gasto||r.tipo_gasto, empresa_obra_id||r.empresa_obra_id, empresa_obra_nombre||r.empresa_obra_nombre,
      motivo_id||r.motivo_id, motivo_nombre||r.motivo_nombre, motivo_libre??r.motivo_libre,
      descripcion_id||r.descripcion_id, descripcion_nombre||r.descripcion_nombre, descripcion_libre??r.descripcion_libre,
      vehiculo_id||r.vehiculo_id, vehiculo_nombre||r.vehiculo_nombre,
      ruc_proveedor??r.ruc_proveedor, nombre_proveedor??r.nombre_proveedor,
      tipo_comprobante||r.tipo_comprobante, numero_documento??r.numero_documento,
      (fecha_factura ?? r.fecha_factura) || null, notas??r.notas,
      req.user.id, req.params.id
    ]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/reimbursements/:id', requireAuth, async (req, res) => {
  try {
    const r = await one('SELECT * FROM reembolsos WHERE id=$1', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (!isAdmin(req.user.rol)) {
      if (Number(r.usuario_id) !== Number(req.user.id)) return res.status(403).json({ error: 'No autorizado' });
      if (r.estado !== 'enviado') return res.status(400).json({ error: 'Solo puedes eliminar solicitudes en estado enviado' });
    }
    const files = JSON.parse(r.archivos || '[]');
    for (const f of files) await deleteFile(`reembolsos/${f}`);
    await pool.query('DELETE FROM reembolsos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  CATÁLOGOS (CRUD genérico)
// ════════════════════════════════════════════════════════════
const catalogCRUD = (table, orderBy) => {
  // Activos para selects en formularios (cualquier usuario autenticado)
  app.get(`/api/catalogs/${table}`, requireAuth, async (req, res) => {
    try {
      const { tipo_gasto } = req.query;
      let sql = `SELECT * FROM ${table} WHERE activo=true`;
      const params = [];
      if (tipo_gasto) { params.push(tipo_gasto); sql += ` AND tipo_gasto=$1`; }
      sql += ` ORDER BY ${orderBy}`;
      res.json(await all(sql, params));
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Todos (incluye inactivos) — admin+, para panel de gestión
  app.get(`/api/catalogs/${table}/all`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { tipo_gasto } = req.query;
      let sql = `SELECT * FROM ${table} WHERE 1=1`;
      const params = [];
      if (tipo_gasto) { params.push(tipo_gasto); sql += ` AND tipo_gasto=$1`; }
      sql += ` ORDER BY ${orderBy}`;
      res.json(await all(sql, params));
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Crear
  app.post(`/api/catalogs/${table}`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { nombre, codigo, placa, tipo_gasto, orden } = req.body;
      if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
      let sql, params;
      if (table === 'catalogo_vehiculos') {
        sql = `INSERT INTO ${table} (nombre,placa,creado_por) VALUES ($1,$2,$3) RETURNING id`;
        params = [nombre, placa||'', req.user.id];
      } else if (table === 'catalogo_descripciones') {
        if (!tipo_gasto) return res.status(400).json({ error: 'El tipo de gasto es obligatorio' });
        sql = `INSERT INTO ${table} (nombre,tipo_gasto,orden,creado_por) VALUES ($1,$2,$3,$4) RETURNING id`;
        params = [nombre, tipo_gasto, parseInt(orden)||0, req.user.id];
      } else {
        sql = `INSERT INTO ${table} (nombre,codigo,orden,creado_por) VALUES ($1,$2,$3,$4) RETURNING id`;
        params = [nombre, codigo||'', parseInt(orden)||0, req.user.id];
      }
      const row = await one(sql, params);
      res.json({ ok: true, id: row.id });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Actualizar
  app.put(`/api/catalogs/${table}/:id`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { nombre, codigo, placa, tipo_gasto, orden } = req.body;
      if (table === 'catalogo_vehiculos') {
        await pool.query(`UPDATE ${table} SET nombre=$1,placa=$2 WHERE id=$3`, [nombre, placa||'', req.params.id]);
      } else if (table === 'catalogo_descripciones') {
        await pool.query(`UPDATE ${table} SET nombre=$1,tipo_gasto=$2,orden=$3 WHERE id=$4`, [nombre, tipo_gasto, parseInt(orden)||0, req.params.id]);
      } else {
        await pool.query(`UPDATE ${table} SET nombre=$1,codigo=$2,orden=$3 WHERE id=$4`, [nombre, codigo||'', parseInt(orden)||0, req.params.id]);
      }
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Toggle activo/inactivo (nunca borra)
  app.put(`/api/catalogs/${table}/:id/toggle`, requireAuth, requireAdmin, async (req, res) => {
    try {
      const item = await one(`SELECT activo FROM ${table} WHERE id=$1`, [req.params.id]);
      if (!item) return res.status(404).json({ error: 'No encontrado' });
      await pool.query(`UPDATE ${table} SET activo=$1 WHERE id=$2`, [!item.activo, req.params.id]);
      res.json({ ok: true, activo: !item.activo });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
};

catalogCRUD('catalogo_empresas',    'orden, nombre');
catalogCRUD('catalogo_vehiculos',   'nombre');
catalogCRUD('catalogo_descripciones', 'tipo_gasto, orden, nombre');
catalogCRUD('catalogo_motivos',     'orden, nombre');

// ════════════════════════════════════════════════════════════
//  POTESTADES DE APROBACIÓN
// ════════════════════════════════════════════════════════════
app.get('/api/config/potestades', requireAuth, requireSuperAdmin, async (req, res) => {
  try { res.json(await all('SELECT * FROM config_potestades ORDER BY rol')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config/potestades/:rol', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { puede_aprobar } = req.body;
    await pool.query(
      'INSERT INTO config_potestades (rol,puede_aprobar) VALUES ($1,$2) ON CONFLICT (rol) DO UPDATE SET puede_aprobar=$2',
      [req.params.rol, !!puede_aprobar]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  DOCUMENTOS
// ════════════════════════════════════════════════════════════
app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const { userId, type } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `SELECT d.*, u.nombre, u.dni FROM documentos d JOIN usuarios u ON u.id=d.usuario_id WHERE 1=1`;
    if (!canViewAll(req.user.rol)) sql += ` AND d.usuario_id=${p(req.user.id)}`;
    else if (userId) sql += ` AND d.usuario_id=${p(userId)}`;
    if (type) sql += ` AND d.tipo=${p(type)}`;
    sql += ' ORDER BY d.created_at DESC';
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/documents', requireAuth, requireAdmin, upload.single('archivo'), async (req, res) => {
  try {
    const { usuario_id, tipo, titulo, periodo } = req.body;
    if (!usuario_id || !tipo || !titulo || !req.file)
      return res.status(400).json({ error: 'Faltan campos requeridos o archivo' });
    const worker = await one('SELECT dni FROM usuarios WHERE id=$1', [usuario_id]);
    if (!worker) return res.status(404).json({ error: 'Trabajador no encontrado' });
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${ts}_${worker.dni}_${safe}`;
    await uploadFile(req.file.buffer, `documentos/${worker.dni}/${filename}`, req.file.mimetype);
    const tamano = req.file.size > 1024*1024
      ? `${(req.file.size/1024/1024).toFixed(1)} MB` : `${Math.ceil(req.file.size/1024)} KB`;
    await pool.query(
      'INSERT INTO documentos (usuario_id,tipo,titulo,periodo,nombre_archivo,tamano) VALUES ($1,$2,$3,$4,$5,$6)',
      [parseInt(usuario_id), tipo, titulo, periodo||'', filename, tamano]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/documents/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await one(
      'SELECT d.nombre_archivo,u.dni FROM documentos d JOIN usuarios u ON u.id=d.usuario_id WHERE d.id=$1',
      [req.params.id]
    );
    if (doc) await deleteFile(`documentos/${doc.dni}/${doc.nombre_archivo}`);
    await pool.query('DELETE FROM documentos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/documents/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to, userId, type } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `SELECT d.created_at,u.dni,u.nombre,d.tipo,d.titulo,d.periodo,d.nombre_archivo,d.tamano
               FROM documentos d JOIN usuarios u ON u.id=d.usuario_id WHERE 1=1`;
    if (userId) sql += ` AND d.usuario_id=${p(userId)}`;
    if (type)   sql += ` AND d.tipo=${p(type)}`;
    if (from)   sql += ` AND d.created_at::date>=${p(from)}::date`;
    if (to)     sql += ` AND d.created_at::date<=${p(to)}::date`;
    sql += ' ORDER BY d.created_at DESC';
    const rows = await all(sql, params);
    const bom = '﻿';
    const header = 'Fecha,DNI,Trabajador,Tipo Documento,Titulo,Periodo,Archivo,Tamano\n';
    const csv = rows.map(r => [
      String(r.created_at).slice(0,10), r.dni, `"${r.nombre}"`,
      r.tipo, `"${r.titulo}"`, r.periodo||'', r.nombre_archivo, r.tamano
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="documentos_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(bom + header + csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  TRABAJADORES
// ════════════════════════════════════════════════════════════
app.get('/api/workers/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await all('SELECT dni,nombre,rol,tipo,tipo_relacion,cargo,empresa,ruc,email,telefono,activo,created_at FROM usuarios ORDER BY nombre');
    const bom = '﻿';
    const header = 'DNI,Nombre,Rol,Tipo,Relacion Laboral,Cargo,Empresa,RUC,Email,Telefono,Activo,Fecha Registro\n';
    const csv = rows.map(r => [
      r.dni, `"${r.nombre}"`, r.rol, r.tipo, r.tipo_relacion||'', r.cargo||'',
      `"${r.empresa}"`, r.ruc||'', r.email||'', r.telefono||'',
      r.activo ? 'Si' : 'No', String(r.created_at).slice(0,10)
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trabajadores_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(bom + header + csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/workers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { search } = req.query;
    const params = [];
    let sql = 'SELECT id,dni,nombre,rol,tipo,tipo_relacion,cargo,empresa,empresa_principal_id,ruc,email,telefono,activo,created_at FROM usuarios WHERE 1=1';
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      sql += ` AND (nombre ILIKE $1 OR dni ILIKE $2)`;
    }
    sql += ' ORDER BY nombre';
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/workers/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { trabajadores } = req.body;
    if (!Array.isArray(trabajadores) || trabajadores.length === 0)
      return res.status(400).json({ error: 'Lista de trabajadores vacia o invalida' });
    const creados = [], errores = [];
    for (let i = 0; i < trabajadores.length; i++) {
      const w = trabajadores[i];
      try {
        const dni    = String(w.dni || '').trim();
        const nombre = String(w.nombre || '').trim();
        if (!dni || !/^\d{8}$/.test(dni)) { errores.push(`Fila ${i+1}: DNI invalido (${dni})`); continue; }
        if (!nombre) { errores.push(`Fila ${i+1}: Nombre vacio`); continue; }
        await pool.query(
          'INSERT INTO usuarios (dni,nombre,password,rol,tipo,tipo_relacion,empresa,ruc,email,telefono) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [dni, nombre, w.password||dni, w.rol||'trabajador', 'planilla_jvn', w.tipo_relacion||'planilla_jvn', w.empresa||'', w.ruc||'', w.email||'', w.telefono||'']
        );
        creados.push(nombre);
      } catch(e) {
        if (e.code === '23505') errores.push(`Fila ${i+1}: DNI ${w.dni} ya existe`);
        else errores.push(`Fila ${i+1}: ${e.message}`);
      }
    }
    res.json({ ok: true, creados: creados.length, errores, nombres: creados });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/workers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { dni, nombre, password, rol, tipo_relacion, cargo, empresa, empresa_principal_id, ruc, email, telefono } = req.body;
    if (!dni || !nombre || !password) return res.status(400).json({ error: 'DNI, nombre y contraseña son requeridos' });
    if (!/^\d{8}$/.test(dni)) return res.status(400).json({ error: 'El DNI debe tener exactamente 8 dígitos' });
    const tipoRelacion = tipo_relacion || 'planilla_jvn';
    const tipo = tipoRelacion === 'independiente_rh' ? 'externo' : 'planilla';
    const row = await one(`
      INSERT INTO usuarios (dni,nombre,password,rol,tipo,tipo_relacion,cargo,empresa,empresa_principal_id,ruc,email,telefono)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    `, [dni, nombre, password, rol||'trabajador', tipo, tipoRelacion, cargo||'', empresa||'', empresa_principal_id||null, ruc||'', email||'', telefono||'']);
    res.json({ ok: true, id: row.id });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'El DNI ya esta registrado' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/workers/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await one('SELECT activo FROM usuarios WHERE id=$1', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    await pool.query('UPDATE usuarios SET activo=$1 WHERE id=$2', [user.activo ? 0 : 1, req.params.id]);
    res.json({ ok: true, activo: !user.activo });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/workers/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nombre, password, rol, tipo_relacion, cargo, empresa, empresa_principal_id, ruc, email, telefono, activo } = req.body;
    if (activo !== undefined && Object.keys(req.body).length === 1) {
      await pool.query('UPDATE usuarios SET activo=$1 WHERE id=$2', [activo ? 1 : 0, req.params.id]);
      return res.json({ ok: true });
    }
    const tipoRelacion = tipo_relacion || 'planilla_jvn';
    const tipo = tipoRelacion === 'independiente_rh' ? 'externo' : 'planilla';
    const params = [nombre, rol||'trabajador', tipo, tipoRelacion, cargo||'', empresa||'', empresa_principal_id||null, ruc||'', email||'', telefono||''];
    let sql = 'UPDATE usuarios SET nombre=$1,rol=$2,tipo=$3,tipo_relacion=$4,cargo=$5,empresa=$6,empresa_principal_id=$7,ruc=$8,email=$9,telefono=$10';
    if (password)             { params.push(password);       sql += `,password=$${params.length}`; }
    if (activo !== undefined) { params.push(activo ? 1 : 0); sql += `,activo=$${params.length}`; }
    params.push(req.params.id);
    sql += ` WHERE id=$${params.length}`;
    await pool.query(sql, params);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/workers/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (String(req.user.id) === String(id))
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    const user = await one('SELECT id FROM usuarios WHERE id=$1', [id]);
    if (!user) return res.status(404).json({ error: 'Trabajador no encontrado' });
    await pool.query('DELETE FROM asistencia WHERE usuario_id=$1', [id]);
    await pool.query('DELETE FROM reembolsos WHERE usuario_id=$1', [id]);
    await pool.query('DELETE FROM documentos WHERE usuario_id=$1', [id]);
    await pool.query('DELETE FROM usuarios WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/list', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await all('SELECT id,dni,nombre,rol,tipo,tipo_relacion,cargo,empresa,ruc,email,telefono,activo FROM usuarios ORDER BY nombre'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  REPORTES
// ════════════════════════════════════════════════════════════
app.get('/api/reports/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const d1 = from || '2000-01-01', d2 = to || '2099-12-31';
    const [totalAtt, totalRei, pendRei, aprobRei, workers] = await Promise.all([
      one('SELECT COUNT(*) as c FROM asistencia WHERE fecha>=$1 AND fecha<=$2', [d1,d2]),
      one('SELECT COUNT(*) as c, SUM(monto) as monto FROM reembolsos WHERE fecha>=$1 AND fecha<=$2', [d1,d2]),
      one("SELECT COUNT(*) as c FROM reembolsos WHERE fecha>=$1 AND fecha<=$2 AND estado='enviado'", [d1,d2]),
      one("SELECT COUNT(*) as c FROM reembolsos WHERE fecha>=$1 AND fecha<=$2 AND estado='aprobado'", [d1,d2]),
      one('SELECT COUNT(DISTINCT usuario_id) as c FROM asistencia WHERE fecha>=$1 AND fecha<=$2', [d1,d2]),
    ]);
    res.json({
      totalAtt: parseInt(totalAtt.c), totalRei: parseInt(totalRei.c),
      montoRei: totalRei.monto||0, pendRei: parseInt(pendRei.c),
      aprobRei: parseInt(aprobRei.c), workers: parseInt(workers.c)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reports/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const d1 = from || '2000-01-01', d2 = to || '2099-12-31';
    const workers = await all("SELECT id,dni,nombre,tipo,empresa FROM usuarios WHERE rol='trabajador'");
    const summary = await Promise.all(workers.map(async w => {
      const [att, rei, pend, aprob, docs] = await Promise.all([
        one('SELECT COUNT(*) as c FROM asistencia WHERE usuario_id=$1 AND fecha>=$2 AND fecha<=$3', [w.id,d1,d2]),
        one('SELECT COUNT(*) as c, SUM(monto) as total FROM reembolsos WHERE usuario_id=$1 AND fecha>=$2 AND fecha<=$3', [w.id,d1,d2]),
        one("SELECT COUNT(*) as c FROM reembolsos WHERE usuario_id=$1 AND estado='enviado'", [w.id]),
        one("SELECT COUNT(*) as c FROM reembolsos WHERE usuario_id=$1 AND estado='aprobado'", [w.id]),
        one('SELECT COUNT(*) as c FROM documentos WHERE usuario_id=$1', [w.id]),
      ]);
      return { ...w, dias_asistidos: parseInt(att.c), total_reembolsos: parseInt(rei.c), monto_reembolsos: rei.total||0, pendientes: parseInt(pend.c), aprobados: parseInt(aprob.c), documentos: parseInt(docs.c) };
    }));
    const bom = '﻿';
    const header = 'DNI,Trabajador,Tipo,Empresa,Dias Asistidos,Total Reembolsos,Monto Reembolsos S/,Reembolsos Pendientes,Reembolsos Aprobados,Documentos\n';
    const csv = summary.map(r => [
      r.dni, `"${r.nombre}"`, r.tipo, `"${r.empresa}"`,
      r.dias_asistidos, r.total_reembolsos, (r.monto_reembolsos||0).toFixed(2),
      r.pendientes, r.aprobados, r.documentos
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="resumen_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(bom + header + csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  BACKUP / CONFIG
// ════════════════════════════════════════════════════════════
app.get('/api/backup/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [usuarios, asistencia, reembolsos, documentos, empresas_drive, configuracion] = await Promise.all([
      all('SELECT * FROM usuarios'),
      all('SELECT * FROM asistencia'),
      all('SELECT * FROM reembolsos'),
      all('SELECT * FROM documentos'),
      all('SELECT * FROM empresas_drive'),
      all('SELECT * FROM configuracion'),
    ]);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="nexora_backup_${new Date().toISOString().slice(0,10)}.json"`);
    res.json({ exportedAt: new Date().toISOString(), version: '3.0', usuarios, asistencia, reembolsos, documentos, empresas_drive, configuracion });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backup/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM documentos; DELETE FROM reembolsos; DELETE FROM asistencia; DELETE FROM usuarios;');
    await pool.query(`ALTER SEQUENCE usuarios_id_seq RESTART WITH 1;
      ALTER SEQUENCE asistencia_id_seq RESTART WITH 1;
      ALTER SEQUENCE reembolsos_id_seq RESTART WITH 1;
      ALTER SEQUENCE documentos_id_seq RESTART WITH 1;`);
    await pool.query(`INSERT INTO usuarios (dni,nombre,password,rol,tipo,tipo_relacion,empresa,ruc) VALUES
      ('12345678','Wendy Super Admin','1234','superadministrador','planilla','planilla_jvn','JVN General Services SAC','20603607342'),
      ('87654321','Carlos Tecnico','1234','trabajador','planilla','planilla_jvn','JVN General Services SAC','20603607342'),
      ('11223344','Maria Lopez','1234','trabajador','externo','independiente_rh','Freelance',''),
      ('55667788','Jorge Perez','1234','trabajador','planilla','planilla_peval','PEVAL Corporacion EIRL','20611965479')
      ON CONFLICT (dni) DO NOTHING`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backup/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [usuarios, asistencia, reembolsos, documentos, monto] = await Promise.all([
      one("SELECT COUNT(*) as c FROM usuarios WHERE activo=1"),
      one("SELECT COUNT(*) as c FROM asistencia"),
      one("SELECT COUNT(*) as c FROM reembolsos"),
      one("SELECT COUNT(*) as c FROM documentos"),
      one("SELECT SUM(monto) as m FROM reembolsos WHERE estado='aprobado'"),
    ]);
    res.json({
      usuarios: parseInt(usuarios.c), asistencia: parseInt(asistencia.c),
      reembolsos: parseInt(reembolsos.c), documentos: parseInt(documentos.c),
      monto_total: monto.m || 0, dbSize: 'Supabase Cloud', uploadsSize: 'Supabase Storage', uptime: 'Render.com'
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config/empresas-drive', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await all('SELECT * FROM empresas_drive ORDER BY id')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/empresas-drive', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nombre_empresa, ruc, gmail_drive, ruta_onedrive } = req.body;
    if (!nombre_empresa) return res.status(400).json({ error: 'Nombre de empresa requerido' });
    const row = await one(
      'INSERT INTO empresas_drive (nombre_empresa,ruc,gmail_drive,ruta_onedrive) VALUES ($1,$2,$3,$4) RETURNING id',
      [nombre_empresa, ruc||'', gmail_drive||'', ruta_onedrive||'']
    );
    res.json({ ok: true, id: row.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config/empresas-drive/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nombre_empresa, ruc, gmail_drive, ruta_onedrive } = req.body;
    await pool.query(
      'UPDATE empresas_drive SET nombre_empresa=$1,ruc=$2,gmail_drive=$3,ruta_onedrive=$4 WHERE id=$5',
      [nombre_empresa||'', ruc||'', gmail_drive||'', ruta_onedrive||'', req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/config/empresas-drive/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM empresas_drive WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/sync-onedrive', requireAuth, requireAdmin, (_req, res) => {
  res.status(400).json({ ok: false, error: 'OneDrive no esta disponible en la version cloud.' });
});

// ─── SPA fallback ─────────────────────────────────────────────
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║      NEXORA v3 — Sistema activo      ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Puerto: ${PORT}                        ║`);
  console.log('║  BD: Supabase PostgreSQL             ║');
  console.log('║  Archivos: Supabase Storage          ║');
  console.log('╚══════════════════════════════════════╝\n');
});
