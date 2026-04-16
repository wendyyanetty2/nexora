// ============================================================
//  NEXORA — documents.js
// ============================================================
'use strict';

const Documents = {
  _file: null,

  async load() {
    const type   = document.getElementById('docType')?.value || '';
    const worker = document.getElementById('docWorker')?.value || '';

    let qs = new URLSearchParams();
    if (type)   qs.set('type', type);
    if (worker) qs.set('userId', worker);

    const grid = document.getElementById('docsGrid');
    grid.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;

    try {
      const data = await api('/documents?' + qs.toString());

      if (data.length === 0) {
        grid.innerHTML = `
          <div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted)">
            <div style="font-size:3rem;margin-bottom:12px">📂</div>
            <div>Sin documentos encontrados</div>
          </div>
        `;
        return;
      }

      const isAdmin = App.currentUser.rol === 'admin';

      grid.innerHTML = data.map(d => {
        const ext = d.nombre_archivo.split('.').pop().toLowerCase();
        const isImg = ['jpg','jpeg','png','webp','gif'].includes(ext);
        const isPdf = ext === 'pdf';
        const icon = docTypeIcon(d.tipo);
        const label = docTypeLabel(d.tipo);
        const workerDni = d.dni || '';

        let viewUrl = '';
        if (workerDni) {
          viewUrl = `/api/uploads/documentos/${encodeURIComponent(workerDni)}/${encodeURIComponent(d.nombre_archivo)}`;
        }

        return `
          <div class="doc-card card card-hover">
            <div class="doc-icon">${icon}</div>
            <div class="doc-type-badge"><span class="badge badge-primary">${label}</span></div>
            <div class="doc-title">${d.titulo}</div>
            ${d.periodo ? `<div class="doc-period text-muted text-sm">${d.periodo}</div>` : ''}
            ${isAdmin ? `<div class="doc-worker text-muted text-sm">👤 ${d.nombre}</div>` : ''}
            <div class="doc-meta text-muted text-sm">
              ${fmtDate(d.created_at?.slice(0,10))} · ${d.tamano || ''}
            </div>
            <div class="doc-actions">
              ${viewUrl ? `
                <a href="${viewUrl}" target="_blank" class="btn btn-secondary btn-sm">
                  ${isImg ? '🖼 Ver imagen' : (isPdf ? '📄 Ver PDF' : '⬇ Descargar')}
                </a>
              ` : ''}
              ${isAdmin ? `
                <button class="btn btn-danger btn-sm" onclick="Documents.delete(${d.id})">🗑</button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch(e) {
      grid.innerHTML = `<div class="text-danger" style="padding:20px">Error: ${e.message}</div>`;
    }
  },

  clearFilters() {
    ['docType','docWorker'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    Documents.load();
  },

  openNew() {
    // Limpiar form
    document.getElementById('dWorker').value = '';
    document.getElementById('dTipo').value = 'boleta_pago';
    document.getElementById('dPeriodo').value = '';
    document.getElementById('dTitulo').value = '';
    Documents._file = null;
    document.getElementById('dFilePreview').innerHTML = '';
    document.getElementById('dUploadZone').classList.remove('has-file');

    // Drag & drop
    initDragDrop('dUploadZone', (files) => {
      if (files.length > 0) {
        Documents._file = files[0];
        Documents._renderFilePreview();
      }
    });

    openModal('modalDocumento');
  },

  onFileSelect(input) {
    if (input.files && input.files[0]) {
      Documents._file = input.files[0];
      Documents._renderFilePreview();
    }
  },

  _renderFilePreview() {
    const preview = document.getElementById('dFilePreview');
    const zone    = document.getElementById('dUploadZone');
    if (!preview || !Documents._file) return;

    const f = Documents._file;
    const isImg = f.type.startsWith('image/');
    const url = URL.createObjectURL(f);

    zone.classList.add('has-file');
    preview.innerHTML = `
      <div class="file-preview-item">
        ${isImg
          ? `<img src="${url}" class="file-preview-thumb" alt="${f.name}"/>`
          : `<div class="file-preview-icon">${f.type.includes('pdf') ? '📄' : '📁'}</div>`
        }
        <div class="file-preview-name">${f.name} (${Documents._fmtSize(f.size)})</div>
        <button type="button" class="file-preview-remove" onclick="Documents._clearFile()">✕</button>
      </div>
    `;
  },

  _clearFile() {
    Documents._file = null;
    document.getElementById('dFilePreview').innerHTML = '';
    document.getElementById('dUploadZone').classList.remove('has-file');
    document.getElementById('dFile').value = '';
  },

  _fmtSize(bytes) {
    if (bytes > 1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
    return Math.ceil(bytes/1024) + ' KB';
  },

  async save() {
    const workerId = document.getElementById('dWorker').value;
    const tipo     = document.getElementById('dTipo').value;
    const titulo   = document.getElementById('dTitulo').value.trim();
    const periodo  = document.getElementById('dPeriodo').value;

    if (!workerId) { toast('Selecciona un trabajador', 'error'); return; }
    if (!titulo)   { toast('El título es obligatorio', 'error'); return; }
    if (!Documents._file) { toast('Adjunta un archivo', 'error'); return; }

    const btn = document.getElementById('btnSaveDoc');
    btn.disabled = true;
    btn.textContent = 'Subiendo...';

    try {
      const fd = new FormData();
      fd.append('usuario_id', workerId);
      fd.append('tipo', tipo);
      fd.append('titulo', titulo);
      fd.append('periodo', periodo);
      fd.append('archivo', Documents._file);

      await api('/documents', {
        method: 'POST',
        body: fd,
        headers: {}
      });

      closeModal('modalDocumento');
      toast('✅ Documento subido correctamente', 'success');
      Documents.load();
    } catch(e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Subir documento';
    }
  },

  async delete(id) {
    if (!confirm('¿Eliminar este documento permanentemente? El archivo físico también será eliminado.')) return;
    try {
      await api(`/documents/${id}`, { method: 'DELETE' });
      toast('Documento eliminado', 'success');
      Documents.load();
    } catch(e) {
      toast(e.message, 'error');
    }
  }
};
