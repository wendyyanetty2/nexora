// ============================================================
//  NEXORA — catalogos.js  (panel de gestión de catálogos)
// ============================================================
'use strict';

const Catalogos = {
  currentTab: 'catalogo_empresas',
  _editId: null,

  async load() {
    Catalogos.switchTab(Catalogos.currentTab);
    // Cargar potestades en panel de config (solo si estamos en config)
    if (App.isSuperAdmin()) Catalogos.loadPotestades();
  },

  switchTab(table) {
    Catalogos.currentTab = table;
    document.querySelectorAll('.catalog-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === table);
    });
    Catalogos.loadCatalog(table);
  },

  async loadCatalog(table) {
    const container = document.getElementById('catalogTableContainer');
    container.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    try {
      const url = table === 'catalogo_descripciones' ? `/catalogs/${table}/all` : `/catalogs/${table}/all`;
      const items = await api(url);
      Catalogos.renderTable(table, items);
    } catch(e) {
      container.innerHTML = `<p class="text-danger">Error: ${e.message}</p>`;
    }
  },

  renderTable(table, items) {
    const container = document.getElementById('catalogTableContainer');
    const isDesc = table === 'catalogo_descripciones';
    const isVeh  = table === 'catalogo_vehiculos';

    const tipoGastoLabel = (t) => ({ transporte:'🚗 Transporte', viaticos:'🍽 Viáticos', compras:'🛒 Compras' }[t] || t);

    let thead = '';
    if (isDesc) {
      thead = `<tr><th>Nombre</th><th>Tipo Gasto</th><th>Orden</th><th>Estado</th><th>Acciones</th></tr>`;
    } else if (isVeh) {
      thead = `<tr><th>Nombre</th><th>Placa</th><th>Estado</th><th>Acciones</th></tr>`;
    } else {
      thead = `<tr><th>Nombre</th><th>Código</th><th>Orden</th><th>Estado</th><th>Acciones</th></tr>`;
    }

    const rows = items.map(item => {
      const actBadge = item.activo
        ? '<span class="badge badge-success">Activo</span>'
        : '<span class="badge badge-danger">Inactivo</span>';
      const toggleLabel = item.activo ? '⛔ Desactivar' : '✅ Activar';
      const toggleClass = item.activo ? 'btn-danger' : 'btn-success';

      let cells = '';
      if (isDesc) {
        cells = `<td>${item.nombre}</td><td>${tipoGastoLabel(item.tipo_gasto)}</td><td>${item.orden||0}</td>`;
      } else if (isVeh) {
        cells = `<td>${item.nombre}</td><td>${item.placa||'–'}</td>`;
      } else {
        cells = `<td>${item.nombre}</td><td>${item.codigo||'–'}</td><td>${item.orden||0}</td>`;
      }

      return `
        <tr ${!item.activo ? 'style="opacity:0.55"' : ''}>
          ${cells}
          <td>${actBadge}</td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn btn-secondary btn-xs" onclick="Catalogos.openEdit('${table}',${item.id})">✏️ Editar</button>
              <button class="btn ${toggleClass} btn-xs" onclick="Catalogos.toggle('${table}',${item.id},${item.activo})">${toggleLabel}</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="table-wrapper">
        <table class="table">
          <thead>${thead}</thead>
          <tbody>${rows || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px">Sin ítems en este catálogo</td></tr>'}</tbody>
        </table>
      </div>
    `;
  },

  openNew(table) {
    Catalogos._editId = null;
    document.getElementById('modalCatalogoTitle').textContent = 'Agregar ítem';
    Catalogos._setModalFields(table, null);
    document.getElementById('catalogoTable').value = table;
    openModal('modalCatalogo');
  },

  openEdit(table, id) {
    api(`/catalogs/${table}/all`).then(items => {
      const item = items.find(x => x.id === id);
      if (!item) { toast('Ítem no encontrado', 'error'); return; }
      Catalogos._editId = id;
      document.getElementById('modalCatalogoTitle').textContent = 'Editar ítem';
      Catalogos._setModalFields(table, item);
      document.getElementById('catalogoTable').value = table;
      openModal('modalCatalogo');
    }).catch(e => toast(e.message, 'error'));
  },

  _setModalFields(table, item) {
    const isDesc = table === 'catalogo_descripciones';
    const isVeh  = table === 'catalogo_vehiculos';

    document.getElementById('catalogoNombre').value = item?.nombre || '';
    document.getElementById('catalogoCodigo').value = item?.codigo || '';
    document.getElementById('catalogoPlaca').value  = item?.placa  || '';
    document.getElementById('catalogoOrden').value  = item?.orden  || 0;

    // Mostrar/ocultar campos según tabla
    document.getElementById('catalogoCodigoGroup').style.display  = (!isDesc && !isVeh) ? '' : 'none';
    document.getElementById('catalogoPlacaGroup').style.display   = isVeh  ? '' : 'none';
    document.getElementById('catalogoOrdenGroup').style.display   = !isVeh ? '' : 'none';
    document.getElementById('catalogoTipoGastoGroup').style.display = isDesc ? '' : 'none';

    if (isDesc) {
      document.getElementById('catalogoTipoGasto').value = item?.tipo_gasto || '';
    }
  },

  async saveCatalogo() {
    const table  = document.getElementById('catalogoTable').value;
    const nombre = document.getElementById('catalogoNombre').value.trim();
    if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }

    const body = {
      nombre,
      codigo:     document.getElementById('catalogoCodigo').value || '',
      placa:      document.getElementById('catalogoPlaca').value  || '',
      tipo_gasto: document.getElementById('catalogoTipoGasto').value || '',
      orden:      parseInt(document.getElementById('catalogoOrden').value) || 0,
    };

    const btn = document.getElementById('btnSaveCatalogo');
    btn.disabled = true; btn.textContent = 'Guardando...';

    try {
      if (Catalogos._editId) {
        await api(`/catalogs/${table}/${Catalogos._editId}`, { method: 'PUT', body });
        toast('✅ Ítem actualizado', 'success');
      } else {
        await api(`/catalogs/${table}`, { method: 'POST', body });
        toast('✅ Ítem creado', 'success');
      }
      closeModal('modalCatalogo');
      Catalogos.loadCatalog(table);
    } catch(e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Guardar'; }
  },

  async toggle(table, id, currentActivo) {
    const accion = currentActivo ? 'desactivar' : 'activar';
    if (!confirm(`¿Desea ${accion} este ítem?`)) return;
    try {
      await api(`/catalogs/${table}/${id}/toggle`, { method: 'PUT', body: {} });
      toast(`Ítem ${currentActivo ? 'desactivado' : 'activado'}`, 'success');
      Catalogos.loadCatalog(table);
    } catch(e) { toast(e.message, 'error'); }
  },

  // ── Potestades de aprobación ──────────────────────────────────
  async loadPotestades() {
    try {
      const data = await api('/config/potestades');
      const container = document.getElementById('potestadesList');
      if (!container) return;
      container.innerHTML = data.map(p => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
          <div>
            <strong>${App._rolLabel(p.rol)}</strong>
            <div class="text-muted text-sm">Puede aprobar/rechazar solicitudes</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${p.puede_aprobar ? 'checked' : ''}
              onchange="Catalogos.updatePotestad('${p.rol}', this.checked)"/>
            <span class="toggle-slider"></span>
          </label>
        </div>
      `).join('');
    } catch(e) { console.warn('loadPotestades:', e.message); }
  },

  async updatePotestad(rol, value) {
    try {
      await api(`/config/potestades/${rol}`, { method: 'PUT', body: { puede_aprobar: value } });
      toast(`Potestad de ${rol} ${value ? 'activada' : 'desactivada'}`, 'success');
    } catch(e) {
      toast(e.message, 'error');
      Catalogos.loadPotestades(); // revertir
    }
  },
};
