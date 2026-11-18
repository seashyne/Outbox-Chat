/**
 * Settings modal controller: global & per-server profile editor
 * (`@username`, display name, avatar photo, banner photo, bio, custom status text),
 * plus online presence and Appearance theme coordination.
 */

import { api, handleError, toast } from './api.js';
import { closeOverlays } from './menus.js';
import { bindBackdropDismiss } from './modals.js';
import { bannerStyle, resizeImageFile } from './profile_helpers.js';
import { renderMessages } from './render_chat.js';
import { renderMembers, renderRail, renderUserPanel } from './render_shell.js';
import { $, AVATAR_COLORS, escapeHtml, initials, normalizeHex6, safeAvatarUrl, safeColor, setModalInert, state, statusLabel } from './state.js';
import { bindThemeEvents, loadThemeDraft } from './theme_settings.js';
import { renderLanguageOptions, setLanguage } from './i18n.js';

let settingsTab = 'profile';
let profileScope = ''; // "" = global, otherwise serverId
let draftAvatarColor = '#5865f2';
let draftAvatarUrl = '';
let draftBannerUrl = '';
let lastSettingsFocus = null;

function loadScopeFields() {
  if (!state.me) return;
  const srv = profileScope ? state.servers.find((s) => s.id === profileScope) : null;
  const sp = srv?.member_profiles?.[state.me.id] || {};
  const isSrv = Boolean(srv);

  $('globalUsernameWrap').hidden = isSrv;
  $('globalStatusTextWrap').hidden = isSrv;
  $('globalProfileExtras').hidden = isSrv;
  $('settingsDisplayNameLabel').textContent = isSrv ? 'ชื่อเล่นในเซิร์ฟเวอร์นี้ (เว้นว่างเพื่อใช้ชื่อหลัก)' : 'ชื่อที่แสดง';
  $('settingsDisplayName').placeholder = isSrv ? state.me.display_name : 'ชื่อที่แสดง (1-32 ตัวอักษร)';

  $('settingsUsername').value = state.me.username || '';
  $('settingsDisplayName').value = isSrv ? (sp.nickname || '') : (state.me.display_name || '');
  $('settingsStatusText').value = state.me.status_text || '';
  $('settingsBio').value = isSrv ? (sp.bio || '') : (state.me.bio || '');
  draftAvatarColor = normalizeHex6(state.me.color, '#5865f2');
  draftAvatarUrl = isSrv ? (sp.avatar_url || '') : (state.me.avatar_url || '');
  draftBannerUrl = isSrv ? (sp.banner_url || '') : (state.me.banner_url || '');
  $('settingsStatusSelect').value = state.myStatus || 'online';
  syncSettingsPreview();
}

/** Updates live avatar/banner preview and active color swatches. */
export function syncSettingsPreview() {
  if (!state.me) return;
  const isSrv = Boolean(profileScope);
  const inputName = $('settingsDisplayName')?.value.trim();
  const previewName = inputName || state.me.display_name || state.me.username || '?';
  const effAvatar = draftAvatarUrl || (isSrv ? state.me.avatar_url : '');
  const effBanner = draftBannerUrl || (isSrv ? state.me.banner_url : '');

  $('spBanner').setAttribute('style', bannerStyle({ banner_url: effBanner, color: draftAvatarColor }));
  const av = $('spAvatar');
  av.style.background = safeColor(draftAvatarColor);
  const safeImg = safeAvatarUrl(effAvatar);
  if (safeImg) av.innerHTML = `<img src="${escapeHtml(safeImg)}" alt="${escapeHtml(previewName)}" />`;
  else av.textContent = initials(previewName);

  if ($('clearAvatarBtn')) $('clearAvatarBtn').hidden = !draftAvatarUrl;
  if ($('clearBannerBtn')) $('clearBannerBtn').hidden = !draftBannerUrl;
  $('spDisplayName').textContent = previewName;
  const handle = ($('settingsUsername')?.value || state.me.username || '').trim().replace(/^@+/, '');
  $('spUsername').textContent = `@${handle}`;

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

/** Opens the Settings dialog on the requested tab and populates server scopes. */
export function openSettingsModal(tab = 'profile') {
  closeOverlays();
  if (!state.me) return;
  lastSettingsFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('settingsError').textContent = '';
  const scopeSel = $('settingsProfileScope');
  scopeSel.innerHTML = `<option value="">โปรไฟล์หลัก (ทุกเซิร์ฟเวอร์)</option>` +
    state.servers.map((s) => `<option value="${escapeHtml(s.id)}">เฉพาะเซิร์ฟเวอร์: ${escapeHtml(s.name)}</option>`).join('');
  profileScope = '';
  scopeSel.value = '';

  const langSel = $('settingsLangSelect');
  renderLanguageOptions(langSel);

  $('avatarColorSwatches').innerHTML = AVATAR_COLORS.map((c) =>
    `<button type="button" class="color-swatch" data-color="${c}" style="background:${c}" title="${c}" aria-label="เลือกสี ${c}"></button>`
  ).join('');

  loadScopeFields();
  loadThemeDraft();
  switchSettingsTab(tab);
  setModalInert(true);
  $('settingsBackdrop').hidden = false;
  (tab === 'appearance'
    ? document.querySelector('#themePresetGrid .theme-card.active, #themePresetGrid .theme-card')
    : $('settingsDisplayName')
  )?.focus();
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

/** Saves either global profile or per-server override profile settings cleanly. */
export async function saveProfileSettings() {
  const btn = $('saveProfileBtn');
  const displayName = $('settingsDisplayName').value.trim();
  const bio = $('settingsBio').value.trim();
  $('settingsError').textContent = '';

  if (profileScope) {
    btn.disabled = true;
    try {
      const res = await api(`/servers/${encodeURIComponent(profileScope)}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({
          nickname: displayName,
          avatar_url: draftAvatarUrl || '',
          banner_url: draftBannerUrl || '',
          bio,
        }),
      });
      const srv = state.servers.find((s) => s.id === profileScope);
      if (srv && res?.profile) {
        srv.member_profiles = srv.member_profiles || {};
        srv.member_profiles[state.me.id] = res.profile;
      }
      renderMembers();
      renderMessages();
      toast('บันทึกโปรไฟล์เฉพาะเซิร์ฟเวอร์แล้ว', 'ok');
      closeSettingsModal(false);
    } catch (error) {
      $('settingsError').textContent = error.message || 'บันทึกโปรไฟล์ไม่สำเร็จ';
    } finally {
      btn.disabled = false;
    }
    return;
  }

  const handle = $('settingsUsername').value.trim().replace(/^@+/, '');
  const colorHex = $('settingsAvatarColorHex').value.trim();
  const statusText = $('settingsStatusText').value.trim();
  const status = $('settingsStatusSelect').value;

  if (handle.length < 2 || handle.length > 32 || /\s/.test(handle)) {
    $('settingsError').textContent = 'ชื่อ @ ต้องยาว 2-32 ตัวอักษรและไม่มีเว้นวรรค';
    return;
  }
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
        username: handle,
        display_name: displayName,
        color: colorHex,
        avatar_url: draftAvatarUrl || '',
        banner_url: draftBannerUrl || '',
        bio,
        status_text: statusText,
      }),
    });
    if (profileRes?.user) {
      state.me = profileRes.user;
      for (const s of state.servers) {
        const idx = s.members.findIndex((m) => m.id === state.me.id);
        if (idx !== -1) s.members[idx] = { ...s.members[idx], ...state.me };
      }
      for (const m of state.messages) {
        if (m.author?.id === state.me.id) m.author = { ...m.author, ...state.me };
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
    if (state.ws?.readyState === 1) state.ws.send(JSON.stringify({ type: 'status', status: nextStatus }));
    toast(`ตั้งสถานะเป็น${statusLabel(state.myStatus)}`, 'ok');
  } catch (error) {
    handleError(error);
  }
}

function wireImageInput(inputId, clearId, triggers, w, h, maxBytes, onSet, errMsg) {
  triggers.forEach((id) => $(id)?.addEventListener('click', () => $(inputId)?.click()));
  $(clearId)?.addEventListener('click', () => {
    onSet('');
    if ($(inputId)) $(inputId).value = '';
    syncSettingsPreview();
  });
  $(inputId)?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $('settingsError').textContent = '';
    try { onSet(await resizeImageFile(file, w, h, maxBytes)); syncSettingsPreview(); }
    catch { $('settingsError').textContent = errMsg; }
  });
}

/** Wires DOM listeners for global/per-server profile, images, status, and appearance. */
export function bindSettingsEvents(onLogout) {
  $('settingsClose').addEventListener('click', () => closeSettingsModal(true));
  bindBackdropDismiss($('settingsBackdrop'), () => closeSettingsModal(true));
  document.querySelectorAll('.settings-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => switchSettingsTab(tabBtn.dataset.settingsTab));
  });
  $('settingsProfileScope').addEventListener('change', (e) => {
    profileScope = e.target.value;
    $('settingsError').textContent = '';
    loadScopeFields();
  });
  $('settingsLangSelect').addEventListener('change', (e) => {
    setLanguage(e.target.value);
  });
  ['settingsDisplayName', 'settingsUsername', 'settingsStatusText', 'settingsBio'].forEach((id) => {
    $(id)?.addEventListener('input', syncSettingsPreview);
  });
  wireImageInput('avatarFileInput', 'clearAvatarBtn', ['uploadAvatarBtn', 'spAvatar'], 128, 128, 65000, (v) => { draftAvatarUrl = v; }, 'ไม่สามารถใช้รูปโปรไฟล์นี้ได้ กรุณาเลือกรูปอื่น');
  wireImageInput('bannerFileInput', 'clearBannerBtn', ['uploadBannerBtn'], 480, 160, 115000, (v) => { draftBannerUrl = v; }, 'ไม่สามารถใช้รูปพื้นหลังนี้ได้ กรุณาเลือกรูปอื่น');
  $('avatarColorSwatches').addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch');
    if (btn) { draftAvatarColor = btn.dataset.color; syncSettingsPreview(); }
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
