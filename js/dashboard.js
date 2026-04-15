// ============================================================
//  NEXORA — dashboard.js
// ============================================================
'use strict';

const Dashboard = {
  async load() {
    // Mostrar fecha de hoy
    const now = new Date();
    const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
    const dateStr = now.toLocaleDateString('es-PE', opts);
    const el = document.getElementById('dashDate');
    if (el) el.textContent = dateStr;

    const subtitle = document.getElementById('dashSubtitle');
    if (subtitle) {
      const u = App.currentUser;
      subtitle.textContent = `Bienvenido, ${u.nombre}`;
    }

    // Cargar KPIs y listas en paralelo
    try {
      const [attData, reiData, docsData] = await Promise.all([
        api('/attendance?from=' + now.toISOString().slice(0,10) + '&to=' + now.toISOString().slice(0,10)),
        api('/reimbursements'),
        api('/documents'),
      ]);

      // KPI: asistencias hoy
      document.getElementById('kpiAtt').textContent = attData.length;

      // KPI: reembolsos pendientes
      const pending = reiData.filter(r => r.estado === 'pending');
      document.getElementById('kpiPend').textContent = pending.length;

      // KPI: monto aprobado este mes
      const ym = now.toISOString().slice(0,7);
      const montoMes = reiData
        .filter(r => (r.estado === 'approved' || r.estado === 'paid') && r.fecha && r.fecha.startsWith(ym))
        .reduce((sum, r) => sum + (r.monto || 0), 0);
      document.getElementById('kpiMonto').textContent = fmtMoney(montoMes);

      // KPI: mis documentos
      document.getElementById('kpiDocs').textContent = docsData.length;

      // Lista asistencia reciente
      const attList = document.getElementById('dashRecentAtt');
      if (attList) {
        if (attData.length === 0) {
          attList.innerHTML = '<li class="text-muted text-sm" style="padding:12px;text-align:center">Sin registros hoy</li>';
        } else {
          attList.innerHTML = attData.slice(0, 5).map(a => `
            <li class="recent-item">
              <div class="recent-icon">📍</div>
              <div class="recent-info">
                <div class="recent-title">${App.currentUser.rol === 'admin' ? a.nombre + ' — ' : ''}${a.fecha}</div>
                <div class="recent-sub">
                  Entrada: ${a.hora_entrada || '–'} | Salida: ${a.hora_salida || 'En curso'}
                </div>
              </div>
              <div>${statusBadge(a.estado)}</div>
            </li>
          `).join('');
        }
      }

      // Lista reembolsos recientes
      const reiList = document.getElementById('dashRecentRei');
      if (reiList) {
        if (reiData.length === 0) {
          reiList.innerHTML = '<li class="text-muted text-sm" style="padding:12px;text-align:center">Sin solicitudes</li>';
        } else {
          reiList.innerHTML = reiData.slice(0, 5).map(r => `
            <li class="recent-item">
              <div class="recent-icon">💳</div>
              <div class="recent-info">
                <div class="recent-title">${r.concepto}</div>
                <div class="recent-sub">${fmtDate(r.fecha)} · ${fmtMoney(r.monto)}</div>
              </div>
              <div>${statusBadge(r.estado)}</div>
            </li>
          `).join('');
        }
      }
    } catch(e) {
      console.warn('Dashboard.load:', e.message);
    }
  }
};
