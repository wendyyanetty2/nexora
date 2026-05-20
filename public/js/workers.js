// ============================================================
//  NEXORA — workers.js
// ============================================================
'use strict';

const Workers = {
  async load() {
    const search = document.getElementById('workerSearch')?.value.trim().toLowerCase() || '';
    const tbody  = document.getElementById('workersBody');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px"><div class="spinner"></div></td></tr>`;

    try {
      let data = await api('/users/list?all=1');
      if (search) {
        data = data.filter(w =>
          w.nombre.toLowerCase().includes(search) || w.dni.includes(search)
        );
      }

      if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:40px">Sin trabajadores encontrados</td></tr>`;
        return;
      }

      tbody.innerHTML = data.map(w => `
        <tr ${!w.activo ? 'style="opacity:0.55"' : ''}>
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <div class="user-avatar" style="width:32px;height:32px;font-size:.85rem;flex-shrink:0">
                ${w.nombre.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style="font-weight:500">${w.nombre}</div>
                <div class="text-muted text-sm">DNI: ${w.dni}${w.email ? ' · ' + w.email : ''}</div>
              </div>
            </div>
          </td>
          <td>
            <span class="badge ${w.tipo === 'externo' ? 'badge-gray' : 'badge-primary'}">
              ${w.tipo === 'externo' ? '📋 Externo (RH)' : '👷 Planilla'}
            </span>
          </td>
          <td class="text-sm">${w.empresa || '–'}${w.ruc ? '<br><span class="text-muted">RUC: '+w.ruc+'</span>' : ''}</td>
          <td>
            <span class="badge ${w.rol === 'admin' ? 'badge-warning' : 'badge-gray'}">
              ${w.rol === 'admin' ? '🛡 Admin' : 'Trabajador'}
            </span>
          </td>
          <td>${w.activo
            ? '<span class="badge badge-success">Activo</span>'
            : '<span class="badge badge-danger">Inactivo</span>'}</td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn btn-secondary btn-xs" onclick="Workers.edit(${w.id})">✏️ Editar</button>
              <button class="btn btn-${w.activo ? 'danger' : 'success'} btn-xs"
                onclick="Workers.toggleActive(${w.id},${w.activo})">
                ${w.activo ? '⛔ Desactivar' : '✅ Activar'}
              </button>
              <button class="btn btn-danger btn-xs" onclick="Workers.delete(${w.id},'${w.nombre.replace(/'/g,"\\'")}')">
                🗑 Eliminar
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-danger" style="text-align:center;padding:20px">Error: ${e.message}</td></tr>`;
    }
  },

  openNew() {
    document.getElementById('modalWorkerTitle').textContent = 'Nuevo trabajador';
    ['wId','wDni','wNombre','wPassword','wEmpresa','wRuc','wEmail','wTelefono'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('wRol').value  = 'worker';
    document.getElementById('wTipo').value = 'planilla';
    document.getElementById('wDni').removeAttribute('disabled');
    document.getElementById('wPasswordHelp').textContent = 'Obligatoria para nuevo trabajador';
    openModal('modalWorker');
  },

  async edit(id) {
    try {
      const workers = await api('/users/list?all=1');
      const w = workers.find(x => x.id === id);
      if (!w) { toast('Trabajador no encontrado', 'error'); return; }

      document.getElementById('modalWorkerTitle').textContent = 'Editar trabajador';
      document.getElementById('wId').value       = w.id;
      document.getElementById('wDni').value      = w.dni;
      document.getElementById('wDni').setAttribute('disabled','true');
      document.getElementById('wNombre').value   = w.nombre;
      document.getElementById('wPassword').value = '';
      document.getElementById('wPasswordHelp').textContent = 'Dejar vacío para no cambiar la contraseña';
      document.getElementById('wRol').value      = w.rol || 'worker';
      document.getElementById('wTipo').value     = w.tipo || 'planilla';
      document.getElementById('wEmpresa').value  = w.empresa || '';
      document.getElementById('wRuc').value      = w.ruc || '';
      document.getElementById('wEmail').value    = w.email || '';
      document.getElementById('wTelefono').value = w.telefono || '';
      openModal('modalWorker');
    } catch(e) {
      toast(e.message, 'error');
    }
  },

  async save() {
    const id     = document.getElementById('wId').value;
    const dni    = document.getElementById('wDni').value.trim();
    const nombre = document.getElementById('wNombre').value.trim();
    const pass   = document.getElementById('wPassword').value;

    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
    if (!id && !dni)  { toast('El DNI es obligatorio', 'error'); return; }
    if (!id && !pass) { toast('La contraseña es obligatoria para nuevos trabajadores', 'error'); return; }
    if (!id && !/^\d{8}$/.test(dni)) { toast('El DNI debe tener exactamente 8 dígitos numéricos', 'error'); return; }

    const body = {
      nombre,
      rol:      document.getElementById('wRol').value,
      tipo:     document.getElementById('wTipo').value,
      empresa:  document.getElementById('wEmpresa').value || '',
      ruc:      document.getElementById('wRuc').value || '',
      email:    document.getElementById('wEmail').value || '',
      telefono: document.getElementById('wTelefono').value || '',
    };
    if (!id) body.dni = dni;
    if (pass) body.password = pass;

    const btn = document.getElementById('btnSaveWorker');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      if (id) {
        await api(`/workers/${id}`, { method: 'PUT', body });
        toast('✅ Trabajador actualizado', 'success');
      } else {
        await api('/workers', { method: 'POST', body });
        toast(`✅ Trabajador creado. Contraseña inicial: ${pass}`, 'success');
      }
      closeModal('modalWorker');
      Workers.load();
      App.loadWorkerSelects();
    } catch(e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  },

  async toggleActive(id, currentActive) {
    const accion = currentActive ? 'desactivar' : 'activar';
    if (!confirm(`¿Desea ${accion} este trabajador?`)) return;
    try {
      await api(`/workers/${id}`, { method: 'PUT', body: { activo: currentActive ? 0 : 1 } });
      toast(`Trabajador ${currentActive ? 'desactivado' : 'activado'}`, 'success');
      Workers.load();
      App.loadWorkerSelects();
    } catch(e) {
      toast(e.message, 'error');
    }
  },

  async delete(id, nombre) {
    if (!confirm(`⚠️ ¿Eliminar a "${nombre}" permanentemente?\n\nEsto también eliminará todos sus registros de asistencia, reembolsos y documentos.\n\nEsta acción NO se puede deshacer.`)) return;
    if (!confirm(`Segunda confirmación: ¿Seguro que deseas eliminar a "${nombre}"?`)) return;
    try {
      await api(`/workers/${id}`, { method: 'DELETE' });
      toast(`✅ Trabajador "${nombre}" eliminado`, 'success');
      Workers.load();
      App.loadWorkerSelects();
    } catch(e) {
      toast(e.message, 'error');
    }
  },

  // ── Importar desde Excel / CSV ──────────────────────────────
  openImport() {
    openModal('modalImportWorkers');
  },

  onImportFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    document.getElementById('importFileName').textContent = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const XLSX = window.XLSX;
        if (!XLSX) {
          toast('Cargando lector de Excel...', 'info');
          return;
        }
        const wb   = XLSX.read(e.target.result, { type: 'binary' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        Workers._previewImport(rows);
      } catch(err) {
        toast('Error al leer el archivo: ' + err.message, 'error');
      }
    };
    reader.readAsBinaryString(file);
  },

  _previewImport(rows) {
    // Mapear columnas comunes en español e inglés
    const normalizar = (obj) => {
      const get = (...keys) => {
        for (const k of keys) {
          const found = Object.keys(obj).find(ok => ok.toLowerCase().replace(/\s/g,'') === k.toLowerCase().replace(/\s/g,''));
          if (found && obj[found] !== '') return String(obj[found]).trim();
        }
        return '';
      };
      return {
        dni:      get('dni','doc','documento','numerodedocumento'),
        nombre:   get('nombre','name','nombres','nombreyapellidos','apellidosynombres'),
        empresa:  get('empresa','company','razon','razonsocial'),
        ruc:      get('ruc','rucdeltrabajador','rucempresa'),
        tipo:     get('tipo','tipotrabajador','modalidad'),
        email:    get('email','correo','correoelectronico'),
        telefono: get('telefono','celular','phone','tel'),
      };
    };

    const preview = rows.slice(0,100).map(normalizar).filter(r => r.dni || r.nombre);
    Workers._importRows = preview;

    const div = document.getElementById('importPreview');
    if (preview.length === 0) {
      div.innerHTML = '<p class="text-danger">No se encontraron filas válidas. Verifica que el archivo tenga columnas: DNI, Nombre.</p>';
      return;
    }

    div.innerHTML = `
      <p class="text-muted text-sm mb-8">Se encontraron <strong>${preview.length}</strong> trabajadores. Contraseña inicial = su DNI (pueden cambiarla después).</p>
      <div class="table-wrapper">
        <table class="table">
          <thead><tr><th>DNI</th><th>Nombre</th><th>Empresa</th><th>Tipo</th></tr></thead>
          <tbody>
            ${preview.slice(0,10).map(r => `
              <tr>
                <td>${r.dni || '<span class="text-danger">falta</span>'}</td>
                <td>${r.nombre || '<span class="text-danger">falta</span>'}</td>
                <td>${r.empresa || '–'}</td>
                <td>${r.tipo || 'planilla'}</td>
              </tr>
            `).join('')}
            ${preview.length > 10 ? `<tr><td colspan="4" class="text-muted text-sm" style="text-align:center">... y ${preview.length-10} más</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    `;
  },

  async executeImport() {
    const rows = Workers._importRows;
    if (!rows || rows.length === 0) {
      toast('Primero selecciona un archivo válido', 'error');
      return;
    }

    const btn = document.getElementById('btnExecuteImport');
    btn.disabled = true;
    btn.textContent = 'Importando...';

    try {
      const result = await api('/workers/import', {
        method: 'POST',
        body: { trabajadores: rows }
      });

      closeModal('modalImportWorkers');
      let msg = `✅ ${result.creados} trabajador(es) creado(s) con contraseña = su DNI.`;
      if (result.errores?.length > 0) msg += `\n⚠️ ${result.errores.length} con error: ${result.errores.slice(0,2).join(', ')}`;
      toast(msg, result.creados > 0 ? 'success' : 'error');
      Workers.load();
      App.loadWorkerSelects();
    } catch(e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Importar trabajadores';
    }
  },

  downloadPlantilla() {
    // Generar CSV de plantilla
    const bom = '\uFEFF';
    const csv = bom + 'DNI,Nombre,Empresa,RUC,Tipo,Email,Telefono\n' +
      '12345678,Juan Pérez García,JVÑ General Services SAC,20603607342,planilla,juan@empresa.com,999888777\n' +
      '87654321,María López Torres,PEVAL Corporación EIRL,20611965479,externo,maria@email.com,\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_trabajadores.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('📥 Plantilla descargada', 'success');
  }
};
