/**
 * Authentication lifecycle: login/register mode switching, credential validation,
 * bootstrap launch, logout revocation, and quick theme toggling.
 */

import { loadBootstrap, loadMessages, renderAll } from './actions.js';
import { api, handleError } from './api.js';
import { apiUrl } from './config.js';
import { closeOverlays } from './menus.js';
import { leaveMeetingRoom } from './meeting_ui.js';
import { renderRail } from './render_shell.js';
import { closeSettingsModal } from './settings.js';
import { $, ICONS, applyTheme, currentChannel, state } from './state.js';
import { connectWs } from './ws.js';

let authMode = 'login';

function setPasswordVisible(visible) {
  const pwd = $('passwordInput');
  const toggle = $('togglePasswordBtn');
  if (!pwd || !toggle) return;
  pwd.type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
  toggle.setAttribute('aria-label', visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
  toggle.innerHTML = visible ? ICONS.eyeOff : ICONS.eye;
}

function clearAuthValidation() {
  $('usernameInput')?.removeAttribute('aria-invalid');
  $('passwordInput')?.removeAttribute('aria-invalid');
  $('loginError').textContent = '';
}

export function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  const tabLogin = $('tabLogin');
  const tabRegister = $('tabRegister');
  if (tabLogin && tabRegister) {
    tabLogin.classList.toggle('active', isLogin);
    tabLogin.setAttribute('aria-selected', isLogin ? 'true' : 'false');
    tabRegister.classList.toggle('active', !isLogin);
    tabRegister.setAttribute('aria-selected', !isLogin ? 'true' : 'false');
  }
  const pwdInput = $('passwordInput');
  if (pwdInput) {
    pwdInput.autocomplete = isLogin ? 'current-password' : 'new-password';
    pwdInput.placeholder = isLogin ? 'กรอกรหัสผ่าน' : 'สร้างรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)';
  }
  const hint = $('passwordHint');
  if (hint) hint.textContent = isLogin ? '8-128 ตัวอักษร' : 'อย่างน้อย 8 ตัวอักษร';
  const button = $('loginBtn');
  if (button) button.textContent = isLogin ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
  setPasswordVisible(false);
  clearAuthValidation();
}

/** Binds auth tabs, password visibility toggle, and semantic form submission. */
export function bindAuthEvents() {
  const form = $('authForm');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    doAuth();
  });
  $('tabLogin')?.addEventListener('click', () => setAuthMode('login'));
  $('tabRegister')?.addEventListener('click', () => setAuthMode('register'));
  [$('tabLogin'), $('tabRegister')].forEach((tab) => {
    tab?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const next = tab.id === 'tabLogin' ? 'register' : 'login';
        setAuthMode(next);
        $(next === 'login' ? 'tabLogin' : 'tabRegister')?.focus();
      }
    });
  });
  $('togglePasswordBtn')?.addEventListener('click', () => {
    const toggle = $('togglePasswordBtn');
    const currentlyShown = toggle?.getAttribute('aria-pressed') === 'true';
    setPasswordVisible(!currentlyShown);
  });
  $('usernameInput')?.addEventListener('input', () => $('usernameInput').removeAttribute('aria-invalid'));
  $('passwordInput')?.addEventListener('input', () => $('passwordInput').removeAttribute('aria-invalid'));
}

export function logout(expired = false) {
  if (!expired && state.token) {
    fetch(apiUrl('/logout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    }).catch(() => {});
  }
  localStorage.removeItem('ob_token');
  leaveMeetingRoom(state.joinedVoiceChannelId, () => {}).catch(() => {});
  state.token = '';
  state.me = null;
  state.servers = [];
  state.messages = [];
  state.voice = {};
  state.voiceChannelId = null;
  state.joinedVoiceChannelId = null;
  state.meetingPeers.clear();
  state.userStatuses.clear();
  state.unread.clear();
  state.mentions.clear();
  state.replyTo = null;
  closeOverlays();
  closeSettingsModal(false);
  if (state.ws) { state.ws.onclose = null; state.ws.close(); }
  clearTimeout(state.reconnectTimer);
  $('shell').hidden = true;
  $('login').hidden = false;
  $('loginError').textContent = expired ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : '';
  const pwd = $('passwordInput');
  if (pwd) pwd.value = '';
  setAuthMode('login');
}

export async function start() {
  $('login').hidden = true;
  $('shell').hidden = false;
  try {
    await loadBootstrap();
  } catch (error) {
    handleError(error);
    $('login').hidden = false;
    $('shell').hidden = true;
    return;
  }
  const channel = currentChannel();
  $('messageInput').placeholder = channel ? `ส่งข้อความไปที่ #${channel.name}` : 'เลือกช่องก่อนส่งข้อความ';
  renderAll();
  requestAnimationFrame(() => {
    const input = $('messageInput');
    if (input) { input.style.height = 'auto'; }
  });
  await loadMessages();
  connectWs();
}

export async function doAuth() {
  const button = $('loginBtn');
  const userEl = $('usernameInput');
  const pwdEl = $('passwordInput');
  const username = userEl.value.trim();
  const password = pwdEl ? pwdEl.value : '';
  clearAuthValidation();

  if (!username) {
    userEl.setAttribute('aria-invalid', 'true');
    $('loginError').textContent = 'กรุณากรอกชื่อผู้ใช้';
    userEl.focus();
    return;
  }
  if (username.length > 32) {
    userEl.setAttribute('aria-invalid', 'true');
    $('loginError').textContent = 'ชื่อผู้ใช้ต้องไม่เกิน 32 ตัวอักษร';
    userEl.focus();
    return;
  }
  if (!password) {
    pwdEl?.setAttribute('aria-invalid', 'true');
    $('loginError').textContent = 'กรุณากรอกรหัสผ่าน';
    pwdEl?.focus();
    return;
  }
  if (password.length < 8) {
    pwdEl?.setAttribute('aria-invalid', 'true');
    $('loginError').textContent = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
    pwdEl?.focus();
    return;
  }
  if (password.length > 128) {
    pwdEl?.setAttribute('aria-invalid', 'true');
    $('loginError').textContent = 'รหัสผ่านต้องไม่เกิน 128 ตัวอักษร';
    pwdEl?.focus();
    return;
  }

  button.disabled = true;
  const actionLabel = authMode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
  button.textContent = `กำลัง${actionLabel}…`;
  try {
    const endpoint = apiUrl(authMode === 'login' ? '/login' : '/register');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `${actionLabel}ไม่สำเร็จ`);
    state.token = data.token;
    localStorage.setItem('ob_token', data.token);
    if ($('passwordInput')) $('passwordInput').value = '';
    await start();
  } catch (error) {
    $('loginError').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = authMode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
  }
}

export async function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next, state.settings.custom_colors);
  renderRail();
  if (state.token) {
    api('/users/@me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  }
}
