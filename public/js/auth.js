// ============================================================
//  NEXORA — auth.js
// ============================================================
'use strict';

const Auth = {
  async logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch(e) { /* ignorar */ }
    window.location.href = '/';
  },

  async changePassword() {
    const actual   = document.getElementById('cpActual').value;
    const nueva    = document.getElementById('cpNueva').value;
    const confirm  = document.getElementById('cpConfirm').value;

    if (!actual)  { toast('Ingresa tu contraseña actual', 'error'); return; }
    if (!nueva)   { toast('Ingresa la nueva contraseña', 'error'); return; }
    if (nueva.length < 4) { toast('La nueva contraseña debe tener al menos 4 caracteres', 'error'); return; }
    if (nueva !== confirm) { toast('Las contraseñas no coinciden', 'error'); return; }

    const btn = document.getElementById('btnChangePass');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { passwordActual: actual, passwordNueva: nueva }
      });
      toast('✅ Contraseña actualizada correctamente', 'success');
      closeModal('modalChangePassword');
      // Limpiar campos
      ['cpActual','cpNueva','cpConfirm'].forEach(id => {
        document.getElementById(id).value = '';
      });
    } catch(e) {
      toast(e.message || 'Error al cambiar contraseña', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Cambiar contraseña';
    }
  }
};
