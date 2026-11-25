/**
 * Non-blocking right-side Outbox Inspector Panel controller (Threads, Media Vault, Pins, Search)
 * and mobile bottom navigation / responsive drawer wiring.
 */

import { t } from './i18n.js';
import { $, ICONS, escapeHtml, state } from './state.js';

let activeOnClose = null;
let lastTriggerEl = null;

/** Returns true when the right-side Inspector panel is currently open. */
export function isInspectorOpen() {
  const panel = $('inspectorPanel');
  return Boolean(panel && !panel.hidden);
}

/** Closes the right-side Inspector panel and restores keyboard focus cleanly. */
export function closeInspector(restoreFocus = true) {
  const panel = $('inspectorPanel');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  panel.innerHTML = '';
  const cb = activeOnClose;
  activeOnClose = null;
  if (typeof cb === 'function') cb();
  if (restoreFocus && lastTriggerEl?.isConnected) lastTriggerEl.focus();
  lastTriggerEl = null;
}

/** Opens the non-blocking right-side Inspector panel alongside the main chat stream. */
export function openInspector({ title, subtitle = '', html = '', onClose = null }) {
  const panel = $('inspectorPanel');
  if (!panel) return null;
  if (activeOnClose) {
    const prev = activeOnClose;
    activeOnClose = null;
    try { prev(); } catch {}
  }
  if (!lastTriggerEl && document.activeElement instanceof HTMLElement) {
    lastTriggerEl = document.activeElement;
  }
  activeOnClose = onClose;
  panel.innerHTML = `
    <div class="inspector-head">
      <div class="inspector-titles">
        <h3>${escapeHtml(title)}</h3>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <button type="button" class="icon-btn" id="inspectorCloseBtn" title="${escapeHtml(t('settings.closeTitle'))}" aria-label="${escapeHtml(t('settings.closeAria'))}">${ICONS.close}</button>
    </div>
    <div class="inspector-body" id="inspectorBody">${html}</div>`;
  panel.hidden = false;
  $('inspectorCloseBtn')?.addEventListener('click', () => closeInspector(true));
  const focusTarget = panel.querySelector('input, button, textarea');
  if (focusTarget) setTimeout(() => focusTarget.focus(), 20);
  return $('inspectorBody');
}

/** Renders the thumb-zone mobile bottom navigation bar (`<= 680px`). */
export function renderMobileNav() {
  const nav = $('mobileNav');
  if (!nav) return;
  const sidebarOpen = $('sidebar')?.classList.contains('mobile-open');
  const membersOpen = $('memberList')?.classList.contains('mobile-open');
  nav.innerHTML = `
    <button type="button" class="mobile-nav-btn ${state.homeMode && !sidebarOpen ? 'active' : ''}" data-mnav="inbox">${ICONS.outboxLogo}<span>${escapeHtml(t('nav.inbox'))}</span></button>
    <button type="button" class="mobile-nav-btn ${sidebarOpen ? 'active' : ''}" data-mnav="spaces">${ICONS.menu}<span>${escapeHtml(t('nav.spaces'))}</span></button>
    <button type="button" class="mobile-nav-btn ${membersOpen ? 'active' : ''}" data-mnav="members">${ICONS.members}<span>${escapeHtml(t('nav.members'))}</span></button>
    <button type="button" class="mobile-nav-btn" data-mnav="store">${ICONS.store}<span>${escapeHtml(t('nav.store'))}</span></button>
    <button type="button" class="mobile-nav-btn" data-mnav="settings">${ICONS.settings}<span>${escapeHtml(t('nav.settings'))}</span></button>`;
}

/** Toggles members panel cleanly on both desktop and narrow/mobile screens. */
export function toggleMembersPanel(renderHeader) {
  const el = $('memberList');
  if (!el) return;
  if (window.innerWidth <= 1100) {
    const open = !el.classList.contains('mobile-open');
    el.classList.toggle('mobile-open', open);
    el.hidden = !open;
    renderMobileNav();
    return;
  }
  state.membersVisible = !state.membersVisible;
  el.hidden = !state.membersVisible || state.homeMode;
  renderHeader?.();
}

/** Wires mobile bottom navigation and Unified Home Hub quick actions. */
export function bindStudioShellNav({ selectFriendsHome, selectServer, openCreateServer, openDirectory, openStoreModal, openSettingsModal, setMobileSidebar, renderHeader }) {
  $('mobileNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mnav]');
    if (!btn) return;
    const act = btn.dataset.mnav;
    $('memberList')?.classList.remove('mobile-open');
    if (act === 'inbox') { setMobileSidebar(false); selectFriendsHome(); }
    else if (act === 'spaces') setMobileSidebar(!$('sidebar')?.classList.contains('mobile-open'));
    else if (act === 'members') { setMobileSidebar(false); toggleMembersPanel(renderHeader); }
    else if (act === 'store') { setMobileSidebar(false); openStoreModal(); }
    else if (act === 'settings') { setMobileSidebar(false); openSettingsModal('profile'); }
    renderMobileNav();
  });
  $('friendsStage')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-home-action]');
    if (!btn) return;
    const act = btn.dataset.homeAction;
    if (act === 'server' && btn.dataset.id) selectServer(btn.dataset.id);
    else if (act === 'create-space') openCreateServer();
    else if (act === 'explore') openDirectory();
    else if (act === 'store') openStoreModal();
  });
}
