/**
 * Settings modal controller: profile editor (display name, avatar color, status),
 * focus/inert lifecycle, and coordination with the Appearance theme customizer.
 */

import { api, handleError, toast } from './api.js';
import { closeOverlays } from './menus.js';
import { bindBackdropDismiss } from './modals.js';
import { renderMessages } from './render_chat.js';
import { renderMembers, renderRail, renderUserPanel } from './render_shell.js';
import { $, AVATAR_COLORS, escapeHtml, initials, normalizeHex6, safeAvatarUrl, safeColor, setModalInert, state, statusLabel } from './state.js';
import { bindThemeEvents, loadThemeDraft } from './theme_settings.js';

let settingsTab = 'profile';
let draftAvatarColor = '#5865f2';
let draftAvatarUrl = '';
let lastSettingsFocus = null;

/** Center-crops and compresses a selected image file into a compact 128x128 data URL. */
async function resizeAvatarFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('load failed'));
      el.src = url;
    });
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    const webp = canvas.toDataURL('image/webp', 0.82);
    if (webp.startsWith('data:image/webp') && webp.length <= 65000) return webp;
    const jpeg = canvas.toDataURL('image/jpeg', 0.82);
    if (jpeg.length <= 65000) return jpeg;
    throw new Error('image too large');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Updates live avatar banner/initials/photo preview and active color swatches. */
export function syncSettingsPreview() {
  if (!state.me) return;
  const nameInput = $('settingsDisplayName');
  const previewName = nameInput?.value.trim() || state.me.display_name || state.me.username || '?';
  $('spBanner').style.background = safeColor(draftAvatarColor);
  const av = $('spAvatar');
  av.style.background = safeColor(draftAvatarColor);
  const safeImg = safeAvatarUrl(draftAvatarUrl);
  if (safeImg) {
    av.innerHTML = `<img src="${escapeHtml(safeImg)}" alt="${escapeHtml(previewName)}" />`;
  } else {
    av.textContent = initials(previewName);
  }
  const clearBtn = $('clearAvatarBtn');
  if (clearBtn) clearBtn.hidden = !safeImg;
  $('spDisplayName').textContent = previewName;
  $('spUsername').textContent = `@${state.me.username}`;
  document.querySelectorAll('#avatarColorSwatches .color-swatch').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color.toLowerCase() === normalizeHex6(draftAvatarColor));
  });
  const picker = $('settingsAvatarColorPicker');
  const hexInput = $('settingsAvatarColorHex');
  if (picker) picker.value = normalizeHex6(draftAvatarColor);
  if (hexInput && document.activeElement !== hexInput) hexInput.value = normalizeHex6(draftAvatarColor);
}

/** Switches between Profile & Appearance tabs inside the Settings dialog. */
export function switchSettingsTab(tab) {
  settingsTab = tab === 'appearance' ? 'appearance' : 'profile';
  document.querySelectorAll('.settings-tab').forEach((el) => {
    const active = el.dataset.settingsTab === settingsTab;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('settingsPaneProfile').hidden = settingsTab !== 'profile';
  $('settingsPaneAppearance').hidden = settingsTab !== 'appearance';
  $('settingsError').textContent = '';
}

/** Opens the Settings dialog on the requested tab and marks the app shell inert. */
export function openSettingsModal(tab = 'profile') {
  closeOverlays();
  if (!state.me) return;
  lastSettingsFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('settingsError').textContent = '';
  $('settingsDisplayName').value = state.me.display_name || '';
  draftAvatarColor = normalizeHex6(state.me.color, '#5865f2');
  draftAvatarUrl = state.me.avatar_url || '';
  $('settingsStatusSelect').value = state.myStatus || 'online';

  $('avatarColorSwatches').innerHTML = AVATAR_COLORS.map((c) =>
    `<button type="button" class="color-swatch" data-color="${c}" style="background:${c}" title="${c}" aria-label="เลือกสี ${c}"></button>`
  ).join('');

  syncSettingsPreview();
  loadThemeDraft();
  switchSettingsTab(tab);
  setModalInert(true);
  $('settingsBackdrop').hidden = false;
  const focusTarget = tab === 'appearance'
    ? document.querySelector('#themePresetGrid .theme-card.active, #themePresetGrid .theme-card')
    : $('settingsDisplayName');
  focusTarget?.focus();
}

/** Closes the Settings dialog, optionally reverting unsaved theme preview changes. */
export function closeSettingsModal(revertPreview = true) {
  if ($('settingsBackdrop').hidden) return;
  $('settingsBackdrop').hidden = true;
  setModalInert(false);
  if (revertPreview) loadThemeDraft();
  if (lastSettingsFocus?.isConnected) lastSettingsFocus.focus();
  lastSettingsFocus = null;
}

/** Saves profile display name, avatar color, and online status to the backend. */
export async function saveProfileSettings() {
  const btn = $('saveProfileBtn');
  const displayName = $('settingsDisplayName').value.trim();
  const colorHex = $('settingsAvatarColorHex').value.trim();
  const status = $('settingsStatusSelect').value;
  $('settingsError').textContent = '';

  if (!displayName || displayName.length > 32) {
    $('settingsError').textContent = 'ชื่อที่แสดงต้องมีความยาว 1-32 ตัวอักษร';
    return;
  }
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorHex)) {
    $('settingsError').textContent = 'กรุณาเลือกรหัสสีอวาตาร์ให้ถูกต้อง เช่น #5865f2';
    return;
  }

  btn.disabled = true;
  try {
    const profileRes = await api('/users/@me', {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: displayName,
        color: colorHex,
        avatar_url: draftAvatarUrl || '',
      }),
    });
    if (profileRes?.user) {
      state.me = profileRes.user;
      for (const s of state.servers) {
        const idx = s.members.findIndex((m) => m.id === state.me.id);
        if (idx !== -1) s.members[idx] = { ...s.members[idx], ...state.me };
      }
      for (const m of state.messages) {
        if (m.author && m.author.id === state.me.id) m.author = { ...m.author, ...state.me };
      }
    }
    const settingsRes = await api('/users/@me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (settingsRes?.settings) {
      state.myStatus = settingsRes.settings.status || status;
      state.settings.status = state.myStatus;
    }
    renderUserPanel();
    renderMembers();
    renderMessages();
    syncSettingsPreview();
    toast('บันทึกข้อมูลโปรไฟล์แล้ว', 'ok');
    closeSettingsModal(false);
  } catch (error) {
    $('settingsError').textContent = error.message || 'บันทึกโปรไฟล์ไม่สำเร็จ';
  } finally {
    btn.disabled = false;
  }
}

/** Updates presence status immediately and broadcasts over WebSocket. */
export async function updateMyStatus(nextStatus) {
  state.myStatus = nextStatus;
  state.settings.status = nextStatus;
  renderUserPanel();
  renderMembers();
  renderRail();
  closeOverlays();
  try {
    await api('/users/@me/settings', { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({ type: 'status', status: nextStatus }));
    }
    toast(`ตั้งสถานะเป็น${statusLabel(state.myStatus)}`, 'ok');
  } catch (error) {
    handleError(error);
  }
}

/** Wires DOM event listeners for the Settings modal and delegates Appearance events. */
export function bindSettingsEvents(onLogout) {
  $('settingsClose').addEventListener('click', () => closeSettingsModal(true));
  bindBackdropDismiss($('settingsBackdrop'), () => closeSettingsModal(true));
  document.querySelectorAll('.settings-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => switchSettingsTab(tabBtn.dataset.settingsTab));
    tabBtn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const next = tabBtn.dataset.settingsTab === 'profile' ? 'appearance' : 'profile';
      switchSettingsTab(next);
      document.querySelector(`.settings-tab[data-settings-tab="${next}"]`)?.focus();
    });
  });
  $('settingsDisplayName').addEventListener('input', syncSettingsPreview);
  $('uploadAvatarBtn')?.addEventListener('click', () => $('avatarFileInput')?.click());
  $('spAvatar')?.addEventListener('click', () => $('avatarFileInput')?.click());
  $('clearAvatarBtn')?.addEventListener('click', () => {
    draftAvatarUrl = '';
    if ($('avatarFileInput')) $('avatarFileInput').value = '';
    syncSettingsPreview();
  });
  $('avatarFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $('settingsError').textContent = '';
    try {
      draftAvatarUrl = await resizeAvatarFile(file);
      syncSettingsPreview();
    } catch {
      $('settingsError').textContent = 'ไม่สามารถใช้รูปนี้ได้ กรุณาเลือกรูปภาพอื่นที่ขนาดไม่เกิน 5 MB';
    }
  });
  $('avatarColorSwatches').addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch');
    if (!btn) return;
    draftAvatarColor = btn.dataset.color;
    syncSettingsPreview();
  });
  $('settingsAvatarColorPicker').addEventListener('input', (e) => {
    draftAvatarColor = e.target.value;
    $('settingsAvatarColorHex').value = draftAvatarColor;
    syncSettingsPreview();
  });
  $('settingsAvatarColorHex').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) { draftAvatarColor = val; syncSettingsPreview(); }
  });
  $('saveProfileBtn').addEventListener('click', saveProfileSettings);
  $('settingsLogoutBtn').addEventListener('click', () => onLogout(false));
  bindThemeEvents(() => closeSettingsModal(false));
}
