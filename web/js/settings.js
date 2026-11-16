/**
 * Settings modal controller: profile editor (display name, avatar color, status)
 * and live theme customizer (presets + 3-color custom palette).
 */

import { api, handleError, toast } from './api.js';
import { closeOverlays } from './menus.js';
import { renderMessages } from './render_chat.js';
import { renderMembers, renderRail, renderUserPanel } from './render_shell.js';
import {
  $,
  AVATAR_COLORS,
  DEFAULT_CUSTOM_COLORS,
  VALID_THEMES,
  applyTheme,
  initials,
  normalizeHex6,
  safeColor,
  state,
  statusLabel,
} from './state.js';

let settingsTab = 'profile';
let draftTheme = 'dark';
let draftCustomColors = { ...DEFAULT_CUSTOM_COLORS };
let draftAvatarColor = '#5865f2';

export function syncSettingsPreview() {
  if (!state.me) return;
  const nameInput = $('settingsDisplayName');
  const previewName = nameInput?.value.trim() || state.me.display_name || state.me.username || '?';
  $('spBanner').style.background = safeColor(draftAvatarColor);
  $('spAvatar').style.background = safeColor(draftAvatarColor);
  $('spAvatar').textContent = initials(previewName);
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

export function syncThemeControls() {
  document.querySelectorAll('#themePresetGrid .theme-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.themePreset === draftTheme);
  });
  const map = [
    ['brand', 'customBrandPicker', 'customBrandHex'],
    ['sidebar', 'customSidebarPicker', 'customSidebarHex'],
    ['chat', 'customChatPicker', 'customChatHex'],
  ];
  for (const [key, pickerId, hexId] of map) {
    const hex = normalizeHex6(draftCustomColors[key], DEFAULT_CUSTOM_COLORS[key]);
    const picker = $(pickerId);
    const text = $(hexId);
    if (picker) picker.value = hex;
    if (text && document.activeElement !== text) text.value = hex;
  }
}

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

export function openSettingsModal(tab = 'profile') {
  closeOverlays();
  if (!state.me) return;
  $('settingsError').textContent = '';
  $('settingsDisplayName').value = state.me.display_name || '';
  draftAvatarColor = normalizeHex6(state.me.color, '#5865f2');
  $('settingsStatusSelect').value = state.myStatus || 'online';

  $('avatarColorSwatches').innerHTML = AVATAR_COLORS.map((c) =>
    `<button type="button" class="color-swatch" data-color="${c}" style="background:${c}" title="${c}" aria-label="เลือกสี ${c}"></button>`
  ).join('');

  draftTheme = VALID_THEMES.includes(state.settings.theme) ? state.settings.theme : 'dark';
  draftCustomColors = {
    brand: safeColor(state.settings.custom_colors?.brand, DEFAULT_CUSTOM_COLORS.brand),
    sidebar: safeColor(state.settings.custom_colors?.sidebar, DEFAULT_CUSTOM_COLORS.sidebar),
    chat: safeColor(state.settings.custom_colors?.chat, DEFAULT_CUSTOM_COLORS.chat),
  };

  syncSettingsPreview();
  syncThemeControls();
  switchSettingsTab(tab);
  $('settingsBackdrop').hidden = false;
}

export function closeSettingsModal(revertPreview = true) {
  if ($('settingsBackdrop').hidden) return;
  $('settingsBackdrop').hidden = true;
  if (revertPreview) {
    applyTheme(state.settings.theme, state.settings.custom_colors);
  }
}

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
    $('settingsError').textContent = 'รหัสสีอวาตาร์ต้องเป็นรูปแบบ Hex เช่น #5865f2';
    return;
  }

  btn.disabled = true;
  try {
    const profileRes = await api('/users/@me', {
      method: 'PATCH',
      body: JSON.stringify({ display_name: displayName, color: colorHex }),
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

export async function saveThemeSettings() {
  const btn = $('saveThemeBtn');
  $('settingsError').textContent = '';

  const palette = {
    brand: $('customBrandHex').value.trim(),
    sidebar: $('customSidebarHex').value.trim(),
    chat: $('customChatHex').value.trim(),
  };
  for (const [k, v] of Object.entries(palette)) {
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      $('settingsError').textContent = `รหัสสี ${k} ไม่ถูกต้อง (ต้องเป็น Hex เช่น #5865f2)`;
      return;
    }
  }

  btn.disabled = true;
  try {
    const res = await api('/users/@me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: draftTheme, custom_colors: palette }),
    });
    const saved = res?.settings || { theme: draftTheme, custom_colors: palette };
    applyTheme(saved.theme, saved.custom_colors);
    renderRail();
    toast('บันทึกการตั้งค่าธีมแล้ว', 'ok');
    closeSettingsModal(false);
  } catch (error) {
    $('settingsError').textContent = error.message || 'บันทึกธีมไม่สำเร็จ';
  } finally {
    btn.disabled = false;
  }
}

export async function resetThemeSettings() {
  draftTheme = 'dark';
  draftCustomColors = { ...DEFAULT_CUSTOM_COLORS };
  syncThemeControls();
  applyTheme(draftTheme, draftCustomColors);
  try {
    await api('/users/@me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'dark', custom_colors: DEFAULT_CUSTOM_COLORS }),
    });
    renderRail();
    toast('รีเซ็ตธีมเป็นค่าเริ่มต้นแล้ว', 'ok');
  } catch (error) {
    $('settingsError').textContent = error.message || 'รีเซ็ตธีมไม่สำเร็จ';
  }
}

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

/** Wires DOM event listeners for the Settings modal and live color pickers. */
export function bindSettingsEvents(onLogout) {
  $('settingsClose').addEventListener('click', () => closeSettingsModal(true));
  $('settingsBackdrop').addEventListener('click', (e) => {
    if (e.target === $('settingsBackdrop')) closeSettingsModal(true);
  });
  document.querySelectorAll('.settings-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => switchSettingsTab(tabBtn.dataset.settingsTab));
  });
  $('settingsDisplayName').addEventListener('input', syncSettingsPreview);
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
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) {
      draftAvatarColor = val;
      syncSettingsPreview();
    }
  });
  $('saveProfileBtn').addEventListener('click', saveProfileSettings);
  $('settingsLogoutBtn').addEventListener('click', () => onLogout(false));

  $('themePresetGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    draftTheme = card.dataset.themePreset;
    syncThemeControls();
    applyTheme(draftTheme, draftCustomColors);
  });

  [
    ['brand', 'customBrandPicker', 'customBrandHex'],
    ['sidebar', 'customSidebarPicker', 'customSidebarHex'],
    ['chat', 'customChatPicker', 'customChatHex'],
  ].forEach(([key, pickerId, hexId]) => {
    $(pickerId).addEventListener('input', (e) => {
      draftCustomColors[key] = e.target.value;
      $(hexId).value = e.target.value;
      draftTheme = 'custom';
      syncThemeControls();
      applyTheme('custom', draftCustomColors);
    });
    $(hexId).addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) {
        draftCustomColors[key] = val;
        draftTheme = 'custom';
        syncThemeControls();
        applyTheme('custom', draftCustomColors);
      }
    });
  });

  $('saveThemeBtn').addEventListener('click', saveThemeSettings);
  $('resetThemeBtn').addEventListener('click', resetThemeSettings);
}
