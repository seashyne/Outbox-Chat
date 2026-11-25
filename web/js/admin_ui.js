/**
 * Platform Admin Console UI: system KPI overview, user plan/suspension control,
 * and global commerce order log for platform administrators.
 */

import { api, handleError, toast } from './api.js';
import { planBadgeHtml } from './account_ui.js';
import { t } from './i18n.js';
import { openModal } from './modals.js';
import { $, escapeHtml, state } from './state.js';

let activeTab = 'overview';
let cachedUsers = [];

function renderOverviewTab(ov) {
  const thb = Math.round((ov.total_revenue_satang || 0) / 100);
  const modeText = ov.stripe_configured ? t('billing.modeLive') : t('billing.modeSandbox');
  const card = (label, value) => `
    <div class="admin-stat-card">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(String(value))}</b>
    </div>`;
  return `
    <div class="store-mode-banner ${ov.stripe_configured ? 'live' : 'sandbox'}">${escapeHtml(modeText)}</div>
    <div class="admin-stats-grid">
      ${card(t('admin.statUsers'), ov.users_total ?? 0)}
      ${card(t('admin.statPaidUsers'), ov.active_paid_users ?? 0)}
      ${card(t('admin.statRevenue'), thb.toLocaleString())}
      ${card(t('admin.statServers'), ov.servers_total ?? 0)}
      ${card(t('admin.statMessages'), ov.messages_total ?? 0)}
      ${card(t('admin.statSuspended'), ov.suspended_users ?? 0)}
    </div>`;
}

function renderUsersRows(users, query = '') {
  const q = query.trim().toLowerCase();
  const list = users.filter((u) => !q
    || (u.username || '').toLowerCase().includes(q)
    || (u.display_name || '').toLowerCase().includes(q)
    || (u.email || '').toLowerCase().includes(q));
  return list.map((u) => {
    const isSelf = state.me?.id === u.id;
    return `
      <div class="admin-user-row" data-uid="${escapeHtml(u.id)}">
        <div class="admin-user-info">
          <div class="admin-user-title">
            <b>${escapeHtml(u.display_name)}</b>
            ${planBadgeHtml(u.plan)}
            ${u.platform_admin ? `<span class="admin-role-tag">${escapeHtml(t('admin.badgeAdmin'))}</span>` : ''}
          </div>
          <span>@${escapeHtml(u.username)}${u.email ? ` • ${escapeHtml(u.email)}` : ''}${u.bot ? ' • BOT' : ''}</span>
        </div>
        <div class="admin-user-controls">
          <select class="admin-plan-select" aria-label="${escapeHtml(t('admin.colPlan'))}">
            <option value="free" ${u.plan === 'free' ? 'selected' : ''}>Free</option>
            <option value="plus" ${u.plan === 'plus' ? 'selected' : ''}>Plus</option>
            <option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>Pro</option>
          </select>
          <input class="admin-days-input" type="number" min="1" max="3650" value="30" aria-label="${escapeHtml(t('admin.colDays'))}" />
          <button type="button" class="btn-secondary-sm" data-admin-action="set-plan">${escapeHtml(t('admin.applyPlanBtn'))}</button>
          ${!isSelf ? `<button type="button" class="${u.suspended ? 'btn-secondary-sm' : 'btn-danger-sm'}" data-admin-action="toggle-suspend">${escapeHtml(u.suspended ? t('admin.unsuspendBtn') : t('admin.suspendBtn'))}</button>` : ''}
          ${!isSelf && !u.bot ? `<button type="button" class="btn-secondary-sm" data-admin-action="toggle-admin">${escapeHtml(u.platform_admin ? t('admin.removeAdminBtn') : t('admin.makeAdminBtn'))}</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function renderOrdersTab(orders) {
  if (!orders.length) return `<div class="store-empty">${escapeHtml(t('admin.ordersEmpty'))}</div>`;
  return orders.slice(0, 40).map((o) => `
    <div class="order-row">
      <div>
        <b>@${escapeHtml(o.username || 'user')} — ${escapeHtml((o.tier || o.plan || '').toUpperCase())}</b>
        <span>${Math.round((o.amount_satang || 0) / 100)} THB • ${escapeHtml(o.provider || '-')}</span>
      </div>
      <div class="order-right">
        <span class="order-status ${o.status === 'paid' ? 'paid' : 'pending'}">${escapeHtml(o.status === 'paid' ? t('billing.orderPaid') : t('billing.orderPending'))}</span>
        <span>${escapeHtml(new Date(o.created_at).toLocaleString())}</span>
      </div>
    </div>`).join('');
}

async function paintAdminConsole() {
  const root = $('adminConsoleRoot');
  if (!root) return;
  root.querySelectorAll('[data-admin-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.adminTab === activeTab);
  });
  const body = $('adminTabBody');
  if (!body) return;
  if (activeTab === 'overview') {
    const ov = await api('/admin/overview');
    body.innerHTML = renderOverviewTab(ov);
  } else if (activeTab === 'users') {
    cachedUsers = await api('/admin/users');
    body.innerHTML = `
      <input id="adminUserSearch" type="search" placeholder="${escapeHtml(t('admin.searchPh'))}" />
      <div id="adminUsersList" class="admin-list">${renderUsersRows(cachedUsers)}</div>`;
    $('adminUserSearch')?.addEventListener('input', (e) => {
      const listEl = $('adminUsersList');
      if (listEl) listEl.innerHTML = renderUsersRows(cachedUsers, e.target.value);
    });
  } else {
    const orders = await api('/admin/orders');
    body.innerHTML = `<div class="admin-list">${renderOrdersTab(orders || [])}</div>`;
  }
}

/** Opens the Platform Admin Console modal for platform administrators. */
export async function openPlatformAdminModal() {
  activeTab = 'overview';
  openModal({
    title: t('admin.title'),
    desc: t('admin.subtitle'),
    hideSubmit: true,
    wide: true,
    html: `
      <div id="adminConsoleRoot">
        <div class="admin-tabs">
          <button type="button" class="method-pill active" data-admin-tab="overview">${escapeHtml(t('admin.tabOverview'))}</button>
          <button type="button" class="method-pill" data-admin-tab="users">${escapeHtml(t('admin.tabUsers'))}</button>
          <button type="button" class="method-pill" data-admin-tab="orders">${escapeHtml(t('admin.tabOrders'))}</button>
        </div>
        <div id="adminTabBody"></div>
      </div>`,
  });
  await paintAdminConsole();

  $('adminConsoleRoot')?.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('[data-admin-tab]');
    if (tabBtn) {
      activeTab = tabBtn.dataset.adminTab;
      await paintAdminConsole().catch(handleError);
      return;
    }
    const actBtn = e.target.closest('[data-admin-action]');
    const row = e.target.closest('[data-uid]');
    if (!actBtn || !row) return;
    const uid = row.dataset.uid;
    const act = actBtn.dataset.adminAction;
    const target = cachedUsers.find((u) => u.id === uid);
    if (!target) return;
    actBtn.disabled = true;
    try {
      const payload = act === 'set-plan'
        ? {
          plan: row.querySelector('.admin-plan-select')?.value || 'free',
          plan_days: Number(row.querySelector('.admin-days-input')?.value || 30),
        }
        : act === 'toggle-suspend'
          ? { suspended: !target.suspended }
          : { platform_admin: !target.platform_admin };
      await api(`/admin/users/${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast(t('admin.updatedUserToast'), 'ok');
      await paintAdminConsole();
    } catch (err) {
      handleError(err);
    } finally {
      actBtn.disabled = false;
    }
  });
}
