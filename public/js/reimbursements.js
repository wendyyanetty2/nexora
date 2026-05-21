// ============================================================
//  NEXORA — reimbursements.js  (v3)
// ============================================================
'use strict';

const Reimbursements = {
  _files: [],
  _editId: null,
  _catalogs: { empresas: [], motivos: [], descripciones: [], vehiculos: [] },

  _defaultMonth(fromId, toId) {
    const now   = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0,10);
    const fromEl = document.getElementById(fromId);
    const toEl   = document.getElementById(toId);
    if (fromEl && !fromEl.value) fromEl.value = first;
    if (toEl   && !toEl.value)   toEl.value   = last;
  },

  async loadCatalogs() {
    try {
      const [emp, mot, desc, veh] = await Promise.all([
        api('/catalogs/catalogo_empresas'),
        api('/catalogs/catalogo_motivos'),
        api('/catalogs/catalogo_descripciones'),
        api('/catalogs/catalogo_vehiculos'),
      ]);
      Reimbursements._catalogs = { empresas: emp, motivos: mot, descripciones: desc, vehiculos: veh };
    } catch(e) { console.warn('loadCatalogs:', e.message); }
  },

  async load() {
    Reimbursements._defaultMonth('reiFrom', 'reiTo');
    const status = document.getElementById('reiStatus')?.value || '';
    const from   = document.getElementById('reiFrom')?.value   || '';
    const to     = document.getElementById('reiTo')?.value     || '';
    const worker = document.getElementById('reiWorker')?.value || '';

    let qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (from)   qs.set('from', from);
    if (to)     qs.set('to', to);
    if (worker) qs.set('userId', worker);

    const exportBtn = document.getElementById('exportReiBtn');
    if (exportBtn) exportBtn.href = '/api/reimbursements/export?' + qs.toString();

    const tbody = document.getElementById('reiBody');
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px"><div class="spinner"></div></td></tr>`;

    try {
      const data = await api('/reimbursements?' + qs.toString());
      const isElevated = App.canViewAll();

      if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-muted" style="text-align:center;padding:40px">Sin solicitudes encontradas</td></tr>`;
        return;
      }

      tbody.innerHTML = data.map(r => {
        const files = JSON.parse(r.archivos || '[]');
        const fileLinks = files.map(f =>
          `<a href="/api/uploads/reembolsos/${encodeURIComponent(f)}" target="_blank" class="file-link" title="${f}">📎</a>`
        ).join(' ');

        const isOwn = Number(r.usuario_id) === Number(App.currentUser?.id);
        const acciones = Reimbursements._renderAcciones(r, isOwn);

        const desc = r.descripcion_nombre || r.descripcion_libre || r.concepto || '–';
        const empresa = r.empresa_obra_nombre || '–';

        return `
          <tr>
            <td>${fmtDate(r.fecha)}</td>
            <td class="elevated-only" ${!isElevated ? 'style="display:none"' : ''}>${r.nombre || '–'}</td>
            <td class="text-sm">${tipoGastoLabel(r.tipo_gasto)}</td>
            <td class="text-sm">${empresa}</td>
            <td class="text-sm">${desc}</td>
            <td><strong>${fmtMoney(r.monto)}</strong></td>
            <td style="text-align:center">${fileLinks || '<span class="text-muted">–</span>'}</td>
            <td>${statusBadge(r.estado)}${r.motivo_rechazo ? `<br><span class="text-xs text-danger" title="${r.motivo_rechazo}">⚠ Ver motivo</span>` : ''}</td>
            <td>${acciones}</td>
          </tr>
        `;
      }).join('');
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-danger" style="text-align:center;padding:20px">Error: ${e.message}</td></tr>`;
    }
  },

  _renderAcciones(r, isOwn) {
    const canApprove = App.canApprove;
    const isAdmin    = App.isAdmin();
    const btns = [];

    // Botones de aprobación (para quien tiene potestad)
    if (canApprove) {
      if (r.estado === 'enviado') {
        btns.push(`<button class="btn btn-secondary btn-xs" onclick="Reimbursements.changeStatus(${r.id},'en_revision')">📋 Revisión</button>`);
      }
      if (r.estado === 'en_revision') {
        btns.push(`<button class="btn btn-success btn-xs" onclick="Reimbursements.changeStatus(${r.id},'aprobado')">✓ Aprobar</button>`);
        btns.push(`<button class="btn btn-danger btn-xs" onclick="Reimbursements.openReject(${r.id})">✗ Rechazar</button>`);
      }
      if (r.estado === 'aprobado') {
        btns.push(`<button class="btn btn-primary btn-xs" onclick="Reimbursements.changeStatus(${r.id},'pagado')">💰 Pagado</button>`);
      }
    }

    // Botones editar/eliminar: trabajador solo en estado 'enviado', admin en cualquier estado
    if ((isOwn && r.estado === 'enviado') || isAdmin) {
      btns.push(`<button class="btn btn-secondary btn-xs" onclick="Reimbursements.openEdit(${r.id})">✏️ Editar</button>`);
    }
    if ((isOwn && r.estado === 'enviado') || isAdmin) {
      btns.push(`<button class="btn btn-danger btn-xs" onclick="Reimbursements.delete(${r.id})">🗑</button>`);
    }

    return btns.length
      ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${btns.join('')}</div>`
      : `<span class="text-muted text-sm">–</span>`;
  },

  clearFilters() {
    ['reiStatus','reiWorker'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['reiFrom','reiTo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    Reimbursements.load();
  },

  async openNew() {
    await Reimbursements.loadCatalogs();
    Reimbursements._editId = null;
    Reimbursements._files  = [];
    Reimbursements._resetForm();
    document.getElementById('modalReembolsoTitle').textContent = '💳 Nueva solicitud de reembolso';
    document.getElementById('btnSaveReembolso').textContent    = 'Enviar solicitud';
    Reimbursements._populateSelects();
    initDragDrop('rUploadZone', (files) => Reimbursements.onFileSelect(files));
    openModal('modalReembolso');
  },

  async openEdit(id) {
    await Reimbursements.loadCatalogs();
    try {
      const data = await api('/reimbursements');
      const r = data.find(x => x.id === id);
      if (!r) { toast('Solicitud no encontrada', 'error'); return; }
      Reimbursements._editId = id;
      Reimbursements._files  = [];
      Reimbursements._resetForm();
      Reimbursements._populateSelects();

      // Precargar valores
      Reimbursements._selectTipoGasto(r.tipo_gasto);
      // Empresa / Obra — puede ser de catálogo o texto libre (Otros)
      if (r.empresa_obra_id) {
        document.getElementById('rEmpresaObra').value = r.empresa_obra_id;
      } else if (r.empresa_obra_nombre) {
        document.getElementById('rEmpresaObra').value = 'otros';
        const libreGrp = document.getElementById('rEmpresaObraLibreGroup');
        const libreInp = document.getElementById('rEmpresaObraLibre');
        if (libreGrp) libreGrp.style.display = '';
        if (libreInp) libreInp.value = r.empresa_obra_nombre;
      }
      document.getElementById('rMotivo').value           = r.motivo_id === null ? '' : (r.motivo_nombre === 'Otros' ? 'otros' : r.motivo_id || '');
      document.getElementById('rMotivoLibre').value      = r.motivo_libre || '';
      document.getElementById('rMonto').value            = r.monto || '';
      document.getElementById('rTipoDoc').value          = r.tipo_comprobante || '';
      document.getElementById('rNumDoc').value           = r.numero_documento || '';
      document.getElementById('rRuc').value              = r.ruc_proveedor || '';
      document.getElementById('rProveedor').value        = r.nombre_proveedor || '';
      document.getElementById('rNotas').value            = r.notas || '';

      // Descripción
      Reimbursements._populateDescripciones(r.tipo_gasto);
      document.getElementById('rDescripcion').value      = r.descripcion_id || '';
      document.getElementById('rDescripcionLibre').value = r.descripcion_libre || '';

      // Vehículo
      if (r.tipo_gasto === 'transporte' && (r.descripcion_nombre === 'Combustible' || r.descripcion_nombre === 'Peaje')) {
        document.getElementById('rVehiculoGroup').style.display = '';
        document.getElementById('rVehiculo').value = r.vehiculo_id || '';
      }

      // Medio de pago
      if (r.medio_pago) {
        const radios = document.querySelectorAll('input[name="rMedioPago"]');
        radios.forEach(rb => { if (rb.value === r.medio_pago) rb.checked = true; });
        document.getElementById('rNumOperacion').value = r.numero_operacion || '';
        document.getElementById('rNumOperacionGroup').style.display = '';
      }

      document.getElementById('rMotivoLibreGroup').style.display    = r.motivo_libre     ? '' : 'none';
      document.getElementById('rDescripcionLibreGroup').style.display = r.descripcion_libre ? '' : 'none';

      document.getElementById('modalReembolsoTitle').textContent = '✏️ Editar solicitud de reembolso';
      document.getElementById('btnSaveReembolso').textContent    = 'Actualizar solicitud';
      initDragDrop('rUploadZone', (files) => Reimbursements.onFileSelect(files));
      openModal('modalReembolso');
    } catch(e) { toast(e.message, 'error'); }
  },

  _resetForm() {
    ['rMonto','rRuc','rProveedor','rNumDoc','rNotas','rMotivoLibre','rDescripcionLibre','rNumOperacion'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('rTipoDoc').value = '';
    document.getElementById('rFilePreview').innerHTML = '';
    document.getElementById('rUploadZone').classList.remove('has-file');
    document.getElementById('rVehiculoGroup').style.display            = 'none';
    document.getElementById('rMotivoLibreGroup').style.display         = 'none';
    document.getElementById('rDescripcionLibreGroup').style.display    = 'none';
    document.getElementById('rNumOperacionGroup').style.display        = 'none';
    const libreGrp = document.getElementById('rEmpresaObraLibreGroup');
    if (libreGrp) libreGrp.style.display = 'none';
    const libreInp = document.getElementById('rEmpresaObraLibre');
    if (libreInp) libreInp.value = '';
    document.querySelectorAll('input[name="rMedioPago"]').forEach(r => r.checked = false);
    // Deseleccionar tipo de gasto
    document.querySelectorAll('.tipo-gasto-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('rTipoGastoHidden').value = '';
    // Limpiar selects de catálogo
    ['rEmpresaObra','rMotivo','rDescripcion','rVehiculo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<option value="">Seleccionar...</option>';
    });
  },

  _populateSelects() {
    const { empresas, motivos, vehiculos } = Reimbursements._catalogs;

    // Empresas
    const selEmp = document.getElementById('rEmpresaObra');
    selEmp.innerHTML = '<option value="">Seleccionar empresa/obra...</option>';
    empresas.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.dataset.nombre = e.nombre;
      opt.textContent = e.nombre;
      selEmp.appendChild(opt);
    });
    // Opción fija "Otros"
    const optEmpOtros = document.createElement('option');
    optEmpOtros.value = 'otros';
    optEmpOtros.textContent = '✏️ Otros (escribir)';
    selEmp.appendChild(optEmpOtros);

    // Motivos
    const selMot = document.getElementById('rMotivo');
    selMot.innerHTML = '<option value="">Seleccionar motivo...</option>';
    motivos.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.dataset.nombre = m.nombre;
      opt.textContent = m.nombre;
      selMot.appendChild(opt);
    });
    // Opción "Otros" fija
    const optOtros = document.createElement('option');
    optOtros.value = 'otros';
    optOtros.textContent = 'Otros';
    selMot.appendChild(optOtros);

    // Vehículos
    const selVeh = document.getElementById('rVehiculo');
    selVeh.innerHTML = '<option value="">Seleccionar vehículo...</option>';
    vehiculos.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.dataset.nombre = v.nombre;
      opt.textContent = v.nombre + (v.placa ? ` (${v.placa})` : '');
      selVeh.appendChild(opt);
    });
    const optVOtros = document.createElement('option');
    optVOtros.value = 'otros';
    optVOtros.textContent = 'Otros';
    selVeh.appendChild(optVOtros);
  },

  _populateDescripciones(tipoGasto) {
    const { descripciones } = Reimbursements._catalogs;
    const selDesc = document.getElementById('rDescripcion');
    selDesc.innerHTML = '<option value="">Seleccionar descripción...</option>';
    const filtered = descripciones.filter(d => d.tipo_gasto === tipoGasto);
    filtered.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.dataset.nombre = d.nombre;
      opt.textContent = d.nombre;
      selDesc.appendChild(opt);
    });
    const optOtros = document.createElement('option');
    optOtros.value = 'otros';
    optOtros.textContent = 'Otros';
    selDesc.appendChild(optOtros);
  },

  _selectTipoGasto(tipo) {
    document.querySelectorAll('.tipo-gasto-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.tipo === tipo);
    });
    document.getElementById('rTipoGastoHidden').value = tipo || '';
    Reimbursements._populateDescripciones(tipo);
    // Ocultar vehículo al cambiar tipo (se re-muestra al elegir descripción)
    document.getElementById('rVehiculoGroup').style.display = 'none';
  },

  onTipoGasto(tipo) {
    Reimbursements._selectTipoGasto(tipo);
    document.getElementById('rDescripcion').value = '';
    document.getElementById('rDescripcionLibreGroup').style.display = 'none';
    document.getElementById('rVehiculoGroup').style.display = 'none';
  },

  onEmpresaChange() {
    const sel = document.getElementById('rEmpresaObra');
    const libreGroup = document.getElementById('rEmpresaObraLibreGroup');
    if (libreGroup) libreGroup.style.display = sel.value === 'otros' ? '' : 'none';
    if (sel.value !== 'otros') {
      const libreInput = document.getElementById('rEmpresaObraLibre');
      if (libreInput) libreInput.value = '';
    }
  },

  onMotivoChange() {
    const sel = document.getElementById('rMotivo');
    document.getElementById('rMotivoLibreGroup').style.display =
      sel.value === 'otros' ? '' : 'none';
  },

  onDescripcionChange() {
    const sel = document.getElementById('rDescripcion');
    const selectedNombre = sel.options[sel.selectedIndex]?.dataset?.nombre || '';
    const tipoGasto = document.getElementById('rTipoGastoHidden').value;

    document.getElementById('rDescripcionLibreGroup').style.display =
      sel.value === 'otros' ? '' : 'none';

    // Mostrar vehículo solo si es transporte + Combustible o Peaje
    const needsVehiculo = tipoGasto === 'transporte' &&
      (selectedNombre === 'Combustible' || selectedNombre === 'Peaje');
    document.getElementById('rVehiculoGroup').style.display = needsVehiculo ? '' : 'none';
  },

  onMedioPagoChange() {
    document.getElementById('rNumOperacionGroup').style.display = '';
  },

  onFileSelect(files) {
    Array.from(files).forEach(f => {
      if (Reimbursements._files.length < 5) Reimbursements._files.push(f);
    });
    Reimbursements._renderFilePreview();
  },

  _renderFilePreview() {
    const preview = document.getElementById('rFilePreview');
    if (!preview) return;
    if (Reimbursements._files.length === 0) { preview.innerHTML = ''; return; }
    preview.innerHTML = Reimbursements._files.map((f, i) => {
      const isImg = f.type.startsWith('image/');
      const url = URL.createObjectURL(f);
      return `
        <div class="file-preview-item">
          ${isImg ? `<img src="${url}" class="file-preview-thumb" alt="${f.name}"/>` : `<div class="file-preview-icon">📄</div>`}
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
    const tipoGasto = document.getElementById('rTipoGastoHidden').value;
    const monto     = document.getElementById('rMonto').value;
    if (!tipoGasto) { toast('Selecciona el tipo de gasto', 'error'); return; }
    if (!monto)     { toast('El monto es obligatorio', 'error'); return; }

    const btn = document.getElementById('btnSaveReembolso');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
      const fd = new FormData();

      // Tipo de gasto
      fd.append('tipo_gasto', tipoGasto);

      // Empresa/Obra (puede ser catálogo o texto libre "Otros")
      const selEmp = document.getElementById('rEmpresaObra');
      if (selEmp.value === 'otros') {
        const libreEmp = document.getElementById('rEmpresaObraLibre')?.value.trim() || '';
        if (!libreEmp) { toast('Escribe el nombre de la empresa u obra', 'error'); btn.disabled = false; btn.textContent = Reimbursements._editId ? 'Actualizar solicitud' : 'Enviar solicitud'; return; }
        fd.append('empresa_obra_id',     '');
        fd.append('empresa_obra_nombre', libreEmp);
      } else {
        fd.append('empresa_obra_id',     selEmp.value || '');
        fd.append('empresa_obra_nombre', selEmp.options[selEmp.selectedIndex]?.dataset?.nombre || '');
      }

      // Motivo
      const selMot = document.getElementById('rMotivo');
      const motiNombre = selMot.value === 'otros' ? 'Otros' : (selMot.options[selMot.selectedIndex]?.dataset?.nombre || '');
      fd.append('motivo_id',    selMot.value === 'otros' ? '' : (selMot.value || ''));
      fd.append('motivo_nombre', motiNombre);
      fd.append('motivo_libre', document.getElementById('rMotivoLibre').value || '');

      // Descripción
      const selDesc = document.getElementById('rDescripcion');
      const descNombre = selDesc.value === 'otros' ? 'Otros' : (selDesc.options[selDesc.selectedIndex]?.dataset?.nombre || '');
      fd.append('descripcion_id',     selDesc.value === 'otros' ? '' : (selDesc.value || ''));
      fd.append('descripcion_nombre', descNombre);
      fd.append('descripcion_libre',  document.getElementById('rDescripcionLibre').value || '');

      // Vehículo (condicional)
      const selVeh = document.getElementById('rVehiculo');
      if (selVeh && document.getElementById('rVehiculoGroup').style.display !== 'none') {
        fd.append('vehiculo_id',     selVeh.value === 'otros' ? '' : (selVeh.value || ''));
        fd.append('vehiculo_nombre', selVeh.value === 'otros' ? 'Otros' : (selVeh.options[selVeh.selectedIndex]?.dataset?.nombre || ''));
      }

      // Campos financieros
      fd.append('monto',             monto);
      fd.append('tipo_comprobante',  document.getElementById('rTipoDoc').value || '');
      fd.append('numero_documento',  document.getElementById('rNumDoc').value || '');
      fd.append('ruc_proveedor',     document.getElementById('rRuc').value || '');
      fd.append('nombre_proveedor',  document.getElementById('rProveedor').value || '');

      // Medio de pago
      const medioPago = document.querySelector('input[name="rMedioPago"]:checked')?.value || '';
      fd.append('medio_pago',       medioPago);
      fd.append('numero_operacion', document.getElementById('rNumOperacion').value || '');
      fd.append('notas',            document.getElementById('rNotas').value || '');

      // Archivos (solo en nueva solicitud)
      if (!Reimbursements._editId) {
        Reimbursements._files.forEach(f => fd.append('archivos', f));
      }

      if (Reimbursements._editId) {
        // Edición — enviar como JSON
        const body = {};
        for (const [k, v] of fd.entries()) body[k] = v;
        await api(`/reimbursements/${Reimbursements._editId}`, { method: 'PUT', body });
        toast('✅ Solicitud actualizada', 'success');
      } else {
        await api('/reimbursements', { method: 'POST', body: fd, headers: {} });
        toast('✅ Solicitud enviada correctamente', 'success');
      }

      closeModal('modalReembolso');
      Reimbursements.load();
    } catch(e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = Reimbursements._editId ? 'Actualizar solicitud' : 'Enviar solicitud';
    }
  },

  async changeStatus(id, status) {
    const labels = { en_revision: 'poner en revisión', aprobado: 'aprobar', pagado: 'marcar como pagado' };
    if (!confirm(`¿Desea ${labels[status] || status} esta solicitud?`)) return;
    try {
      await api(`/reimbursements/${id}`, { method: 'PUT', body: { status } });
      toast('Estado actualizado', 'success');
      Reimbursements.load();
    } catch(e) { toast(e.message, 'error'); }
  },

  openReject(id) {
    document.getElementById('rejectReimId').value = id;
    document.getElementById('rejectMotivo').value = '';
    openModal('modalRechazo');
  },

  async confirmReject() {
    const id     = document.getElementById('rejectReimId').value;
    const motivo = document.getElementById('rejectMotivo').value.trim();
    if (!motivo) { toast('El motivo de rechazo es obligatorio', 'error'); return; }
    try {
      await api(`/reimbursements/${id}`, { method: 'PUT', body: { status: 'rechazado', motivo_rechazo: motivo } });
      closeModal('modalRechazo');
      toast('Solicitud rechazada', 'success');
      Reimbursements.load();
    } catch(e) { toast(e.message, 'error'); }
  },

  async delete(id) {
    if (!confirm('¿Seguro que quieres eliminar esta solicitud? Esta acción no se puede deshacer.')) return;
    try {
      await api(`/reimbursements/${id}`, { method: 'DELETE' });
      toast('Solicitud eliminada', 'success');
      Reimbursements.load();
    } catch(e) { toast(e.message, 'error'); }
  }
};
