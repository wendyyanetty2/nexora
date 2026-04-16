// ============================================================
//  NEXORA — reimbursements.js
// ============================================================
'use strict';

const Reimbursements = {
  _files: [],

  _defaultMonth(fromId, toId) {
    const now   = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0,10);
    const fromEl = document.getElementById(fromId);
    const toEl   = document.getElementById(toId);
    if (fromEl && !fromEl.value) fromEl.value = first;
    if (toEl   && !toEl.value)   toEl.value   = last;
  },

  async load() {
    // Filtrar por mes actual si no hay rango definido
    Reimbursements._defaultMonth('reiFrom', 'reiTo');

    const status = document.getElementById('reiStatus')?.value || '';
    const from   = document.getElementById('reiFrom')?.value || '';
    const to     = document.getElementById('reiTo')?.value || '';
    const worker = document.getElementById('reiWorker')?.value || '';

    let qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (from)   qs.set('from', from);
    if (to)     qs.set('to', to);
    if (worker) qs.set('userId', worker);

    // Actualizar export URL
    const exportBtn = document.getElementById('exportReiBtn');
    if (exportBtn) exportBtn.href = '/api/reimbursements/export?' + qs.toString();

    const tbody = document.getElementById('reiBody');
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px"><div class="spinner"></div></td></tr>`;

    try {
      const data = await api('/reimbursements?' + qs.toString());
      const isAdmin = App.currentUser.rol === 'admin';

      if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-muted" style="text-align:center;padding:40px">Sin solicitudes encontradas</td></tr>`;
        return;
      }

      tbody.innerHTML = data.map(r => {
        const files = JSON.parse(r.archivos || '[]');
        const fileLinks = files.map(f =>
          `<a href="/api/uploads/reembolsos/${encodeURIComponent(f)}" target="_blank" class="file-link" title="${f}">📎</a>`
        ).join(' ');

        const acciones = isAdmin ? `
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${r.estado === 'pending' ? `
              <button class="btn btn-success btn-xs" onclick="Reimbursements.updateStatus(${r.id},'approved')">✓ Aprobar</button>
              <button class="btn btn-danger btn-xs" onclick="Reimbursements.updateStatus(${r.id},'rejected')">✗ Rechazar</button>
            ` : ''}
            ${r.estado === 'approved' ? `
              <button class="btn btn-primary btn-xs" onclick="Reimbursements.updateStatus(${r.id},'paid')">💰 Pagar</button>
            ` : ''}
            <button class="btn btn-danger btn-xs" onclick="Reimbursements.delete(${r.id})">🗑</button>
          </div>
        ` : `<span class="text-muted text-sm">–</span>`;

        return `
          <tr>
            <td>${fmtDate(r.fecha)}</td>
            <td class="admin-only" ${!isAdmin ? 'style="display:none"' : ''}>${r.nombre || '–'}</td>
            <td>${r.concepto}</td>
            <td class="text-sm">${r.nombre_proveedor || '–'}${r.ruc_proveedor ? '<br><span class="text-muted">RUC: '+r.ruc_proveedor+'</span>' : ''}</td>
            <td class="text-sm">${r.tipo_comprobante || '–'}${r.numero_documento ? '<br><span class="text-muted">'+r.numero_documento+'</span>' : ''}</td>
            <td><strong>${fmtMoney(r.monto)}</strong></td>
            <td style="text-align:center">${fileLinks || '<span class="text-muted">–</span>'}</td>
            <td>${statusBadge(r.estado)}</td>
            <td>${acciones}</td>
          </tr>
        `;
      }).join('');
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-danger" style="text-align:center;padding:20px">Error: ${e.message}</td></tr>`;
    }
  },

  clearFilters() {
    // Limpia estado y trabajador, vuelve al mes actual
    ['reiStatus','reiWorker'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['reiFrom','reiTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    Reimbursements.load();
  },

  openNew() {
    // Limpiar form
    ['rConcepto','rMonto','rRuc','rProveedor','rNumDoc','rNotas'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('rTipoDoc').value = '';
    Reimbursements._files = [];
    document.getElementById('rFilePreview').innerHTML = '';
    document.getElementById('rUploadZone').classList.remove('has-file');

    // Init drag & drop
    initDragDrop('rUploadZone', (files) => Reimbursements.onFileSelect(files));

    openModal('modalReembolso');
  },

  onFileSelect(files) {
    // Acumular archivos
    Array.from(files).forEach(f => {
      if (Reimbursements._files.length < 5) {
        Reimbursements._files.push(f);
      }
    });
    Reimbursements._renderFilePreview();
  },

  _renderFilePreview() {
    const preview = document.getElementById('rFilePreview');
    if (!preview) return;

    if (Reimbursements._files.length === 0) {
      preview.innerHTML = '';
      return;
    }

    preview.innerHTML = Reimbursements._files.map((f, i) => {
      const isImg = f.type.startsWith('image/');
      const url = URL.createObjectURL(f);
      return `
        <div class="file-preview-item">
          ${isImg
            ? `<img src="${url}" class="file-preview-thumb" alt="${f.name}"/>`
            : `<div class="file-preview-icon">📄</div>`
          }
          <div class="file-preview-name">${f.name}</div>
          <button type="button" class="file-preview-remove" onclick="Reimbursements._removeFile(${i})">✕</button>
        </div>
      `;
    }).join('');
  },

  _removeFile(index) {
    Reimbursements._files.splice(index, 1);
    Reimbursements._renderFilePreview();
  },

  async save() {
    const concepto = document.getElementById('rConcepto').value.trim();
    const monto    = document.getElementById('rMonto').value;

    if (!concepto || !monto) {
      toast('Concepto y monto son obligatorios', 'error');
      return;
    }

    const btn = document.getElementById('btnSaveReembolso');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
      const fd = new FormData();
      fd.append('concepto', concepto);
      fd.append('monto', monto);
      fd.append('ruc_proveedor', document.getElementById('rRuc').value || '');
      fd.append('nombre_proveedor', document.getElementById('rProveedor').value || '');
      fd.append('tipo_comprobante', document.getElementById('rTipoDoc').value || '');
      fd.append('numero_documento', document.getElementById('rNumDoc').value || '');
      fd.append('notas', document.getElementById('rNotas').value || '');

      Reimbursements._files.forEach(f => fd.append('archivos', f));

      await api('/reimbursements', {
        method: 'POST',
        body: fd,
        headers: {} // No Content-Type: dejar que FormData ponga boundary
      });

      closeModal('modalReembolso');
      toast('✅ Solicitud enviada correctamente', 'success');
      Reimbursements.load();
    } catch(e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar solicitud';
    }
  },

  async updateStatus(id, status) {
    const labels = { approved: 'aprobar', rejected: 'rechazar', paid: 'marcar como pagado' };
    if (!confirm(`¿Desea ${labels[status] || status} esta solicitud?`)) return;
    try {
      await api(`/reimbursements/${id}`, { method: 'PUT', body: { status } });
      toast('Estado actualizado', 'success');
      Reimbursements.load();
    } catch(e) {
      toast(e.message, 'error');
    }
  },

  async delete(id) {
    if (!confirm('¿Eliminar esta solicitud permanentemente?')) return;
    try {
      await api(`/reimbursements/${id}`, { method: 'DELETE' });
      toast('Solicitud eliminada', 'success');
      Reimbursements.load();
    } catch(e) {
      toast(e.message, 'error');
    }
  }
};
