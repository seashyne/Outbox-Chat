/**
 * Settings modal controller: global & per-server profile editor
 * (`@username`, display name, avatar photo, banner photo, bio, custom status text),
 * plus online presence and Appearance theme coordination.
 */

import { updateMyStatus } from './actions.js';
import { syncAccountSettingsSection } from './account_ui.js';
import { api, toast } from './api.js';
import { closeOverlays } from './menus.js';
import { bindBackdropDismiss } from './modals.js';
import { bannerStyle, wireImageInput } from './profile_helpers.js';
import { renderMessages } from './render_chat.js';
import { renderMembers, renderUserPanel } from './render_shell.js';
import { $, AVATAR_COLORS, escapeHtml, initials, normalizeHex6, safeAvatarUrl, safeColor, setModalInert, state } from './state.js';
import { bindThemeEvents, loadThemeDraft } from './theme_settings.js';
import { renderLanguageOptions, setLanguage, t } from './i18n.js';
import { isSoundEnabled, requestDesktopNotifications, setSoundEnabled } from './notify.js';

export { updateMyStatus };

let settingsTab = 'profile';
let profileScope = ''; // "" = global, otherwise serverId
let draftAvatarColor = '#5865f2';
let draftAvatarUrl = '';
let draftBannerUrl = '';
let lastSettingsFocus = null;
let logoutCallback = null;

function loadScopeFields() {
  if (!state.me) return;
  const srv = profileScope ? state.servers.find((s) => s.id === profileScope) : null;
  const sp = srv?.member_profiles?.[state.me.id] || {};
  const isSrv = Boolean(srv);

  $('globalUsernameWrap').hidden = isSrv;
  $('globalStatusTextWrap').hidden = isSrv;
  $('globalProfileExtras').hidden = isSrv;
  $('settingsDisplayNameLabel').textContent = isSrv
    ? t('settings.serverNickLabel')
    : t('settings.displayNameLabel');
  $('settingsDisplayName').placeholder = isSrv ? state.me.display_name : t('settings.displayNamePh');

  $('settingsUsername').value = state.me.username || '';
  $('settingsDisplayName').value = isSrv ? (sp.nickname || '') : (state.me.display_name || '');
  $('settingsStatusText').value = state.me.status_text || '';
  $('settingsBio').value = isSrv ? (sp.bio || '') : (state.me.bio || '');
  draftAvatarColor = normalizeHex6(state.me.color, '#5865f2');
  draftAvatarUrl = isSrv ? (sp.avatar_url || '') : (state.me.avatar_url || '');
  draftBannerUrl = isSrv ? (sp.banner_url || '') : (state.me.banner_url || '');
  $('settingsStatusSelect').value = state.myStatus || 'online';
  syncAccountSettingsSection(logoutCallback);
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

/** Switches between Profile, Account & Security, and Appearance tabs inside Settings. */
export function switchSettingsTab(tab) {
  settingsTab = ['profile', 'account', 'appearance'].includes(tab) ? tab : 'profile';
  document.querySelectorAll('.settings-tab').forEach((el) => {
    const active = el.dataset.settingsTab === settingsTab;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('settingsPaneProfile').hidden = settingsTab !== 'profile';
  if ($('settingsPaneAccount')) $('settingsPaneAccount').hidden = settingsTab !== 'account';
  $('settingsPaneAppearance').hidden = settingsTab !== 'appearance';
  if (settingsTab === 'account') syncAccountSettingsSection(logoutCallback);
  $('settingsError').textContent = '';
}

function refreshScopeSelect() {
  const scopeSel = $('settingsProfileScope');
  if (!scopeSel) return;
  const cur = scopeSel.value || profileScope;
  scopeSel.innerHTML = `<option value="">${escapeHtml(t('settings.scopeGlobal'))}</option>` +
    state.servers.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(t('settings.scopeServer', { name: s.name }))}</option>`).join('');
  scopeSel.value = state.servers.some((s) => s.id === cur) ? cur : '';
  profileScope = scopeSel.value;
}

/** Opens the Settings dialog on the requested tab and populates server scopes. */
export function openSettingsModal(tab = 'profile') {
  closeOverlays();
  if (!state.me) return;
  lastSettingsFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('settingsError').textContent = '';
  profileScope = '';
  refreshScopeSelect();
  if ($('notifySoundToggle')) $('notifySoundToggle').checked = isSoundEnabled();

  const langSel = $('settingsLangSelect');
  renderLanguageOptions(langSel);

  $('avatarColorSwatches').innerHTML = AVATAR_COLORS.map((c) =>
    `<button type="button" class="color-swatch" data-color="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`
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
      toast(t('settings.savedServerProfile'), 'ok');
      closeSettingsModal(false);
    } catch (error) {
      $('settingsError').textContent = error.message || t('settings.saveProfileErr');
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
    $('settingsError').textContent = t('settings.errHandle');
    return;
  }
  if (!displayName || displayName.length > 32) {
    $('settingsError').textContent = t('settings.errDisplayName');
    return;
  }
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorHex)) {
    $('settingsError').textContent = t('settings.errColor');
    return;
  }

  const emailVal = $('settingsEmail') ? $('settingsEmail').value.trim() : undefined;
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
        ...(emailVal !== undefined ? { email: emailVal } : {}),
      }),
    });
    if (profileRes?.account) state.account = profileRes.account;
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
    toast(t('settings.savedProfile'), 'ok');
    closeSettingsModal(false);
  } catch (error) {
    $('settingsError').textContent = error.message || t('settings.saveProfileErr');
  } finally {
    btn.disabled = false;
  }
}

/** Wires DOM listeners for global/per-server profile, images, status, and appearance. */
export function bindSettingsEvents(onLogout) {
  logoutCallback = onLogout;
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
    refreshScopeSelect();
    loadScopeFields();
    renderLanguageOptions($('settingsLangSelect'), e.target.value);
  });
  $('notifySoundToggle')?.addEventListener('change', (e) => setSoundEnabled(e.target.checked));
  $('desktopNotifyBtn')?.addEventListener('click', () => requestDesktopNotifications().catch(() => {}));
  ['settingsDisplayName', 'settingsUsername', 'settingsStatusText', 'settingsBio'].forEach((id) => {
    $(id)?.addEventListener('input', syncSettingsPreview);
  });
  const bindImg = (opts) => wireImageInput({
    ...opts,
    onSet: (v) => { opts.assign(v); syncSettingsPreview(); },
    onError: (msg) => { $('settingsError').textContent = msg; },
  });
  bindImg({ inputId: 'avatarFileInput', clearId: 'clearAvatarBtn', triggers: ['uploadAvatarBtn', 'spAvatar'], width: 128, height: 128, maxBytes: 65000, assign: (v) => { draftAvatarUrl = v; }, errKey: 'settings.errAvatarImg' });
  bindImg({ inputId: 'bannerFileInput', clearId: 'clearBannerBtn', triggers: ['uploadBannerBtn'], width: 480, height: 160, maxBytes: 115000, assign: (v) => { draftBannerUrl = v; }, errKey: 'settings.errBannerImg' });
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
