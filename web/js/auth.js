/**
 * Authentication lifecycle: login/register mode switching, credential validation,
 * bootstrap launch, logout revocation, and quick theme toggling.
 */

import { loadBootstrap, loadMessages, renderAll } from './actions.js';
import { api, handleError } from './api.js';
import { closeOverlays } from './menus.js';
import { renderRail } from './render_shell.js';
import { closeSettingsModal } from './settings.js';
import { $, applyTheme, currentChannel, state } from './state.js';
import { connectWs } from './ws.js';

let authMode = 'login';

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
    pwdInput.placeholder = isLogin ? 'รหัสผ่าน' : 'รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)';
  }
  const button = $('loginBtn');
  if (button) button.textContent = isLogin ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
  $('loginError').textContent = '';
}

export function logout(expired = false) {
  if (!expired && state.token) {
    fetch('/api/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    }).catch(() => {});
  }
  localStorage.removeItem('ob_token');
  state.token = '';
  state.me = null;
  state.servers = [];
  state.messages = [];
  state.voice = {};
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
  await loadMessages();
  connectWs();
}

export async function doAuth() {
  const button = $('loginBtn');
  const username = $('usernameInput').value.trim();
  const password = $('passwordInput') ? $('passwordInput').value : '';
  $('loginError').textContent = '';

  if (!username) {
    $('loginError').textContent = 'กรุณากรอกชื่อผู้ใช้';
    $('usernameInput').focus();
    return;
  }
  if (username.length > 32) {
    $('loginError').textContent = 'ชื่อผู้ใช้ต้องไม่เกิน 32 ตัวอักษร';
    $('usernameInput').focus();
    return;
  }
  if (!password) {
    $('loginError').textContent = 'กรุณากรอกรหัสผ่าน';
    $('passwordInput')?.focus();
    return;
  }
  if (password.length < 8) {
    $('loginError').textContent = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
    $('passwordInput')?.focus();
    return;
  }
  if (password.length > 128) {
    $('loginError').textContent = 'รหัสผ่านต้องไม่เกิน 128 ตัวอักษร';
    $('passwordInput')?.focus();
    return;
  }

  button.disabled = true;
  const actionLabel = authMode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
  button.textContent = `กำลัง${actionLabel}…`;
  try {
    const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
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
