/**
 * Account management UI: dedicated Account & Security Settings tab with membership badge,
 * optional email saver, password rotation modal, and permanent account deletion modal.
 */

import { api, toast } from './api.js';
import { openStoreModal } from './billing_ui.js';
import { t } from './i18n.js';
import { closeModal, openModal } from './modals.js';
import { $, escapeHtml, state } from './state.js';

let settingsLogoutCb = null;

/** Returns a compact plan badge HTML snippet for chat authors, member rows, and profiles. */
export function planBadgeHtml(plan) {
  if (plan === 'pro') return '<span class="plan-pill pro">PRO</span>';
  if (plan === 'plus') return '<span class="plan-pill plus">PLUS</span>';
  return '';
}

function planLabelText(plan) {
  if (plan === 'pro') return t('account.planPro');
  if (plan === 'plus') return t('account.planPlus');
  return t('account.planFree');
}

function fmtDate(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString(); } catch { return ''; }
}

/** Renders the dedicated Account & Security Settings pane (`#settingsPaneAccount`). */
export function syncAccountSettingsSection(onLogout) {
  if (onLogout) settingsLogoutCb = onLogout;
  const pane = $('settingsPaneAccount');
  if (!pane) return;

  const acc = state.account || { plan: state.me?.plan || 'free', max_upload_bytes: 5 * 1024 * 1024, max_stickers: 24, email: '' };
  const activePlan = acc.plan || 'free';
  const mb = Math.round((acc.max_upload_bytes || 5 * 1024 * 1024) / (1024 * 1024));
  const stickers = acc.max_stickers || 24;
  const expText = acc.plan_expires_at && activePlan !== 'free'
    ? t('account.planActiveUntil', { date: fmtDate(acc.plan_expires_at) })
    : '';
  pane.innerHTML = `
    <div id="accountSecuritySection" class="account-sec-box" style="margin-top:0">
      <div class="account-sec-head">
        <span>${escapeHtml(t('account.sectionTitle'))}</span>
        ${planBadgeHtml(activePlan)}
      </div>
      <div class="account-plan-card">
        <div class="account-plan-meta">
          <b>${escapeHtml(planLabelText(activePlan))}</b>
          <span>${escapeHtml(t('account.planQuotaHint', { mb, stickers }))}${expText ? ` · ${escapeHtml(expText)}` : ''}</span>
        </div>
        <button type="button" class="btn-primary-sm" data-account-action="open-store">${escapeHtml(t('account.managePlanBtn'))}</button>
      </div>
      <label for="settingsEmail">${escapeHtml(t('account.emailLabel'))}</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="settingsEmail" type="email" maxlength="120" placeholder="${escapeHtml(t('account.emailPh'))}" value="${escapeHtml(acc.email || '')}" style="flex:1" />
        <button type="button" class="btn-secondary-sm" data-account-action="save-email">${escapeHtml(t('account.saveEmailBtn'))}</button>
      </div>
      <div class="account-sec-actions">
        <button type="button" class="btn-secondary-sm" data-account-action="change-password">${escapeHtml(t('account.changePwBtn'))}</button>
        <button type="button" class="btn-danger-sm" data-account-action="delete-account">${escapeHtml(t('account.deleteBtn'))}</button>
        <button type="button" class="btn-secondary-sm" data-account-action="logout" style="margin-inline-start:auto">${escapeHtml(t('settings.logoutBtn'))}</button>
      </div>
    </div>`;

  if (!pane.dataset.bound) {
    pane.dataset.bound = '1';
    pane.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-account-action]');
      if (!btn) return;
      const act = btn.dataset.accountAction;
      if (act === 'open-store') openStoreModal();
      else if (act === 'change-password') openChangePasswordModal();
      else if (act === 'delete-account') openDeleteAccountModal(settingsLogoutCb);
      else if (act === 'logout' && typeof settingsLogoutCb === 'function') settingsLogoutCb(false);
      else if (act === 'save-email') {
        btn.disabled = true;
        $('settingsError').textContent = '';
        try {
          const email = $('settingsEmail')?.value.trim() || '';
          const res = await api('/users/@me', { method: 'PATCH', body: JSON.stringify({ email }) });
          if (res?.account) state.account = res.account;
          toast(t('account.emailSavedToast'), 'ok');
        } catch (err) {
          $('settingsError').textContent = err.message || t('settings.saveProfileErr');
        } finally { btn.disabled = false; }
      }
    });
  }
}

/** Opens the modal for changing the current account password and rotating the session token. */
export function openChangePasswordModal() {
  openModal({
    title: t('account.pwTitle'),
    desc: t('account.pwDesc'),
    submitText: t('account.pwSaveBtn'),
    html: `
      <label for="pwCurrentInput">${escapeHtml(t('account.pwCurrentLabel'))}</label>
      <input id="pwCurrentInput" type="password" autocomplete="current-password" required />
      <label for="pwNewInput">${escapeHtml(t('account.pwNewLabel'))}</label>
      <input id="pwNewInput" type="password" minlength="6" maxlength="128" autocomplete="new-password" required />
      <label for="pwConfirmInput">${escapeHtml(t('account.pwConfirmLabel'))}</label>
      <input id="pwConfirmInput" type="password" minlength="6" maxlength="128" autocomplete="new-password" required />`,
    onSubmit: async () => {
      const currentPassword = $('pwCurrentInput')?.value || '';
      const newPassword = $('pwNewInput')?.value || '';
      const confirmPassword = $('pwConfirmInput')?.value || '';
      if (newPassword.length < 6) {
        $('modalError').textContent = t('account.pwTooShort');
        return;
      }
      if (newPassword !== confirmPassword) {
        $('modalError').textContent = t('account.pwMismatch');
        return;
      }
      const res = await api('/users/@me/password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (res?.token) {
        state.token = res.token;
        localStorage.setItem('ob_token', res.token);
      }
      if (res?.account) state.account = res.account;
      closeModal();
      toast(t('account.pwSavedToast'), 'ok');
    },
  });
}

/** Opens permanent account deletion confirmation modal with password verification. */
export function openDeleteAccountModal(onLogout) {
  openModal({
    title: t('account.delTitle'),
    desc: t('account.delDesc'),
    submitText: t('account.delConfirmBtn'),
    html: `
      <label for="delPwInput">${escapeHtml(t('account.delPasswordLabel'))}</label>
      <input id="delPwInput" type="password" autocomplete="current-password" required />`,
    onSubmit: async () => {
      const password = $('delPwInput')?.value || '';
      await api('/users/@me/delete', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      closeModal();
      $('settingsBackdrop').hidden = true;
      toast(t('account.delDoneToast'), 'ok');
      if (typeof onLogout === 'function') onLogout(false);
    },
  });
}
