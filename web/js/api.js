/**
 * HTTP API client wrapper, toast notification queue, and connection status helper.
 */

import { apiUrl } from './config.js';
import { t, translateApiError } from './i18n.js';
import { $, state } from './state.js';

let onUnauthorizedHandler = () => {};

/** Registers the logout callback invoked on HTTP 401 session expiration. */
export function setUnauthorizedHandler(fn) {
  onUnauthorizedHandler = fn;
}

/** Shows a transient toast notification in the bottom-right stack. */
export function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  $('toastStack').appendChild(node);
  setTimeout(() => node.remove(), 3800);
}

/** Handles API errors, forcing logout on 401 or surfacing a toast message. */
export function handleError(error) {
  if (error?.unauthorized) {
    onUnauthorizedHandler(true);
    return;
  }
  toast(error?.message || t('error.generic'), 'err');
}

/** Updates the connection indicator label in the composer footer. */
export function setConn(status, label) {
  const el = $('connStatus');
  el.className = `conn-status ${status}`;
  el.textContent = label;
}

/** Performs an authenticated JSON request against `/api/*`. */
export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(apiUrl(path), { ...options, headers });
  if (response.status === 401) {
    const error = new Error('session expired');
    error.unauthorized = true;
    throw error;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ? translateApiError(payload.error) : t('error.requestFailed'));
  }
  return response.status === 204 ? null : response.json();
}
