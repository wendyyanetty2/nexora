// ============================================================
//  NEXORA — servidor principal
//  Node.js + Express + SQLite + archivos estáticos vanilla
// ============================================================
'use strict';

const express    = require('express');
const Database   = require('better-sqlite3');
const multer     = require('multer');
const cookieParser = require('cookie-parser');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3001;
const DB_FILE = path.join(__dirname, 'nexora.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// ─── Asegurar carpetas ───────────────────────────────────────
['uploads/reembolsos', 'uploads/documentos'].forEach(d => {
  fs.mkdirSync(path.join(__dirname, d), { recursive: true });
});

// ─── Base de datos ───────────────────────────────────────────
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dni TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'worker',
    tipo TEXT DEFAULT 'planilla',
    empresa TEXT DEFAULT '',
    ruc TEXT DEFAULT '',
    email TEXT DEFAULT '',
    telefono TEXT DEFAULT '',
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS asistencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    hora_entrada TEXT,
    hora_salida TEXT,
    lat_entrada REAL,
    lng_entrada REAL,
    direccion_entrada TEXT DEFAULT '',
    lat_salida REAL,
    lng_salida REAL,
    direccion_salida TEXT DEFAULT '',
    estado TEXT DEFAULT 'activo',
    notas TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS reembolsos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    concepto TEXT NOT NULL,
    monto REAL NOT NULL,
    ruc_proveedor TEXT DEFAULT '',
    nombre_proveedor TEXT DEFAULT '',
    tipo_comprobante TEXT DEFAULT '',
    numero_documento TEXT DEFAULT '',
    estado TEXT DEFAULT 'pending',
    archivos TEXT DEFAULT '[]',
    notas TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS documentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    periodo TEXT DEFAULT '',
    nombre_archivo TEXT NOT NULL,
    tamano TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS empresas_drive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_empresa TEXT NOT NULL,
    ruc TEXT DEFAULT '',
    gmail_drive TEXT DEFAULT '',
    ruta_onedrive TEXT DEFAULT '',
    activo INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT DEFAULT ''
  );
`);

// ─── Seed usuarios demo ──────────────────────────────────────
const seedUsers = () => {
  const exists = db.prepare('SELECT COUNT(*) as c FROM usuarios').get();
  if (exists.c > 0) return;
  const ins = db.prepare(`INSERT INTO usuarios (dni,nombre,password,rol,tipo,empresa,ruc) VALUES (?,?,?,?,?,?,?)`);
  ins.run('12345678','Wendy Administradora','1234','admin','planilla','JVÑ General Services SAC','20603607342');
  ins.run('87654321','Carlos Técnico','1234','worker','planilla','JVÑ General Services SAC','20603607342');
  ins.run('11223344','María López','1234','worker','externo','Freelance','');
  ins.run('55667788','Jorge Pérez','1234','worker','planilla','PEVAL Corporación EIRL','20611965479');
  console.log('✅ Usuarios demo cargados');
};
seedUsers();

// ─── Seed empresas y configuración ───────────────────────────
const seedConfig = () => {
  const cntEmp = db.prepare('SELECT COUNT(*) as c FROM empresas_drive').get();
  if (cntEmp.c === 0) {
    db.prepare(`INSERT INTO empresas_drive (nombre_empresa,ruc,gmail_drive,ruta_onedrive) VALUES (?,?,?,?)`)
      .run('JVÑ General Services SAC','20603607342','generalservicesjvn@gmail.com','C:\\Users\\wendy\\OneDrive\\1. DOCUMENTOS JVÑ GENERAL SERVICES');
    db.prepare(`INSERT INTO empresas_drive (nombre_empresa,ruc,gmail_drive,ruta_onedrive) VALUES (?,?,?,?)`)
      .run('PEVAL Corporación EIRL','20611965479','pevalcorp@gmail.com','');
  }
  const cntCfg = db.prepare('SELECT COUNT(*) as c FROM configuracion').get();
  if (cntCfg.c === 0) {
    db.prepare(`INSERT OR IGNORE INTO configuracion (clave,valor) VALUES (?,?)`).run('nombre_sistema','NEXORA');
    db.prepare(`INSERT OR IGNORE INTO configuracion (clave,valor) VALUES (?,?)`).run('empresa_principal','JVÑ General Services SAC');
    db.prepare(`INSERT OR IGNORE INTO configuracion (clave,valor) VALUES (?,?)`).run('ruc_principal','20603607342');
  }
};
seedConfig();

// ─── Tiempo de inicio (para uptime) ──────────────────────────
const startTime = Date.now();

// ─── Helper tamaño carpeta ────────────────────────────────────
function getFolderSize(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const items = fs.readdirSync(dirPath);
  for (const item of items) {
    const full = path.join(dirPath, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) total += getFolderSize(full);
    else total += stat.size;
  }
  return total;
}
function fmtBytes(b) {
  if (b > 1024*1024) return (b/1024/1024).toFixed(1) + ' MB';
  if (b > 1024) return (b/1024).toFixed(0) + ' KB';
  return b + ' B';
}

// ─── Helper exportar todos los datos ─────────────────────────
function exportAllData() {
  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    usuarios: db.prepare('SELECT * FROM usuarios').all(),
    asistencia: db.prepare('SELECT * FROM asistencia').all(),
    reembolsos: db.prepare('SELECT * FROM reembolsos').all(),
    documentos: db.prepare('SELECT * FROM documentos').all(),
    empresas_drive: db.prepare('SELECT * FROM empresas_drive').all(),
    configuracion: db.prepare('SELECT * FROM configuracion').all(),
  };
}

// ─── Sesiones en memoria ─────────────────────────────────────
const sessions = new Map();
const SESSION_COOKIE = 'nexora_sid';
const SESSION_HOURS = 8;

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

// ─── Multer ──────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.uploadFolder || 'reembolsos';
    const dir = path.join(UPLOADS_DIR, folder);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dni = req.user?.dni || 'unknown';
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}_${dni}_${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword','image/gif'];
    cb(null, allowed.includes(file.mimetype) || true); // aceptar todo por flexibilidad
  }
});

// ─── App Express ─────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Servir archivos subidos ─────────────────────────────────
app.get('/api/uploads/reembolsos/:filename', requireAuth, (req, res) => {
  const fp = path.join(UPLOADS_DIR, 'reembolsos', req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(fp);
});

app.get('/api/uploads/documentos/:dni/:filename', requireAuth, (req, res) => {
  const fp = path.join(UPLOADS_DIR, 'documentos', req.params.dni, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(fp);
});

// ════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const { dni, password } = req.body;
  if (!dni || !password) return res.status(400).json({ error: 'DNI y contraseña requeridos' });

  const user = db.prepare('SELECT * FROM usuarios WHERE dni=? AND activo=1').get(String(dni).trim());
  if (!user || user.password !== String(password)) {
    return res.status(401).json({ error: 'DNI o contraseña incorrectos' });
  }

  const { password: _p, ...safeUser } = user;
  const sid = createSession(safeUser);
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true, sameSite: 'lax',
    maxAge: SESSION_HOURS * 3600 * 1000
  });
  res.json({ ok: true, user: safeUser });
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

// ════════════════════════════════════════════════════════════
//  ASISTENCIA
// ════════════════════════════════════════════════════════════
app.get('/api/attendance', requireAuth, (req, res) => {
  const { date, userId, from, to } = req.query;
  let sql = `
    SELECT a.*, u.nombre, u.dni, u.tipo, u.empresa
    FROM asistencia a JOIN usuarios u ON u.id=a.usuario_id
    WHERE 1=1
  `;
  const params = [];

  if (req.user.rol !== 'admin') {
    sql += ' AND a.usuario_id=?'; params.push(req.user.id);
  } else if (userId) {
    sql += ' AND a.usuario_id=?'; params.push(userId);
  }
  if (date) { sql += ' AND a.fecha=?'; params.push(date); }
  if (from) { sql += ' AND a.fecha>=?'; params.push(from); }
  if (to)   { sql += ' AND a.fecha<=?'; params.push(to); }
  sql += ' ORDER BY a.created_at DESC LIMIT 500';

  res.json(db.prepare(sql).all(...params));
});

app.post('/api/attendance/checkin', requireAuth, (req, res) => {
  const { lat, lng, address } = req.body;
  const fecha = new Date().toISOString().slice(0, 10);
  const hora  = new Date().toLocaleTimeString('es-PE', { hour12: false });

  // Buscar si hay un registro activo sin salida hoy
  const existing = db.prepare(
    'SELECT * FROM asistencia WHERE usuario_id=? AND fecha=? AND hora_salida IS NULL ORDER BY id DESC LIMIT 1'
  ).get(req.user.id, fecha);

  if (existing) {
    return res.status(400).json({ error: 'Ya tienes una entrada activa. Marca tu salida primero.' });
  }

  const result = db.prepare(`
    INSERT INTO asistencia (usuario_id, fecha, hora_entrada, lat_entrada, lng_entrada, direccion_entrada)
    VALUES (?,?,?,?,?,?)
  `).run(req.user.id, fecha, hora, lat || null, lng || null, address || '');

  res.json({ ok: true, id: result.lastInsertRowid, hora, fecha, direccion: address });
});

app.post('/api/attendance/checkout', requireAuth, (req, res) => {
  const { lat, lng, address } = req.body;
  const fecha = new Date().toISOString().slice(0, 10);
  const hora  = new Date().toLocaleTimeString('es-PE', { hour12: false });

  const active = db.prepare(
    'SELECT * FROM asistencia WHERE usuario_id=? AND fecha=? AND hora_salida IS NULL ORDER BY id DESC LIMIT 1'
  ).get(req.user.id, fecha);

  if (!active) {
    return res.status(400).json({ error: 'No hay entrada activa para marcar salida. Registra tu entrada primero.' });
  }

  db.prepare(`
    UPDATE asistencia SET hora_salida=?, lat_salida=?, lng_salida=?, direccion_salida=?, estado='completado'
    WHERE id=?
  `).run(hora, lat || null, lng || null, address || '', active.id);

  res.json({ ok: true, hora, fecha, direccion: address });
});

app.get('/api/attendance/export', requireAuth, (req, res) => {
  const { from, to, userId } = req.query;
  let sql = `
    SELECT a.fecha, u.dni, u.nombre, u.tipo, u.empresa,
           a.hora_entrada, a.hora_salida, a.direccion_entrada, a.direccion_salida, a.estado, a.notas
    FROM asistencia a JOIN usuarios u ON u.id=a.usuario_id WHERE 1=1
  `;
  const params = [];
  if (req.user.rol !== 'admin') { sql += ' AND a.usuario_id=?'; params.push(req.user.id); }
  else if (userId) { sql += ' AND a.usuario_id=?'; params.push(userId); }
  if (from) { sql += ' AND a.fecha>=?'; params.push(from); }
  if (to)   { sql += ' AND a.fecha<=?'; params.push(to); }
  sql += ' ORDER BY a.fecha DESC, u.nombre';

  const rows = db.prepare(sql).all(...params);
  const bom = '\uFEFF';
  const header = 'Fecha,DNI,Trabajador,Tipo,Empresa,Hora Entrada,Hora Salida,Ubicación Entrada,Ubicación Salida,Estado,Notas\n';
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
});

// ════════════════════════════════════════════════════════════
//  REEMBOLSOS
// ════════════════════════════════════════════════════════════
app.get('/api/reimbursements', requireAuth, (req, res) => {
  const { status, userId, from, to } = req.query;
  let sql = `
    SELECT r.*, u.nombre, u.dni, u.tipo, u.empresa
    FROM reembolsos r JOIN usuarios u ON u.id=r.usuario_id WHERE 1=1
  `;
  const params = [];
  if (req.user.rol !== 'admin') { sql += ' AND r.usuario_id=?'; params.push(req.user.id); }
  else if (userId) { sql += ' AND r.usuario_id=?'; params.push(userId); }
  if (status) { sql += ' AND r.estado=?'; params.push(status); }
  if (from)   { sql += ' AND r.fecha>=?'; params.push(from); }
  if (to)     { sql += ' AND r.fecha<=?'; params.push(to); }
  sql += ' ORDER BY r.created_at DESC LIMIT 500';

  res.json(db.prepare(sql).all(...params));
});

app.post('/api/reimbursements', requireAuth, (req, _res, next) => {
  req.uploadFolder = 'reembolsos';
  next();
}, upload.array('archivos', 5), (req, res) => {
  const { concepto, monto, ruc_proveedor, nombre_proveedor, tipo_comprobante, numero_documento, notas } = req.body;
  if (!concepto || !monto) return res.status(400).json({ error: 'Concepto y monto son obligatorios' });

  const fecha = new Date().toISOString().slice(0, 10);
  const archivos = (req.files || []).map(f => f.filename);

  const result = db.prepare(`
    INSERT INTO reembolsos (usuario_id,fecha,concepto,monto,ruc_proveedor,nombre_proveedor,tipo_comprobante,numero_documento,archivos,notas)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.id, fecha, concepto, parseFloat(monto)||0,
    ruc_proveedor||'', nombre_proveedor||'', tipo_comprobante||'', numero_documento||'',
    JSON.stringify(archivos), notas||''
  );

  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put('/api/reimbursements/:id', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;
  const valid = ['pending','approved','rejected','paid'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  db.prepare('UPDATE reembolsos SET estado=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/reimbursements/:id', requireAuth, requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reembolsos WHERE id=?').get(req.params.id);
  if (r) {
    const files = JSON.parse(r.archivos || '[]');
    files.forEach(f => {
      const fp = path.join(UPLOADS_DIR, 'reembolsos', f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
  }
  db.prepare('DELETE FROM reembolsos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/reimbursements/export', requireAuth, (req, res) => {
  const { from, to, userId, status } = req.query;
  let sql = `
    SELECT r.fecha, u.dni, u.nombre, u.tipo, u.empresa, r.concepto, r.monto,
           r.ruc_proveedor, r.nombre_proveedor, r.tipo_comprobante, r.numero_documento, r.estado, r.notas
    FROM reembolsos r JOIN usuarios u ON u.id=r.usuario_id WHERE 1=1
  `;
  const params = [];
  if (req.user.rol !== 'admin') { sql += ' AND r.usuario_id=?'; params.push(req.user.id); }
  else if (userId) { sql += ' AND r.usuario_id=?'; params.push(userId); }
  if (status) { sql += ' AND r.estado=?'; params.push(status); }
  if (from)   { sql += ' AND r.fecha>=?'; params.push(from); }
  if (to)     { sql += ' AND r.fecha<=?'; params.push(to); }
  sql += ' ORDER BY r.fecha DESC';

  const rows = db.prepare(sql).all(...params);
  const bom = '\uFEFF';
  const header = 'Fecha,DNI,Trabajador,Tipo,Empresa,Concepto,Monto S/,RUC Proveedor,Proveedor,Tipo Doc,N° Doc,Estado,Notas\n';
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
});

// ════════════════════════════════════════════════════════════
//  DOCUMENTOS DE RRHH
// ════════════════════════════════════════════════════════════
app.get('/api/documents', requireAuth, (req, res) => {
  const { userId, type } = req.query;
  let sql = `
    SELECT d.*, u.nombre, u.dni
    FROM documentos d JOIN usuarios u ON u.id=d.usuario_id WHERE 1=1
  `;
  const params = [];
  if (req.user.rol !== 'admin') { sql += ' AND d.usuario_id=?'; params.push(req.user.id); }
  else if (userId) { sql += ' AND d.usuario_id=?'; params.push(userId); }
  if (type) { sql += ' AND d.tipo=?'; params.push(type); }
  sql += ' ORDER BY d.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/documents', requireAuth, requireAdmin, (req, _res, next) => {
  req.uploadFolder = 'documentos/temp';
  next();
}, upload.single('archivo'), (req, res) => {
  const { usuario_id, tipo, titulo, periodo } = req.body;
  if (!usuario_id || !tipo || !titulo || !req.file)
    return res.status(400).json({ error: 'Faltan campos requeridos o archivo' });

  // Mover a carpeta del trabajador
  const worker = db.prepare('SELECT * FROM usuarios WHERE id=?').get(usuario_id);
  if (!worker) return res.status(404).json({ error: 'Trabajador no encontrado' });

  const destDir = path.join(UPLOADS_DIR, 'documentos', worker.dni);
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, req.file.filename);

  // Mover desde temp
  const srcFile = path.join(UPLOADS_DIR, 'documentos', 'temp', req.file.filename);
  if (fs.existsSync(srcFile)) {
    fs.renameSync(srcFile, destFile);
  }

  const tamano = req.file.size > 1024*1024
    ? `${(req.file.size/1024/1024).toFixed(1)} MB`
    : `${Math.ceil(req.file.size/1024)} KB`;

  db.prepare(`
    INSERT INTO documentos (usuario_id,tipo,titulo,periodo,nombre_archivo,tamano)
    VALUES (?,?,?,?,?,?)
  `).run(parseInt(usuario_id), tipo, titulo, periodo||'', req.file.filename, tamano);

  res.json({ ok: true });
});

app.delete('/api/documents/:id', requireAuth, requireAdmin, (req, res) => {
  const doc = db.prepare(`
    SELECT d.*, u.dni FROM documentos d JOIN usuarios u ON u.id=d.usuario_id WHERE d.id=?
  `).get(req.params.id);
  if (doc) {
    const fp = path.join(UPLOADS_DIR, 'documentos', doc.dni, doc.nombre_archivo);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('DELETE FROM documentos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/documents/export', requireAuth, requireAdmin, (req, res) => {
  const { from, to, userId, type } = req.query;
  let sql = `
    SELECT d.created_at, u.dni, u.nombre, d.tipo, d.titulo, d.periodo, d.nombre_archivo, d.tamano
    FROM documentos d JOIN usuarios u ON u.id=d.usuario_id WHERE 1=1
  `;
  const params = [];
  if (userId) { sql += ' AND d.usuario_id=?'; params.push(userId); }
  if (type)   { sql += ' AND d.tipo=?'; params.push(type); }
  if (from)   { sql += ' AND substr(d.created_at,1,10)>=?'; params.push(from); }
  if (to)     { sql += ' AND substr(d.created_at,1,10)<=?'; params.push(to); }
  sql += ' ORDER BY d.created_at DESC';

  const rows = db.prepare(sql).all(...params);
  const bom = '\uFEFF';
  const header = 'Fecha,DNI,Trabajador,Tipo Documento,Título,Período,Archivo,Tamaño\n';
  const csv = rows.map(r => [
    r.created_at.slice(0,10), r.dni, `"${r.nombre}"`,
    r.tipo, `"${r.titulo}"`, r.periodo||'', r.nombre_archivo, r.tamano
  ].join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="documentos_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(bom + header + csv);
});

// ════════════════════════════════════════════════════════════
//  TRABAJADORES (admin)
// ════════════════════════════════════════════════════════════
app.get('/api/workers', requireAuth, requireAdmin, (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT id,dni,nombre,rol,tipo,empresa,ruc,email,telefono,activo,created_at FROM usuarios WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (nombre LIKE ? OR dni LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY nombre';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/workers', requireAuth, requireAdmin, (req, res) => {
  const { dni, nombre, password, rol, tipo, empresa, ruc, email, telefono } = req.body;
  if (!dni || !nombre || !password) return res.status(400).json({ error: 'DNI, nombre y contraseña son requeridos' });
  if (!/^\d{8}$/.test(dni)) return res.status(400).json({ error: 'El DNI debe tener exactamente 8 dígitos' });
  try {
    const r = db.prepare(`
      INSERT INTO usuarios (dni,nombre,password,rol,tipo,empresa,ruc,email,telefono)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(dni, nombre, password, rol||'worker', tipo||'planilla', empresa||'', ruc||'', email||'', telefono||'');
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch(e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'El DNI ya está registrado' });
    throw e;
  }
});

app.put('/api/workers/:id', requireAuth, requireAdmin, (req, res) => {
  const { nombre, password, rol, tipo, empresa, ruc, email, telefono, activo } = req.body;
  // Si solo se envía activo (toggle rápido)
  if (activo !== undefined && Object.keys(req.body).length === 1) {
    db.prepare('UPDATE usuarios SET activo=? WHERE id=?').run(activo ? 1 : 0, req.params.id);
    return res.json({ ok: true });
  }
  const fields = ['nombre=?','rol=?','tipo=?','empresa=?','ruc=?','email=?','telefono=?'];
  const params = [nombre, rol||'worker', tipo||'planilla', empresa||'', ruc||'', email||'', telefono||''];
  if (password) { fields.push('password=?'); params.push(password); }
  if (activo !== undefined) { fields.push('activo=?'); params.push(activo ? 1 : 0); }
  params.push(req.params.id);
  db.prepare(`UPDATE usuarios SET ${fields.join(',')} WHERE id=?`).run(...params);
  res.json({ ok: true });
});

app.put('/api/workers/:id/toggle', requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare('SELECT activo FROM usuarios WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('UPDATE usuarios SET activo=? WHERE id=?').run(user.activo ? 0 : 1, req.params.id);
  res.json({ ok: true, activo: !user.activo });
});

app.get('/api/workers/export', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT dni,nombre,rol,tipo,empresa,ruc,email,telefono,activo,created_at FROM usuarios ORDER BY nombre').all();
  const bom = '\uFEFF';
  const header = 'DNI,Nombre,Rol,Tipo,Empresa,RUC,Email,Teléfono,Activo,Fecha Registro\n';
  const csv = rows.map(r => [
    r.dni, `"${r.nombre}"`, r.rol, r.tipo, `"${r.empresa}"`,
    r.ruc||'', r.email||'', r.telefono||'',
    r.activo ? 'Sí' : 'No', r.created_at
  ].join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="trabajadores_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(bom + header + csv);
});

// ════════════════════════════════════════════════════════════
//  REPORTES (admin)
// ════════════════════════════════════════════════════════════

// Resumen general
app.get('/api/reports/summary', requireAuth, requireAdmin, (req, res) => {
  const { from, to } = req.query;
  let dateFilter = '1=1';
  const params1 = [], params2 = [], params3 = [];
  if (from) { dateFilter = 'a.fecha>=? AND a.fecha<=?'; params1.push(from, to||new Date().toISOString().slice(0,10)); }

  const workers = db.prepare('SELECT id,dni,nombre,tipo,empresa FROM usuarios WHERE rol=\'worker\'').all();
  const summary = workers.map(w => {
    const att = db.prepare(`SELECT COUNT(*) as c FROM asistencia WHERE usuario_id=? ${from ? 'AND fecha>=? AND fecha<=?' : ''}`).get(w.id, ...(from ? [from, to||new Date().toISOString().slice(0,10)] : []));
    const rei = db.prepare(`SELECT COUNT(*) as c, SUM(monto) as total FROM reembolsos WHERE usuario_id=? ${from ? 'AND fecha>=? AND fecha<=?' : ''}`).get(w.id, ...(from ? [from, to||new Date().toISOString().slice(0,10)] : []));
    const pend = db.prepare(`SELECT COUNT(*) as c FROM reembolsos WHERE usuario_id=? AND estado='pending'`).get(w.id);
    const aprob = db.prepare(`SELECT COUNT(*) as c FROM reembolsos WHERE usuario_id=? AND estado='approved'`).get(w.id);
    const docs = db.prepare(`SELECT COUNT(*) as c FROM documentos WHERE usuario_id=?`).get(w.id);
    return { ...w, dias_asistidos: att.c, total_reembolsos: rei.c, monto_reembolsos: rei.total||0, pendientes: pend.c, aprobados: aprob.c, documentos: docs.c };
  });

  const bom = '\uFEFF';
  const header = 'DNI,Trabajador,Tipo,Empresa,Días Asistidos,Total Reembolsos,Monto Reembolsos S/,Reembolsos Pendientes,Reembolsos Aprobados,Documentos\n';
  const csv = summary.map(r => [
    r.dni, `"${r.nombre}"`, r.tipo, `"${r.empresa}"`,
    r.dias_asistidos, r.total_reembolsos, r.monto_reembolsos.toFixed(2),
    r.pendientes, r.aprobados, r.documentos
  ].join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="resumen_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(bom + header + csv);
});

// Stats para dashboard de reportes
app.get('/api/reports/stats', requireAuth, requireAdmin, (req, res) => {
  const { from, to } = req.query;
  const d1 = from || '2000-01-01', d2 = to || '2099-12-31';
  const totalAtt = db.prepare('SELECT COUNT(*) as c FROM asistencia WHERE fecha>=? AND fecha<=?').get(d1,d2);
  const totalRei = db.prepare('SELECT COUNT(*) as c, SUM(monto) as monto FROM reembolsos WHERE fecha>=? AND fecha<=?').get(d1,d2);
  const pendRei  = db.prepare('SELECT COUNT(*) as c FROM reembolsos WHERE fecha>=? AND fecha<=? AND estado=\'pending\'').get(d1,d2);
  const aprobRei = db.prepare('SELECT COUNT(*) as c FROM reembolsos WHERE fecha>=? AND fecha<=? AND estado=\'approved\'').get(d1,d2);
  const workers  = db.prepare('SELECT COUNT(DISTINCT usuario_id) as c FROM asistencia WHERE fecha>=? AND fecha<=?').get(d1,d2);
  res.json({ totalAtt: totalAtt.c, totalRei: totalRei.c, montoRei: totalRei.monto||0, pendRei: pendRei.c, aprobRei: aprobRei.c, workers: workers.c });
});

// ════════════════════════════════════════════════════════════
//  BACKUP / CONFIG (admin)
// ════════════════════════════════════════════════════════════
app.get('/api/backup/export', requireAuth, requireAdmin, (req, res) => {
  const data = exportAllData();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="nexora_backup_${new Date().toISOString().slice(0,10)}.json"`);
  res.json(data);
});

app.post('/api/backup/import', requireAuth, requireAdmin, (req, res) => {
  const { usuarios, asistencia, reembolsos, documentos } = req.body;
  const tx = db.transaction(() => {
    db.exec('DELETE FROM documentos; DELETE FROM reembolsos; DELETE FROM asistencia; DELETE FROM usuarios;');
    (usuarios||[]).forEach(u => {
      db.prepare(`INSERT OR REPLACE INTO usuarios (id,dni,nombre,password,rol,tipo,empresa,ruc,email,telefono,activo,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(u.id,u.dni,u.nombre,u.password,u.rol,u.tipo,u.empresa||'',u.ruc||'',u.email||'',u.telefono||'',u.activo,u.created_at);
    });
    (asistencia||[]).forEach(a => {
      db.prepare(`INSERT OR REPLACE INTO asistencia VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(a.id,a.usuario_id,a.fecha,a.hora_entrada,a.hora_salida,a.lat_entrada,a.lng_entrada,a.direccion_entrada,a.lat_salida,a.lng_salida,a.direccion_salida,a.estado,a.notas,a.created_at);
    });
    (reembolsos||[]).forEach(r => {
      db.prepare(`INSERT OR REPLACE INTO reembolsos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(r.id,r.usuario_id,r.fecha,r.concepto,r.monto,r.ruc_proveedor,r.nombre_proveedor,r.tipo_comprobante,r.numero_documento,r.estado,r.archivos,r.notas,r.created_at);
    });
    (documentos||[]).forEach(d => {
      db.prepare(`INSERT OR REPLACE INTO documentos VALUES (?,?,?,?,?,?,?,?)`)
        .run(d.id,d.usuario_id,d.tipo,d.titulo,d.periodo,d.nombre_archivo,d.tamano,d.created_at);
    });
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/backup/reset', requireAuth, requireAdmin, (req, res) => {
  db.exec('DELETE FROM documentos; DELETE FROM reembolsos; DELETE FROM asistencia; DELETE FROM usuarios;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('usuarios','asistencia','reembolsos','documentos');");
  seedUsers();
  res.json({ ok: true });
});

app.get('/api/backup/stats', requireAuth, requireAdmin, (req, res) => {
  const uptimeSecs = Math.floor((Date.now() - startTime) / 1000);
  const hrs  = Math.floor(uptimeSecs / 3600);
  const mins = Math.floor((uptimeSecs % 3600) / 60);
  const secs = uptimeSecs % 60;
  const uptime = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m ${secs}s`;
  const dbSize = fs.existsSync(DB_FILE) ? fmtBytes(fs.statSync(DB_FILE).size) : '–';
  const uploadsSize = fmtBytes(getFolderSize(UPLOADS_DIR));
  res.json({
    usuarios:     db.prepare('SELECT COUNT(*) as c FROM usuarios WHERE activo=1').get().c,
    asistencia:   db.prepare('SELECT COUNT(*) as c FROM asistencia').get().c,
    reembolsos:   db.prepare('SELECT COUNT(*) as c FROM reembolsos').get().c,
    documentos:   db.prepare('SELECT COUNT(*) as c FROM documentos').get().c,
    monto_total:  db.prepare("SELECT SUM(monto) as m FROM reembolsos WHERE estado='approved'").get().m || 0,
    dbSize, uploadsSize, uptime,
  });
});

// ─── Eliminar trabajador ──────────────────────────────────────
app.delete('/api/workers/:id', requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  // No permitir eliminar al propio admin logueado
  if (String(req.user.id) === String(id)) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  }
  const user = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'Trabajador no encontrado' });

  // Eliminar datos relacionados primero
  db.prepare('DELETE FROM asistencia WHERE usuario_id=?').run(id);
  db.prepare('DELETE FROM reembolsos WHERE usuario_id=?').run(id);
  db.prepare('DELETE FROM documentos WHERE usuario_id=?').run(id);
  db.prepare('DELETE FROM usuarios WHERE id=?').run(id);
  res.json({ ok: true });
});

// ─── Importar trabajadores desde CSV/Excel ────────────────────
app.post('/api/workers/import', requireAuth, requireAdmin, (req, res) => {
  // Acepta JSON con array de trabajadores
  const { trabajadores } = req.body;
  if (!Array.isArray(trabajadores) || trabajadores.length === 0) {
    return res.status(400).json({ error: 'Lista de trabajadores vacía o inválida' });
  }

  const creados = [], errores = [];
  const ins = db.prepare(`
    INSERT INTO usuarios (dni,nombre,password,rol,tipo,empresa,ruc,email,telefono)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);

  trabajadores.forEach((w, i) => {
    try {
      const dni = String(w.dni || '').trim();
      const nombre = String(w.nombre || '').trim();
      if (!dni || dni.length !== 8 || !/^\d{8}$/.test(dni)) {
        errores.push(`Fila ${i+1}: DNI inválido (${dni})`);
        return;
      }
      if (!nombre) {
        errores.push(`Fila ${i+1}: Nombre vacío`);
        return;
      }
      // Contraseña por defecto = su DNI (puede cambiarlo después)
      const password = w.password || dni;
      ins.run(
        dni, nombre, password,
        w.rol || 'worker',
        w.tipo || 'planilla',
        w.empresa || '',
        w.ruc || '',
        w.email || '',
        w.telefono || ''
      );
      creados.push(nombre);
    } catch(e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        errores.push(`Fila ${i+1}: DNI ${w.dni} ya existe`);
      } else {
        errores.push(`Fila ${i+1}: ${e.message}`);
      }
    }
  });

  res.json({ ok: true, creados: creados.length, errores, nombres: creados });
});

// ─── Cambiar contraseña (propio usuario) ─────────────────────
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { passwordActual, passwordNueva } = req.body;
  if (!passwordActual || !passwordNueva) {
    return res.status(400).json({ error: 'Debes ingresar la contraseña actual y la nueva' });
  }
  if (passwordNueva.length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  }

  const user = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.user.id);
  if (!user || user.password !== String(passwordActual)) {
    return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
  }

  db.prepare('UPDATE usuarios SET password=? WHERE id=?').run(String(passwordNueva), req.user.id);

  // Actualizar sesión con nuevo dato
  const sid = req.cookies?.[SESSION_COOKIE];
  const sess = sessions.get(sid);
  if (sess) sess.user = { ...sess.user };

  res.json({ ok: true });
});

// ─── Lista de trabajadores para selects ──────────────────────
app.get('/api/users/list', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,dni,nombre,tipo,empresa,activo FROM usuarios ORDER BY nombre').all());
});

// ════════════════════════════════════════════════════════════
//  CONFIG EMPRESAS / DRIVE (admin)
// ════════════════════════════════════════════════════════════
app.get('/api/config/empresas-drive', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM empresas_drive ORDER BY id').all());
});

app.post('/api/config/empresas-drive', requireAuth, requireAdmin, (req, res) => {
  const { nombre_empresa, ruc, gmail_drive, ruta_onedrive } = req.body;
  if (!nombre_empresa) return res.status(400).json({ error: 'Nombre de empresa requerido' });
  const r = db.prepare(
    'INSERT INTO empresas_drive (nombre_empresa,ruc,gmail_drive,ruta_onedrive) VALUES (?,?,?,?)'
  ).run(nombre_empresa, ruc||'', gmail_drive||'', ruta_onedrive||'');
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put('/api/config/empresas-drive/:id', requireAuth, requireAdmin, (req, res) => {
  const { nombre_empresa, ruc, gmail_drive, ruta_onedrive } = req.body;
  db.prepare(
    'UPDATE empresas_drive SET nombre_empresa=?,ruc=?,gmail_drive=?,ruta_onedrive=? WHERE id=?'
  ).run(nombre_empresa||'', ruc||'', gmail_drive||'', ruta_onedrive||'', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/config/empresas-drive/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM empresas_drive WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/config/sync-onedrive', requireAuth, requireAdmin, (req, res) => {
  const { empresaId } = req.body;
  try {
    const empresa = db.prepare('SELECT * FROM empresas_drive WHERE id=?').get(empresaId);
    if (!empresa?.ruta_onedrive) {
      return res.status(400).json({ ok: false, error: 'Esta empresa no tiene ruta de OneDrive configurada' });
    }
    if (!fs.existsSync(empresa.ruta_onedrive)) {
      return res.status(400).json({ ok: false, error: `La ruta no existe: ${empresa.ruta_onedrive}` });
    }

    const rutaBase    = path.join(empresa.ruta_onedrive, 'NEXORA_SISTEMA');
    const backupsDir  = path.join(rutaBase, 'backups');
    const uploadsSync = path.join(rutaBase, 'uploads');
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.mkdirSync(uploadsSync, { recursive: true });

    const fecha = new Date().toISOString().slice(0, 10);

    // Copiar DB
    fs.copyFileSync(DB_FILE, path.join(backupsDir, `nexora_${fecha}.db`));

    // Copiar uploads
    if (fs.existsSync(UPLOADS_DIR)) {
      fs.cpSync(UPLOADS_DIR, uploadsSync, { recursive: true });
    }

    // Backup JSON
    const backup = exportAllData();
    fs.writeFileSync(
      path.join(backupsDir, `nexora_backup_${fecha}.json`),
      JSON.stringify(backup, null, 2)
    );

    res.json({ ok: true, message: `✅ Sincronizado con OneDrive de ${empresa.nombre_empresa}` });
  } catch(err) {
    res.status(500).json({ ok: false, error: 'Error de sincronización: ' + err.message });
  }
});

// ─── SPA fallback ─────────────────────────────────────────────
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// ─── Error handler ────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

// ─── Iniciar ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║       NEXORA — Sistema activo        ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  http://localhost:${PORT}               ║`);
  console.log('║                                      ║');
  console.log('║  Admin: DNI 12345678  Clave: 1234   ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});
