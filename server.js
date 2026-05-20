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

// ─── Base de datos (PostgreSQL via Supabase) ─────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const one = async (sql, params = []) => {
  const res = await pool.query(sql, params);
  return res.rows[0] || null;
};
const all = async (sql, params = []) => {
  const res = await pool.query(sql, params);
  return res.rows;
};

// ─── Almacenamiento de archivos (Supabase Storage) ───────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const BUCKET = 'nexora-uploads';

async function uploadFile(buffer, storagePath, contentType) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new Error('Error subiendo archivo: ' + error.message);
  return storagePath;
}
async function getSignedUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error) return null;
  return data.signedUrl;
}
async function deleteFile(storagePath) {
  await supabase.storage.from(BUCKET).remove([storagePath]);
}

// ─── Multer en memoria ────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// ─── Sesiones en memoria ─────────────────────────────────────
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
const requireAuth = (req, res, next) => {
  const user = getSession(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  req.user = user;
  next();
};
const requireAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
};

// ─── App Express ──────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Servir archivos (redirige a Supabase Storage) ───────────
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

// ════════════════════════════════════════════════════════════
//  ASISTENCIA
// ════════════════════════════════════════════════════════════
app.get('/api/attendance', requireAuth, async (req, res) => {
  try {
    const { date, userId, from, to } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `
      SELECT a.*, u.nombre, u.dni, u.tipo, u.empresa
      FROM asistencia a JOIN usuarios u ON u.id=a.usuario_id WHERE 1=1
    `;
    if (req.user.rol !== 'admin') sql += ` AND a.usuario_id=${p(req.user.id)}`;
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
    const fecha = new Date().toISOString().slice(0, 10);
    const hora  = new Date().toLocaleTimeString('es-PE', { hour12: false });
    const existing = await one(
      'SELECT id FROM asistencia WHERE usuario_id=$1 AND fecha=$2 AND hora_salida IS NULL ORDER BY id DESC LIMIT 1',
      [req.user.id, fecha]
    );
    if (existing) return res.status(400).json({ error: 'Ya tienes una entrada activa. Marca tu salida primero.' });
    const row = await one(`
      INSERT INTO asistencia (usuario_id,fecha,hora_entrada,lat_entrada,lng_entrada,direccion_entrada)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
    `, [req.user.id, fecha, hora, lat||null, lng||null, address||'']);
    res.json({ ok: true, id: row.id, hora, fecha, direccion: address });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendance/checkout', requireAuth, async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    const fecha = new Date().toISOString().slice(0, 10);
    const hora  = new Date().toLocaleTimeString('es-PE', { hour12: false });
    const active = await one(
      'SELECT id FROM asistencia WHERE usuario_id=$1 AND fecha=$2 AND hora_salida IS NULL ORDER BY id DESC LIMIT 1',
      [req.user.id, fecha]
    );
    if (!active) return res.status(400).json({ error: 'No hay entrada activa para marcar salida.' });
    await pool.query(`
      UPDATE asistencia SET hora_salida=$1,lat_salida=$2,lng_salida=$3,direccion_salida=$4,estado='completado'
      WHERE id=$5
    `, [hora, lat||null, lng||null, address||'', active.id]);
    res.json({ ok: true, hora, fecha, direccion: address });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/attendance/export', requireAuth, async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `
      SELECT a.fecha, u.dni, u.nombre, u.tipo, u.empresa,
             a.hora_entrada, a.hora_salida, a.direccion_entrada, a.direccion_salida, a.estado, a.notas
      FROM asistencia a JOIN usuarios u ON u.id=a.usuario_id WHERE 1=1
    `;
    if (req.user.rol !== 'admin') sql += ` AND a.usuario_id=${p(req.user.id)}`;
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
app.get('/api/reimbursements', requireAuth, async (req, res) => {
  try {
    const { status, userId, from, to } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `
      SELECT r.*, u.nombre, u.dni, u.tipo, u.empresa
      FROM reembolsos r JOIN usuarios u ON u.id=r.usuario_id WHERE 1=1
    `;
    if (req.user.rol !== 'admin') sql += ` AND r.usuario_id=${p(req.user.id)}`;
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
    const { concepto, monto, ruc_proveedor, nombre_proveedor, tipo_comprobante, numero_documento, notas } = req.body;
    if (!concepto || !monto) return res.status(400).json({ error: 'Concepto y monto son obligatorios' });
    const fecha = new Date().toISOString().slice(0, 10);
    const archivos = [];
    for (const file of (req.files || [])) {
      const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `${ts}_${req.user.dni}_${safe}`;
      await uploadFile(file.buffer, `reembolsos/${filename}`, file.mimetype);
      archivos.push(filename);
    }
    const row = await one(`
      INSERT INTO reembolsos (usuario_id,fecha,concepto,monto,ruc_proveedor,nombre_proveedor,tipo_comprobante,numero_documento,archivos,notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    `, [req.user.id, fecha, concepto, parseFloat(monto)||0, ruc_proveedor||'', nombre_proveedor||'', tipo_comprobante||'', numero_documento||'', JSON.stringify(archivos), notas||'']);
    res.json({ ok: true, id: row.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/reimbursements/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending','approved','rejected','paid'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Estado invalido' });
    await pool.query('UPDATE reembolsos SET estado=$1 WHERE id=$2', [status, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/reimbursements/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await one('SELECT archivos FROM reembolsos WHERE id=$1', [req.params.id]);
    if (r) {
      const files = JSON.parse(r.archivos || '[]');
      for (const f of files) await deleteFile(`reembolsos/${f}`);
    }
    await pool.query('DELETE FROM reembolsos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reimbursements/export', requireAuth, async (req, res) => {
  try {
    const { from, to, userId, status } = req.query;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    let sql = `
      SELECT r.fecha, u.dni, u.nombre, u.tipo, u.empresa, r.concepto, r.monto,
             r.ruc_proveedor, r.nombre_proveedor, r.tipo_comprobante, r.numero_documento, r.estado, r.notas
      FROM reembolsos r JOIN usuarios u ON u.id=r.usuario_id WHERE 1=1
    `;
    if (req.user.rol !== 'admin') sql += ` AND r.usuario_id=${p(req.user.id)}`;
    else if (userId) sql += ` AND r.usuario_id=${p(userId)}`;
    if (status) sql += ` AND r.estado=${p(status)}`;
    if (from)   sql += ` AND r.fecha>=${p(from)}`;
    if (to)     sql += ` AND r.fecha<=${p(to)}`;
    sql += ' ORDER BY r.fecha DESC';
    const rows = await all(sql, params);
    const bom = '﻿';
    const header = 'Fecha,DNI,Trabajador,Tipo,Empresa,Concepto,Monto S/,RUC Proveedor,Proveedor,Tipo Doc,N Doc,Estado,Notas\n';
    const csv = rows.map(r => [
      r.fecha, r.dni, `"${r.nombre}"`, r.tipo, `"${r.empresa}"`,
      `"${r.concepto}"`, r.monto,
      r.ruc_proveedor||'', `"${(r.nombre_proveedor||'').replace(/"/g,'""')}"`,
      r.tipo_comprobante||'', r.numero_documento||'',
      r.estado, `"${(r.notas||'').replace(/"/g,'""')}"`
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reembolsos_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(bom + header + csv);
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
    if (req.user.rol !== 'admin') sql += ` AND d.usuario_id=${p(req.user.id)}`;
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
      ? `${(req.file.size/1024/1024).toFixed(1)} MB`
      : `${Math.ceil(req.file.size/1024)} KB`;
    await pool.query(`
      INSERT INTO documentos (usuario_id,tipo,titulo,periodo,nombre_archivo,tamano)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [parseInt(usuario_id), tipo, titulo, periodo||'', filename, tamano]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/documents/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await one(`
      SELECT d.nombre_archivo, u.dni FROM documentos d JOIN usuarios u ON u.id=d.usuario_id WHERE d.id=$1
    `, [req.params.id]);
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
    let sql = `
      SELECT d.created_at, u.dni, u.nombre, d.tipo, d.titulo, d.periodo, d.nombre_archivo, d.tamano
      FROM documentos d JOIN usuarios u ON u.id=d.usuario_id WHERE 1=1
    `;
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
    const rows = await all('SELECT dni,nombre,rol,tipo,empresa,ruc,email,telefono,activo,created_at FROM usuarios ORDER BY nombre');
    const bom = '﻿';
    const header = 'DNI,Nombre,Rol,Tipo,Empresa,RUC,Email,Telefono,Activo,Fecha Registro\n';
    const csv = rows.map(r => [
      r.dni, `"${r.nombre}"`, r.rol, r.tipo, `"${r.empresa}"`,
      r.ruc||'', r.email||'', r.telefono||'',
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
    let sql = 'SELECT id,dni,nombre,rol,tipo,empresa,ruc,email,telefono,activo,created_at FROM usuarios WHERE 1=1';
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
        await pool.query(`
          INSERT INTO usuarios (dni,nombre,password,rol,tipo,empresa,ruc,email,telefono)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [dni, nombre, w.password||dni, w.rol||'worker', w.tipo||'planilla', w.empresa||'', w.ruc||'', w.email||'', w.telefono||'']);
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
    const { dni, nombre, password, rol, tipo, empresa, ruc, email, telefono } = req.body;
    if (!dni || !nombre || !password) return res.status(400).json({ error: 'DNI, nombre y contrasena son requeridos' });
    if (!/^\d{8}$/.test(dni)) return res.status(400).json({ error: 'El DNI debe tener exactamente 8 digitos' });
    const row = await one(`
      INSERT INTO usuarios (dni,nombre,password,rol,tipo,empresa,ruc,email,telefono)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
    `, [dni, nombre, password, rol||'worker', tipo||'planilla', empresa||'', ruc||'', email||'', telefono||'']);
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
    const { nombre, password, rol, tipo, empresa, ruc, email, telefono, activo } = req.body;
    if (activo !== undefined && Object.keys(req.body).length === 1) {
      await pool.query('UPDATE usuarios SET activo=$1 WHERE id=$2', [activo ? 1 : 0, req.params.id]);
      return res.json({ ok: true });
    }
    const params = [nombre, rol||'worker', tipo||'planilla', empresa||'', ruc||'', email||'', telefono||''];
    let sql = 'UPDATE usuarios SET nombre=$1,rol=$2,tipo=$3,empresa=$4,ruc=$5,email=$6,telefono=$7';
    if (password)             { params.push(password);      sql += `,password=$${params.length}`; }
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
    res.json(await all('SELECT id,dni,nombre,tipo,empresa,activo FROM usuarios ORDER BY nombre'));
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
      one("SELECT COUNT(*) as c FROM reembolsos WHERE fecha>=$1 AND fecha<=$2 AND estado='pending'", [d1,d2]),
      one("SELECT COUNT(*) as c FROM reembolsos WHERE fecha>=$1 AND fecha<=$2 AND estado='approved'", [d1,d2]),
      one('SELECT COUNT(DISTINCT usuario_id) as c FROM asistencia WHERE fecha>=$1 AND fecha<=$2', [d1,d2]),
    ]);
    res.json({ totalAtt: parseInt(totalAtt.c), totalRei: parseInt(totalRei.c), montoRei: totalRei.monto||0, pendRei: parseInt(pendRei.c), aprobRei: parseInt(aprobRei.c), workers: parseInt(workers.c) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reports/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const d1 = from || '2000-01-01', d2 = to || '2099-12-31';
    const workers = await all("SELECT id,dni,nombre,tipo,empresa FROM usuarios WHERE rol='worker'");
    const summary = await Promise.all(workers.map(async w => {
      const [att, rei, pend, aprob, docs] = await Promise.all([
        one('SELECT COUNT(*) as c FROM asistencia WHERE usuario_id=$1 AND fecha>=$2 AND fecha<=$3', [w.id,d1,d2]),
        one('SELECT COUNT(*) as c, SUM(monto) as total FROM reembolsos WHERE usuario_id=$1 AND fecha>=$2 AND fecha<=$3', [w.id,d1,d2]),
        one("SELECT COUNT(*) as c FROM reembolsos WHERE usuario_id=$1 AND estado='pending'", [w.id]),
        one("SELECT COUNT(*) as c FROM reembolsos WHERE usuario_id=$1 AND estado='approved'", [w.id]),
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
    res.json({ exportedAt: new Date().toISOString(), version: '2.0', usuarios, asistencia, reembolsos, documentos, empresas_drive, configuracion });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backup/import', requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { usuarios, asistencia, reembolsos, documentos } = req.body;
    await client.query('BEGIN');
    await client.query('DELETE FROM documentos; DELETE FROM reembolsos; DELETE FROM asistencia; DELETE FROM usuarios;');
    for (const u of (usuarios||[])) {
      await client.query(`INSERT INTO usuarios (id,dni,nombre,password,rol,tipo,empresa,ruc,email,telefono,activo,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO UPDATE SET dni=EXCLUDED.dni,nombre=EXCLUDED.nombre`,
        [u.id,u.dni,u.nombre,u.password,u.rol,u.tipo,u.empresa||'',u.ruc||'',u.email||'',u.telefono||'',u.activo,u.created_at]);
    }
    for (const a of (asistencia||[])) {
      await client.query(`INSERT INTO asistencia (id,usuario_id,fecha,hora_entrada,hora_salida,lat_entrada,lng_entrada,direccion_entrada,lat_salida,lng_salida,direccion_salida,estado,notas,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
        [a.id,a.usuario_id,a.fecha,a.hora_entrada,a.hora_salida,a.lat_entrada,a.lng_entrada,a.direccion_entrada||'',a.lat_salida,a.lng_salida,a.direccion_salida||'',a.estado,a.notas,a.created_at]);
    }
    for (const r of (reembolsos||[])) {
      await client.query(`INSERT INTO reembolsos (id,usuario_id,fecha,concepto,monto,ruc_proveedor,nombre_proveedor,tipo_comprobante,numero_documento,estado,archivos,notas,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [r.id,r.usuario_id,r.fecha,r.concepto,r.monto,r.ruc_proveedor,r.nombre_proveedor,r.tipo_comprobante,r.numero_documento,r.estado,r.archivos,r.notas,r.created_at]);
    }
    for (const d of (documentos||[])) {
      await client.query(`INSERT INTO documentos (id,usuario_id,tipo,titulo,periodo,nombre_archivo,tamano,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [d.id,d.usuario_id,d.tipo,d.titulo,d.periodo,d.nombre_archivo,d.tamano,d.created_at]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.post('/api/backup/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM documentos; DELETE FROM reembolsos; DELETE FROM asistencia; DELETE FROM usuarios;');
    await pool.query(`ALTER SEQUENCE usuarios_id_seq RESTART WITH 1; ALTER SEQUENCE asistencia_id_seq RESTART WITH 1; ALTER SEQUENCE reembolsos_id_seq RESTART WITH 1; ALTER SEQUENCE documentos_id_seq RESTART WITH 1;`);
    await pool.query(`INSERT INTO usuarios (dni,nombre,password,rol,tipo,empresa,ruc) VALUES
      ('12345678','Wendy Administradora','1234','admin','planilla','JVN General Services SAC','20603607342'),
      ('87654321','Carlos Tecnico','1234','worker','planilla','JVN General Services SAC','20603607342'),
      ('11223344','Maria Lopez','1234','worker','externo','Freelance',''),
      ('55667788','Jorge Perez','1234','worker','planilla','PEVAL Corporacion EIRL','20611965479')
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
      one("SELECT SUM(monto) as m FROM reembolsos WHERE estado='approved'"),
    ]);
    res.json({
      usuarios: parseInt(usuarios.c), asistencia: parseInt(asistencia.c),
      reembolsos: parseInt(reembolsos.c), documentos: parseInt(documentos.c),
      monto_total: monto.m || 0,
      dbSize: 'Supabase Cloud', uploadsSize: 'Supabase Storage', uptime: 'Render.com'
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  CONFIG EMPRESAS
// ════════════════════════════════════════════════════════════
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
  res.status(400).json({ ok: false, error: 'OneDrive no esta disponible en la version cloud. Usa la exportacion de backup para guardar tus datos.' });
});

// ─── SPA fallback ─────────────────────────────────────────────
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║       NEXORA — Sistema activo        ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Puerto: ${PORT}                        ║`);
  console.log('║  BD: Supabase PostgreSQL             ║');
  console.log('║  Archivos: Supabase Storage          ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});
