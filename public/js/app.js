// ============================================================
//  NEXORA — app.js  (núcleo: roles, navegación, utilidades)
// ============================================================
'use strict';

/* ── Estado global ─────────────────────────────────────────── */
const App = {
  currentUser: null,
  currentModule: 'dashboard',
  canApprove: false,

  /* ── Helpers de roles ── */
  isAdmin()      { return ['administrador','superadministrador'].includes(App.currentUser?.rol); },
  isSuperAdmin() { return App.currentUser?.rol === 'superadministrador'; },
  canViewAll()   { return ['supervisor','gerente','administrador','superadministrador'].includes(App.currentUser?.rol); },

  /* ── Init ── */
  async init() {
    Theme.init();
    try {
      const r = await api('/auth/me');
      App.currentUser = r.user;
    } catch {
      window.location.href = '/';
      return;
    }

    // Cargar potestad de aprobación
    try {
      const p = await api('/config/potestades/me');
      App.canApprove = p.puede_aprobar || false;
    } catch { App.canApprove = false; }

    App.renderUser();
    App.applyRoleVisibility();
    App.initNav();

    if (App.isAdmin()) await App.loadWorkerSelects();
    App.goTo('dashboard');
  },

  renderUser() {
    const u = App.currentUser;
    const avatar = document.getElementById('sidebarAvatar');
    const name   = document.getElementById('sidebarName');
    const role   = document.getElementById('sidebarRole');
    if (avatar) avatar.textContent = u.nombre.charAt(0).toUpperCase();
    if (name)   name.textContent = u.nombre;
    if (role)   role.textContent = App._rolLabel(u.rol);
  },

  _rolLabel(rol) {
    const map = {
      trabajador:        '👷 Trabajador',
      supervisor:        '👁 Supervisor',
      gerente:           '📋 Gerente',
      administrador:     '🛡 Administrador',
      superadministrador:'⭐ Super Admin',
    };
    return map[rol] || rol;
  },

  applyRoleVisibility() {
    // admin-only: visible para administrador y superadministrador
    document.querySelectorAll('.admin-only').forEach(el => {
      if (!App.isAdmin()) {
        el.style.display = 'none';
        return;
      }
      // Restaurar display por tipo de elemento
      if (el.tagName === 'TH' || el.tagName === 'TD') el.style.display = 'table-cell';
      else if (el.classList.contains('nav-link') || el.classList.contains('btn')) el.style.display = '';
      else if (el.classList.contains('nav-section-label')) el.style.display = 'block';
      else el.style.display = '';
    });

    // superadmin-only: visible solo para superadministrador
    document.querySelectorAll('.superadmin-only').forEach(el => {
      if (!App.isSuperAdmin()) {
        el.style.display = 'none';
        return;
      }
      if (el.classList.contains('nav-link')) el.style.display = '';
      else if (el.classList.contains('nav-section-label')) el.style.display = 'block';
      else el.style.display = '';
    });

    // elevated-only: visible para supervisor y superior (pueden ver todos los datos)
    document.querySelectorAll('.elevated-only').forEach(el => {
      if (!App.canViewAll()) {
        el.style.display = 'none';
        return;
      }
      if (el.tagName === 'TH' || el.tagName === 'TD') el.style.display = 'table-cell';
      else el.style.display = '';
    });
  },

  initNav() {
    document.querySelectorAll('.nav-link[data-module]').forEach(btn => {
      btn.addEventListener('click', () => {
        App.goTo(btn.dataset.module);
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('show');
      });
    });
    document.getElementById('hamburger')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarOverlay').classList.toggle('show');
    });
    document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarOverlay').classList.remove('show');
    });
    document.getElementById('logoutBtn')?.addEventListener('click', Auth.logout);
  },

  goTo(module) {
    App.currentModule = module;
    document.querySelectorAll('.nav-link[data-module]').forEach(b => {
      b.classList.toggle('active', b.dataset.module === module);
    });
    document.querySelectorAll('.module-section').forEach(s => {
      s.classList.toggle('active', s.id === `module-${module}`);
    });
    const loaders = {
      dashboard:      () => Dashboard.load(),
      attendance:     () => Attendance.load(),
      reimbursements: () => Reimbursements.load(),
      documents:      () => Documents.load(),
      workers:        () => Workers.load(),
      reports:        () => Reports.loadStats(),
      config:         () => Config.loadStats(),
      catalogos:      () => Catalogos.load(),
    };
    loaders[module]?.();
  },

  async loadWorkerSelects() {
    try {
      const workers = await api('/users/list');
      const selects = ['attWorker','reiWorker','docWorker','dWorker','repWorker'];
      selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const first = sel.options[0].outerHTML;
        sel.innerHTML = first;
        workers.forEach(w => {
          const opt = document.createElement('option');
          opt.value = w.id;
          opt.textContent = `${w.nombre} (${w.dni})`;
          if (!w.activo) opt.textContent += ' — inactivo';
          sel.appendChild(opt);
        });
      });
    } catch(e) { console.warn('loadWorkerSelects:', e.message); }
  },
};

/* ── Tema ────────────────────────────────────────────────────── */
const Theme = {
  init() {
    const saved = localStorage.getItem('nexora_theme') || 'light';
    Theme.apply(saved);
    document.getElementById('themeToggle')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      Theme.apply(cur);
      localStorage.setItem('nexora_theme', cur);
    });
    document.getElementById('topbarTheme')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      Theme.apply(cur);
      localStorage.setItem('nexora_theme', cur);
    });
  },
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon  = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    const top   = document.getElementById('topbarTheme');
    if (theme === 'dark') {
      if (icon)  icon.textContent = '☀️';
      if (label) label.textContent = 'Modo claro';
      if (top)   top.textContent = '☀️';
    } else {
      if (icon)  icon.textContent = '🌙';
      if (label) label.textContent = 'Modo oscuro';
      if (top)   top.textContent = '🌙';
    }
  },
};

/* ── API helper ──────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

/* ── Toast ───────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Modal helpers ───────────────────────────────────────────── */
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

/* ── Drag & Drop genérico ────────────────────────────────────── */
function initDragDrop(zoneId, onFiles) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    onFiles(e.dataTransfer.files);
  });
}

/* ── Format helpers ──────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return '–';
  return new Date(d + (d.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('es-PE');
}
function fmtMoney(n) {
  return 'S/ ' + parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function statusBadge(status) {
  const map = {
    // nuevos estados
    enviado:     ['badge-blue',    'Enviado'],
    en_revision: ['badge-warning', 'En revisión'],
    aprobado:    ['badge-success', 'Aprobado'],
    pagado:      ['badge-teal',    'Pagado'],
    rechazado:   ['badge-danger',  'Rechazado'],
    // estados legacy (por compatibilidad)
    pending:     ['badge-warning', 'Pendiente'],
    approved:    ['badge-success', 'Aprobado'],
    rejected:    ['badge-danger',  'Rechazado'],
    paid:        ['badge-primary', 'Pagado'],
    // asistencia
    activo:      ['badge-success', 'Activo'],
    completado:  ['badge-gray',    'Completado'],
    active:      ['badge-success', 'Activo'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}
function tipoGastoLabel(t) {
  const map = { transporte: '🚗 Transporte', viaticos: '🍽 Viáticos', compras: '🛒 Compras' };
  return map[t] || t || '–';
}
function docTypeLabel(t) {
  const map = {
    boleta_pago:'Boleta de Pago', contrato:'Contrato', constancia:'Constancia',
    rh:'Recibo por Honorarios', cts:'CTS', vacaciones:'Vacaciones',
    memorandum:'Memorándum', certificado:'Certificado', liquidacion:'Liquidación', otro:'Otro'
  };
  return map[t] || t;
}
function docTypeIcon(t) {
  const map = {
    boleta_pago:'💵', contrato:'📜', constancia:'📋', rh:'🧾',
    cts:'🏦', vacaciones:'🏖', memorandum:'📝', certificado:'🏅',
    liquidacion:'📊', otro:'📄'
  };
  return map[t] || '📄';
}

/* ── Init al cargar ──────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => App.init());
