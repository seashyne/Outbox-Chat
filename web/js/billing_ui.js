/**
 * Membership storefront UI: plan catalog, Card/PromptPay checkout,
 * sandbox test completion prompt, order history, and checkout URL return sync.
 */

import { api, handleError, toast } from './api.js';
import { t } from './i18n.js';
import { closeModal, openModal } from './modals.js';
import { renderMembers, renderUserPanel } from './render_shell.js';
import { renderMessages } from './render_chat.js';
import { $, escapeHtml, state } from './state.js';

let selectedMethod = 'card';

function syncAccountState(res) {
  if (res?.account) state.account = res.account;
  if (res?.user) {
    state.me = res.user;
    for (const s of state.servers) {
      const idx = s.members.findIndex((m) => m.id === state.me.id);
      if (idx !== -1) s.members[idx] = { ...s.members[idx], ...state.me };
    }
    for (const m of state.messages) {
      if (m.author?.id === state.me.id) m.author = { ...m.author, ...state.me };
    }
  }
  renderUserPanel();
  renderMembers();
  renderMessages();
}

function planDisplayName(planId) {
  if (planId === 'pro') return t('account.planPro');
  if (planId === 'plus') return t('account.planPlus');
  return t('account.planFree');
}

function fmtOrderDate(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
}

function renderStoreBody(catalog, orders) {
  const activePlan = catalog.account?.plan || state.account?.plan || state.me?.plan || 'free';
  const modeNotice = catalog.stripe_configured ? t('billing.modeLive') : t('billing.modeSandbox');
  const cards = (catalog.plans || []).map((p) => {
    const isCurrent = p.tier === activePlan;
    const priceLine = p.price_thb === 0
      ? `<div class="plan-price">${escapeHtml(t('billing.freePrice'))}</div>`
      : `<div class="plan-price"><strong>${p.price_thb}</strong> <span>${escapeHtml(t('billing.per30Days'))}</span></div>`;
    const btnHtml = p.tier === 'free'
      ? `<button type="button" class="btn-secondary-sm" disabled>${escapeHtml(isCurrent ? t('billing.activeNow') : planDisplayName('free'))}</button>`
      : `<button type="button" class="btn-primary-sm" data-buy-plan="${escapeHtml(p.id)}" ${isCurrent ? '' : ''}>${escapeHtml(isCurrent ? `${t('billing.activeNow')} (+30)` : t(p.tier === 'pro' ? 'billing.buyPro' : 'billing.buyPlus'))}</button>`;
    return `
      <div class="plan-card ${isCurrent ? 'active' : ''}">
        <div class="plan-card-head">
          <b>${escapeHtml(p.name)}</b>
          ${isCurrent ? `<span class="plan-pill ${escapeHtml(p.tier)}">${escapeHtml(t('billing.currentBadge'))}</span>` : ''}
        </div>
        ${priceLine}
        <ul class="plan-perks">
          <li>${escapeHtml(t('billing.uploadCap', { mb: p.max_upload_mb }))}</li>
          <li>${escapeHtml(t('billing.stickerCap', { count: p.max_stickers }))}</li>
          <li>${escapeHtml(p.hd_screen ? t('billing.hdScreen') : t('billing.basicScreen'))}</li>
          ${p.tier !== 'free' ? `<li>${escapeHtml(t('billing.badgePerk'))}</li>` : ''}
        </ul>
        <div class="plan-card-foot">${btnHtml}</div>
      </div>`;
  }).join('');

  const orderRows = orders.length
    ? orders.slice(0, 6).map((o) => `
      <div class="order-row">
        <div>
          <b>${escapeHtml(planDisplayName(o.tier || o.plan))}</b>
          <span>${Math.round((o.amount_satang || 0) / 100)} THB • ${escapeHtml(o.provider === 'sandbox' ? 'Demo' : 'Stripe')}</span>
        </div>
        <div class="order-right">
          <span class="order-status ${o.status === 'paid' ? 'paid' : 'pending'}">${escapeHtml(o.status === 'paid' ? t('billing.orderPaid') : t('billing.orderPending'))}</span>
          <span>${escapeHtml(fmtOrderDate(o.created_at))}</span>
        </div>
      </div>`).join('')
    : `<div class="store-empty">${escapeHtml(t('billing.ordersEmpty'))}</div>`;

  return `
    <div id="storeRoot">
      <div class="store-mode-banner ${catalog.stripe_configured ? 'live' : 'sandbox'}">${escapeHtml(modeNotice)}</div>
      <div class="store-method-row">
        <span>${escapeHtml(t('billing.payMethodLabel'))}</span>
        <div class="store-method-pills">
          <button type="button" class="method-pill ${selectedMethod === 'card' ? 'active' : ''}" data-pay-method="card">${escapeHtml(t('billing.payCard'))}</button>
          <button type="button" class="method-pill ${selectedMethod === 'promptpay' ? 'active' : ''}" data-pay-method="promptpay">${escapeHtml(t('billing.payPromptpay'))}</button>
        </div>
      </div>
      <div class="store-grid">${cards}</div>
      <div class="store-orders-head">${escapeHtml(t('billing.ordersTitle'))}</div>
      <div class="store-orders-list">${orderRows}</div>
    </div>`;
}

function openSandboxPrompt(order, planId) {
  const thb = Math.round((order.amount_satang || 0) / 100);
  openModal({
    title: t('billing.sandboxPromptTitle'),
    desc: t('billing.sandboxPromptDesc', { price: thb, plan: planDisplayName(planId) }),
    submitText: t('billing.sandboxPayBtn'),
    html: `<div class="store-mode-banner sandbox">${escapeHtml(t('billing.modeSandbox'))}</div>`,
    onSubmit: async () => {
      const done = await api('/billing/sandbox-complete', {
        method: 'POST',
        body: JSON.stringify({ order_id: order.id }),
      });
      syncAccountState(done);
      closeModal();
      toast(t('billing.upgradedToast', { plan: planDisplayName(planId) }), 'ok');
      await openStoreModal();
    },
  });
}

/** Opens the Outbox Membership Storefront modal with live plans and order history. */
export async function openStoreModal() {
  if (!$('settingsBackdrop').hidden) $('settingsBackdrop').hidden = true;
  const [catalog, orders] = await Promise.all([api('/billing/plans'), api('/billing/orders')]);
  if (catalog?.account) state.account = catalog.account;

  openModal({
    title: t('billing.title'),
    desc: t('billing.subtitle'),
    hideSubmit: true,
    wide: true,
    html: renderStoreBody(catalog, orders || []),
  });

  const root = $('storeRoot');
  if (!root) return;
  root.addEventListener('click', async (e) => {
    const methodBtn = e.target.closest('[data-pay-method]');
    if (methodBtn) {
      selectedMethod = methodBtn.dataset.payMethod || 'card';
      root.querySelectorAll('[data-pay-method]').forEach((el) => {
        el.classList.toggle('active', el.dataset.payMethod === selectedMethod);
      });
      return;
    }
    const buyBtn = e.target.closest('[data-buy-plan]');
    if (!buyBtn) return;
    const planId = buyBtn.dataset.buyPlan;
    buyBtn.disabled = true;
    try {
      const checkout = await api('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          plan_id: planId,
          payment_method: selectedMethod,
          return_origin: window.location.origin,
        }),
      });
      if (checkout?.mode === 'stripe' && checkout?.checkout_url) {
        window.location.assign(checkout.checkout_url);
        return;
      }
      if (checkout?.order) openSandboxPrompt(checkout.order, planId);
    } catch (err) {
      handleError(err);
    } finally {
      buyBtn.disabled = false;
    }
  });
}

/** Syncs membership state when returning from external Stripe Checkout redirect URLs. */
export async function handleCheckoutReturnFromUrl() {
  if (!state.token) return;
  const url = new URL(window.location.href);
  const status = url.searchParams.get('checkout');
  const orderId = url.searchParams.get('order_id');
  if (!status && !orderId) return;
  url.searchParams.delete('checkout');
  url.searchParams.delete('order_id');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  if (status === 'success' && orderId) {
    try {
      const synced = await api(`/billing/orders/${encodeURIComponent(orderId)}/sync`);
      syncAccountState(synced);
      if (synced?.order?.status === 'paid') {
        toast(t('billing.upgradedToast', { plan: planDisplayName(synced.order.tier || synced.order.plan) }), 'ok');
      }
    } catch (err) {
      handleError(err);
    }
  }
}
