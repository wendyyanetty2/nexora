// ============================================================
//  NEXORA — attendance.js
// ============================================================
'use strict';

const Attendance = {
  _gpsCoords: null,
  _gpsAddress: '',
  _gpsReady: false,

  // Establece el mes actual en los filtros si están vacíos
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
    // Iniciar GPS al cargar
    Attendance._initGPS();

    // Filtrar por mes actual si no hay rango definido
    Attendance._defaultMonth('attFrom', 'attTo');

    // Construir query params
    const from   = document.getElementById('attFrom')?.value || '';
    const to     = document.getElementById('attTo')?.value || '';
    const worker = document.getElementById('attWorker')?.value || '';

    let qs = new URLSearchParams();
    if (from)   qs.set('from', from);
    if (to)     qs.set('to', to);
    if (worker) qs.set('userId', worker);

    // Actualizar URL del botón de exportar
    const exportBtn = document.getElementById('exportAttBtn');
    if (exportBtn) exportBtn.href = '/api/attendance/export?' + qs.toString();

    const tbody = document.getElementById('attBody');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px"><div class="spinner"></div></td></tr>`;

    try {
      const data = await api('/attendance?' + qs.toString());
      const isAdmin = App.currentUser.rol === 'admin';

      if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:40px">Sin registros encontrados</td></tr>`;
        return;
      }

      tbody.innerHTML = data.map(a => `
        <tr>
          <td>${fmtDate(a.fecha)}</td>
          <td class="admin-only" ${!isAdmin ? 'style="display:none"' : ''}>${a.nombre || '–'}</td>
          <td class="admin-only" ${!isAdmin ? 'style="display:none"' : ''}><span class="badge ${a.tipo === 'externo' ? 'badge-gray' : 'badge-primary'}">${a.tipo === 'externo' ? 'Externo' : 'Planilla'}</span></td>
          <td>${a.hora_entrada || '–'}</td>
          <td>${a.hora_salida || '<span class="text-warning">En curso</span>'}</td>
          <td class="text-sm text-muted" title="${a.direccion_entrada || ''}">${Attendance._shortAddr(a.direccion_entrada)}</td>
          <td>${statusBadge(a.estado)}</td>
        </tr>
      `).join('');
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-danger" style="text-align:center;padding:20px">Error: ${e.message}</td></tr>`;
    }
  },

  clearFilters() {
    // Resetea trabajador pero vuelve al mes actual (no a "todos los tiempos")
    const workerEl = document.getElementById('attWorker');
    if (workerEl) workerEl.value = '';
    // Vaciar fechas para que _defaultMonth las ponga al mes actual
    ['attFrom','attTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    Attendance.load();
  },

  _shortAddr(addr) {
    if (!addr) return '–';
    if (addr.length <= 40) return addr;
    return addr.slice(0, 37) + '…';
  },

  _initGPS() {
    const statusEl = document.getElementById('gpsStatus');
    if (!statusEl) return;

    if (!navigator.geolocation) {
      statusEl.className = 'gps-status error';
      statusEl.textContent = '⚠️ Geolocalización no disponible en este navegador';
      return;
    }

    statusEl.className = 'gps-status loading';
    statusEl.textContent = '🔄 Obteniendo ubicación GPS...';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        Attendance._gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        Attendance._gpsReady = true;

        statusEl.className = 'gps-status ok';
        statusEl.textContent = `✅ GPS activo — Lat: ${pos.coords.latitude.toFixed(5)}, Lng: ${pos.coords.longitude.toFixed(5)}`;

        // Reverse geocoding con Nominatim (OpenStreetMap, gratis, sin key)
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=17&addressdetails=1`,
            { headers: { 'Accept-Language': 'es' } }
          );
          const geo = await r.json();
          Attendance._gpsAddress = geo.display_name || '';
          const shortAddr = geo.address
            ? [geo.address.road, geo.address.suburb, geo.address.city || geo.address.town].filter(Boolean).join(', ')
            : geo.display_name;
          statusEl.textContent = `✅ ${shortAddr || 'Ubicación obtenida'}`;
        } catch {
          // Nominatim falló, usar coords
          Attendance._gpsAddress = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        }
      },
      (err) => {
        Attendance._gpsReady = false;
        statusEl.className = 'gps-status error';
        const msgs = {
          1: 'Permiso de ubicación denegado. Actívalo en la configuración del navegador.',
          2: 'Posición no disponible en este momento.',
          3: 'Tiempo de espera agotado para obtener ubicación.'
        };
        statusEl.textContent = '⚠️ ' + (msgs[err.code] || 'Error de geolocalización');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  },

  async checkin() {
    const btn = document.getElementById('btnCheckin');
    if (btn) btn.disabled = true;
    try {
      const body = {
        lat: Attendance._gpsCoords?.lat || null,
        lng: Attendance._gpsCoords?.lng || null,
        address: Attendance._gpsAddress || ''
      };
      const r = await api('/attendance/checkin', { method: 'POST', body });
      document.getElementById('checkinTime').textContent = r.hora;
      toast(`✅ Entrada marcada a las ${r.hora}`, 'success');
      Attendance.load();
    } catch(e) {
      toast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async checkout() {
    const btn = document.getElementById('btnCheckout');
    if (btn) btn.disabled = true;
    try {
      const body = {
        lat: Attendance._gpsCoords?.lat || null,
        lng: Attendance._gpsCoords?.lng || null,
        address: Attendance._gpsAddress || ''
      };
      const r = await api('/attendance/checkout', { method: 'POST', body });
      document.getElementById('checkoutTime').textContent = r.hora;
      toast(`✅ Salida marcada a las ${r.hora}`, 'success');
      Attendance.load();
    } catch(e) {
      toast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
};
