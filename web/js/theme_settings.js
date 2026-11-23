/**
 * Theme preset selector, live custom color palette controls, contrast readout,
 * and backend persistence for Appearance settings.
 */

import { api, toast } from './api.js';
import { getLanguage, t } from './i18n.js';
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
      ? t('settings.contrastGood', { ratio: ratio.toFixed(1) })
      : t('settings.contrastLow', { ratio: ratio.toFixed(1) });
    note.style.color = ratio >= 4.5 ? 'var(--green)' : 'var(--amber)';
  }
}

/** Saves the chosen preset/custom palette + language to backend and closes modal. */
export async function saveThemeSettings(onSaved) {
  const btn = $('saveThemeBtn');
  $('settingsError').textContent = '';

  const palette = {
    brand: $('customBrandHex').value.trim(),
    sidebar: $('customSidebarHex').value.trim(),
    chat: $('customChatHex').value.trim(),
  };
  for (const [, v] of Object.entries(palette)) {
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      $('settingsError').textContent = t('settings.errColor');
      return;
    }
  }

  btn.disabled = true;
  try {
    const lang = getLanguage();
    const res = await api('/users/@me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: themeDraft.theme, custom_colors: palette, language: lang }),
    });
    const saved = res?.settings || { theme: themeDraft.theme, custom_colors: palette, language: lang };
    applyTheme(saved.theme, saved.custom_colors);
    renderRail();
    toast(t('settings.savedAppearance'), 'ok');
    onSaved();
  } catch (error) {
    $('settingsError').textContent = error.message || t('settings.saveAppearanceErr');
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
    toast(t('settings.resetThemeOk'), 'ok');
  } catch (error) {
    $('settingsError').textContent = error.message || t('settings.resetThemeErr');
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
