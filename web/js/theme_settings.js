/**
 * Theme preset selector, live custom color palette controls, contrast readout,
 * and backend persistence for Appearance settings.
 */

import { api, toast } from './api.js';
import { renderRail } from './render_shell.js';
import {
  $, DEFAULT_CUSTOM_COLORS, VALID_THEMES, applyTheme, contrastRatio,
  hexLuminance, normalizeHex6, safeColor, state,
} from './state.js';

const PALETTE_FIELDS = [
  ['brand', 'customBrandPicker', 'customBrandHex'],
  ['sidebar', 'customSidebarPicker', 'customSidebarHex'],
  ['chat', 'customChatPicker', 'customChatHex'],
];

const themeDraft = {
  theme: 'dark',
  colors: { ...DEFAULT_CUSTOM_COLORS },
};

/** Loads active user theme settings into draft controls before opening modal. */
export function loadThemeDraft() {
  themeDraft.theme = VALID_THEMES.includes(state.settings.theme) ? state.settings.theme : 'dark';
  themeDraft.colors = {
    brand: safeColor(state.settings.custom_colors?.brand, DEFAULT_CUSTOM_COLORS.brand),
    sidebar: safeColor(state.settings.custom_colors?.sidebar, DEFAULT_CUSTOM_COLORS.sidebar),
    chat: safeColor(state.settings.custom_colors?.chat, DEFAULT_CUSTOM_COLORS.chat),
  };
  syncThemeControls();
}

/** Syncs preset cards, color inputs, and the live WCAG contrast indicator. */
export function syncThemeControls() {
  document.querySelectorAll('#themePresetGrid .theme-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.themePreset === themeDraft.theme);
  });
  for (const [key, pickerId, hexId] of PALETTE_FIELDS) {
    const hex = normalizeHex6(themeDraft.colors[key], DEFAULT_CUSTOM_COLORS[key]);
    const picker = $(pickerId);
    const text = $(hexId);
    if (picker) picker.value = hex;
    if (text && document.activeElement !== text) text.value = hex;
  }
  const note = $('customContrastNote');
  if (note) {
    const textHex = hexLuminance(themeDraft.colors.chat) > 0.36 ? '#111827' : '#f3f4f6';
    const ratio = contrastRatio(themeDraft.colors.chat, textHex);
    note.textContent = ratio >= 4.5
      ? `ความคมชัดข้อความ ${ratio.toFixed(1)}:1 (อ่านง่าย)`
      : `ความคมชัด ${ratio.toFixed(1)}:1 (ต่ำ)`;
    note.style.color = ratio >= 4.5 ? 'var(--green)' : 'var(--amber)';
  }
}

/** Saves the chosen preset/custom palette to the backend and closes the modal. */
export async function saveThemeSettings(onSaved) {
  const btn = $('saveThemeBtn');
  $('settingsError').textContent = '';

  const palette = {
    brand: $('customBrandHex').value.trim(),
    sidebar: $('customSidebarHex').value.trim(),
    chat: $('customChatHex').value.trim(),
  };
  for (const [k, v] of Object.entries(palette)) {
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      $('settingsError').textContent = `กรุณากรอกรหัสสีให้ถูกต้อง เช่น #5865f2`;
      return;
    }
  }

  btn.disabled = true;
  try {
    const res = await api('/users/@me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: themeDraft.theme, custom_colors: palette }),
    });
    const saved = res?.settings || { theme: themeDraft.theme, custom_colors: palette };
    applyTheme(saved.theme, saved.custom_colors);
    renderRail();
    toast('บันทึกการตั้งค่าธีมแล้ว', 'ok');
    onSaved();
  } catch (error) {
    $('settingsError').textContent = error.message || 'บันทึกธีมไม่สำเร็จ';
  } finally {
    btn.disabled = false;
  }
}

/** Resets theme preset and custom colors back to default Dark values. */
export async function resetThemeSettings() {
  themeDraft.theme = 'dark';
  themeDraft.colors = { ...DEFAULT_CUSTOM_COLORS };
  syncThemeControls();
  applyTheme(themeDraft.theme, themeDraft.colors);
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

/** Binds preset card clicks, custom palette pickers, save, and reset buttons. */
export function bindThemeEvents(onSaved) {
  $('themePresetGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    themeDraft.theme = card.dataset.themePreset;
    syncThemeControls();
    applyTheme(themeDraft.theme, themeDraft.colors);
  });

  PALETTE_FIELDS.forEach(([key, pickerId, hexId]) => {
    $(pickerId).addEventListener('input', (e) => {
      themeDraft.colors[key] = e.target.value;
      $(hexId).value = e.target.value;
      themeDraft.theme = 'custom';
      syncThemeControls();
      applyTheme('custom', themeDraft.colors);
    });
    $(hexId).addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) return;
      themeDraft.colors[key] = val;
      themeDraft.theme = 'custom';
      syncThemeControls();
      applyTheme('custom', themeDraft.colors);
    });
  });

  $('saveThemeBtn').addEventListener('click', () => saveThemeSettings(onSaved));
  $('resetThemeBtn').addEventListener('click', resetThemeSettings);
}
