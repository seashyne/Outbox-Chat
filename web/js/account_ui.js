/**
 * Account management UI: current membership badge, email field,
 * password rotation modal, and permanent account deletion modal.
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

/** Ensures the Account & Security section exists in Settings and refreshes its values. */
export function syncAccountSettingsSection(isGlobalScope, onLogout) {
  if (onLogout) settingsLogoutCb = onLogout;
  const pane = $('settingsPaneProfile');
  if (!pane) return;
  let box = $('accountSecuritySection');
  if (!box) {
    box = document.createElement('div');
    box.id = 'accountSecuritySection';
    box.className = 'account-sec-box';
    const actionsRow = pane.querySelector('.settings-actions');
    pane.insertBefore(box, actionsRow || null);
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-account-action]');
      if (!btn) return;
      const act = btn.dataset.accountAction;
      if (act === 'open-store') openStoreModal();
      else if (act === 'change-password') openChangePasswordModal();
      else if (act === 'delete-account') openDeleteAccountModal(settingsLogoutCb);
    });
  }
  box.hidden = !isGlobalScope;
  if (!isGlobalScope) return;

  const acc = state.account || { plan: state.me?.plan || 'free', max_upload_bytes: 5 * 1024 * 1024, max_stickers: 24, email: '' };
  const activePlan = acc.plan || 'free';
  const mb = Math.round((acc.max_upload_bytes || 5 * 1024 * 1024) / (1024 * 1024));
  const stickers = acc.max_stickers || 24;
  const expText = acc.plan_expires_at && activePlan !== 'free'
    ? t('account.planActiveUntil', { date: fmtDate(acc.plan_expires_at) })
    : '';
  const prevEmail = $('settingsEmail')?.value;
  box.innerHTML = `
    <div class="account-sec-head">
      <span>${escapeHtml(t('account.sectionTitle'))}</span>
      ${planBadgeHtml(activePlan)}
    </div>
    <div class="account-plan-card">
      <div class="account-plan-meta">
        <b>${escapeHtml(planLabelText(activePlan))}</b>
        <span>${escapeHtml(t('account.planQuotaHint', { mb, stickers }))}${expText ? ` • ${escapeHtml(expText)}` : ''}</span>
      </div>
      <button type="button" class="btn-secondary-sm" data-account-action="open-store">${escapeHtml(t('account.managePlanBtn'))}</button>
    </div>
    <label for="settingsEmail">${escapeHtml(t('account.emailLabel'))}</label>
    <input id="settingsEmail" type="email" maxlength="120" placeholder="${escapeHtml(t('account.emailPh'))}" value="${escapeHtml(prevEmail !== undefined ? prevEmail : (acc.email || ''))}" />
    <div class="account-sec-actions">
      <button type="button" class="btn-secondary-sm" data-account-action="change-password">${escapeHtml(t('account.changePwBtn'))}</button>
      <button type="button" class="btn-danger-sm" data-account-action="delete-account">${escapeHtml(t('account.deleteBtn'))}</button>
    </div>`;
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
