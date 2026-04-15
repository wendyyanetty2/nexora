// ============================================================
//  NEXORA — reports.js
// ============================================================
'use strict';

const Reports = {
  async loadStats() {
    const from   = document.getElementById('repFrom')?.value || '';
    const to     = document.getElementById('repTo')?.value || '';
    const worker = document.getElementById('repWorker')?.value || '';
    const status = document.getElementById('repStatus')?.value || '';

    let qs = new URLSearchParams();
    if (from)   qs.set('from', from);
    if (to)     qs.set('to', to);
    if (worker) qs.set('userId', worker);
    if (status) qs.set('status', status);

    try {
      const [attData, reiData] = await Promise.all([
        api('/attendance?' + qs.toString()),
        api('/reimbursements?' + qs.toString())
      ]);

      // Estadísticas de asistencia
      document.getElementById('repAtt').textContent = attData.length;

      // Trabajadores únicos
      const uniqueWorkers = new Set(attData.map(a => a.usuario_id)).size;
      document.getElementById('repWorkers').textContent = uniqueWorkers;

      // Total reembolsos
      const total = reiData.reduce((sum, r) => sum + (r.monto || 0), 0);
      document.getElementById('repMonto').textContent = fmtMoney(total);

      // Pendientes
      const pending = reiData.filter(r => r.estado === 'pending').length;
      document.getElementById('repPend').textContent = pending;
    } catch(e) {
      console.warn('Reports.loadStats:', e.message);
    }
  },

  download(type) {
    const from   = document.getElementById('repFrom')?.value || '';
    const to     = document.getElementById('repTo')?.value || '';
    const worker = document.getElementById('repWorker')?.value || '';
    const status = document.getElementById('repStatus')?.value || '';

    const qs = new URLSearchParams();
    if (from)   qs.set('from', from);
    if (to)     qs.set('to', to);
    if (worker) qs.set('userId', worker);
    if (status) qs.set('status', status);

    const endpoints = {
      attendance:     '/api/attendance/export',
      reimbursements: '/api/reimbursements/export',
      documents:      '/api/documents/export',
      summary:        '/api/reports/summary',
    };

    const url = endpoints[type];
    if (!url) return;

    const link = document.createElement('a');
    link.href = url + '?' + qs.toString();
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('⬇ Descargando CSV...', 'success');
  }
};
