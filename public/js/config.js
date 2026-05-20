// ============================================================
//  NEXORA — config.js
// ============================================================
'use strict';

const Config = {
  async loadStats() {
    const container = document.getElementById('configStats');
    if (!container) return;

    try {
      const data = await api('/backup/stats');

      container.innerHTML = `
        <div style="display:grid;gap:0">
          <div class="stat-row">
            <span class="text-muted">👥 Trabajadores activos</span>
            <strong>${data.usuarios || 0}</strong>
          </div>
          <div class="stat-row">
            <span class="text-muted">📍 Registros de asistencia</span>
            <strong>${data.asistencia || 0}</strong>
          </div>
          <div class="stat-row">
            <span class="text-muted">💳 Reembolsos</span>
            <strong>${data.reembolsos || 0}</strong>
          </div>
          <div class="stat-row">
            <span class="text-muted">📂 Documentos</span>
            <strong>${data.documentos || 0}</strong>
          </div>
          <div class="stat-row">
            <span class="text-muted">💾 Base de datos</span>
            <strong>${data.dbSize || '–'}</strong>
          </div>
          <div class="stat-row">
            <span class="text-muted">📁 Archivos subidos</span>
            <strong>${data.uploadsSize || '–'}</strong>
          </div>
          <div class="stat-row">
            <span class="text-muted">🕐 Tiempo activo</span>
            <strong>${data.uptime || '–'}</strong>
          </div>
        </div>
      `;
    } catch(e) {
      container.innerHTML = `<div class="text-danger">Error al cargar estadísticas: ${e.message}</div>`;
    }

    // Cargar tabla de empresas drive
    Config.loadDriveTable();
  },

  async loadDriveTable() {
    const tbody = document.getElementById('driveBody');
    if (!tbody) return;
    try {
      const empresas = await api('/config/empresas-drive');
      if (empresas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px">Sin empresas configuradas</td></tr>`;
        return;
      }
      tbody.innerHTML = empresas.map(e => `
        <tr id="drive-row-${e.id}">
          <td><strong>${e.nombre_empresa}</strong></td>
          <td>${e.ruc || '–'}</td>
          <td class="text-muted text-sm">${e.gmail_drive || '–'}</td>
          <td class="text-muted text-sm" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.ruta_onedrive || ''}">${e.ruta_onedrive || '<span style="color:var(--text-secondary)">No configurada</span>'}</td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn btn-secondary btn-xs" onclick="Config.editEmpresa(${e.id})">✏️ Editar</button>
              ${e.ruta_onedrive ? `<button class="btn btn-primary btn-xs" onclick="Config.syncOneDrive(${e.id},'${e.nombre_empresa.replace(/'/g,"\\'")}')">🔄 Sincronizar</button>` : ''}
              <button class="btn btn-danger btn-xs" onclick="Config.deleteEmpresa(${e.id})">🗑</button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-danger" style="padding:12px">Error: ${e.message}</td></tr>`;
    }
  },

  addEmpresa() {
    const nombre = prompt('Nombre de la empresa:');
    if (!nombre) return;
    const ruc        = prompt('RUC (opcional):') || '';
    const gmail      = prompt('Gmail de Google Drive (opcional):') || '';
    const rutaOD     = prompt('Ruta local de OneDrive (opcional):\nEjemplo: C:\\Users\\wendy\\OneDrive\\EMPRESA') || '';

    api('/config/empresas-drive', {
      method: 'POST',
      body: { nombre_empresa: nombre, ruc, gmail_drive: gmail, ruta_onedrive: rutaOD }
    }).then(() => {
      toast('✅ Empresa agregada', 'success');
      Config.loadDriveTable();
    }).catch(e => toast(e.message, 'error'));
  },

  async editEmpresa(id) {
    try {
      const empresas = await api('/config/empresas-drive');
      const e = empresas.find(x => x.id === id);
      if (!e) return;

      const nombre  = prompt('Nombre de la empresa:', e.nombre_empresa);
      if (!nombre) return;
      const ruc     = prompt('RUC:', e.ruc || '') || '';
      const gmail   = prompt('Gmail Drive:', e.gmail_drive || '') || '';
      const rutaOD  = prompt('Ruta OneDrive:', e.ruta_onedrive || '') || '';

      await api(`/config/empresas-drive/${id}`, {
        method: 'PUT',
        body: { nombre_empresa: nombre, ruc, gmail_drive: gmail, ruta_onedrive: rutaOD }
      });
      toast('✅ Empresa actualizada', 'success');
      Config.loadDriveTable();
    } catch(e) {
      toast(e.message, 'error');
    }
  },

  async deleteEmpresa(id) {
    if (!confirm('¿Eliminar esta empresa de la lista? Los archivos NO serán borrados.')) return;
    try {
      await api(`/config/empresas-drive/${id}`, { method: 'DELETE' });
      toast('Empresa eliminada', 'success');
      Config.loadDriveTable();
    } catch(e) {
      toast(e.message, 'error');
    }
  },

  async syncOneDrive(empresaId, nombreEmpresa) {
    if (!confirm(`¿Sincronizar ahora con OneDrive de "${nombreEmpresa}"?\n\nEsto copiará la base de datos y todos los archivos subidos.`)) return;
    toast('🔄 Sincronizando...', 'info');
    try {
      const r = await api('/config/sync-onedrive', { method: 'POST', body: { empresaId } });
      toast(r.message || '✅ Sincronización completada', 'success');
    } catch(e) {
      toast('Error: ' + e.message, 'error');
    }
  },

  async importBackup() {
    const fileInput = document.getElementById('backupFile');
    const file = fileInput.files?.[0];

    if (!file) {
      toast('Selecciona un archivo JSON primero', 'error');
      return;
    }

    if (!confirm('⚠️ ADVERTENCIA: Esto sobreescribirá TODOS los datos actuales con los del backup.\n\n¿Está seguro?')) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      await api('/backup/import', { method: 'POST', body: json });
      toast('✅ Backup restaurado correctamente. Recargando...', 'success');
      setTimeout(() => window.location.reload(), 1500);
    } catch(e) {
      toast('Error al importar: ' + e.message, 'error');
    }
  },

  async resetDemo() {
    if (!confirm('⚠️ PELIGRO: Esto borrará TODOS los datos y restaurará los usuarios de demostración.\n\n¿Está completamente seguro?')) return;
    if (!confirm('Segunda confirmación: Esta acción NO se puede deshacer. ¿Continuar?')) return;

    try {
      await api('/backup/reset', { method: 'POST' });
      toast('✅ Sistema restaurado. Redirigiendo al login...', 'success');
      setTimeout(() => { window.location.href = '/'; }, 2000);
    } catch(e) {
      toast('Error: ' + e.message, 'error');
    }
  }
};

// Mostrar nombre del archivo seleccionado para backup
document.addEventListener('DOMContentLoaded', () => {
  const backupFileInput = document.getElementById('backupFile');
  if (backupFileInput) {
    backupFileInput.addEventListener('change', () => {
      const nameEl = document.getElementById('backupFileName');
      if (nameEl) {
        nameEl.textContent = backupFileInput.files?.[0]?.name || '';
      }
    });
  }
});
