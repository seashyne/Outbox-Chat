/**
 * Runtime endpoint resolution separating Frontend (`outbox.lenout.com`)
 * from Backend API/WebSocket (`api-outbox.lenout.com`), while keeping
 * same-origin routing for local dev (`localhost`/`127.0.0.1`) and previews.
 */

const DOMAIN_API_MAP = {
  'outbox.lenout.com': 'https://api-outbox.lenout.com',
};

/** Resolves the active Backend API origin for REST and WebSocket calls. */
export function resolveApiOrigin() {
  const meta = document.querySelector('meta[name="outbox-api-origin"]')?.content?.trim();
  if (meta) return meta.replace(/\/+$/, '');
  return DOMAIN_API_MAP[location.hostname] || location.origin;
}

export const API_ORIGIN = resolveApiOrigin();

/** Builds a full REST endpoint URL targeting the resolved Backend API origin. */
export const apiUrl = (path) => `${API_ORIGIN}/api${path}`;

/** Builds a WebSocket gateway URL targeting the resolved Backend API origin. */
export const wsUrl = (token) =>
  `${API_ORIGIN.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`;
