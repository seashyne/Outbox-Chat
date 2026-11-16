/**
 * Opaque-Box E2E REST Client Helper for Outbox Chat
 * Uses Node.js native fetch and built-in standard modules.
 */

export const TARGET_URL = (process.env.TARGET_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');

/**
 * Checks whether the target backend server is reachable and responding.
 * @param {string} [baseUrl]
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function isServerOnline(baseUrl = TARGET_URL, timeoutMs = 1500) {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Helper to gracefully skip a test if the server is offline.
 * @param {object} t - Node test context
 * @param {boolean} serverOnline
 * @returns {boolean} true if skipped
 */
export function checkSkip(t, serverOnline) {
  if (!serverOnline) {
    t.skip(`Target backend at ${TARGET_URL} is offline`);
    return true;
  }
  return false;
}

/**
 * Generates a valid unique username <= 32 characters.
 * @param {string} [prefix]
 * @returns {string}
 */
export function randomUsername(prefix = 'user') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${ts}_${rand}`.slice(0, 32);
}

/**
 * Generates a random valid password.
 * @param {number} [length]
 * @returns {string}
 */
export function randomPassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
  let pass = 'P@ss1';
  while (pass.length < length) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass.slice(0, length);
}

/**
 * REST API client wrapper.
 */
export class ApiClient {
  constructor(baseUrl = TARGET_URL, defaultToken = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = defaultToken;
  }

  setToken(token) {
    this.token = token;
  }

  async request(method, path, options = {}) {
    const { body, token, headers = {}, query } = options;
    const effectiveToken = token !== undefined ? token : this.token;

    let urlStr = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    if (query && typeof query === 'object') {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          sp.append(k, String(v));
        }
      }
      const qs = sp.toString();
      if (qs) {
        urlStr += (urlStr.includes('?') ? '&' : '?') + qs;
      }
    }

    const reqHeaders = { ...headers };
    if (effectiveToken) {
      reqHeaders['Authorization'] = `Bearer ${effectiveToken}`;
    }

    let reqBody = undefined;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        reqBody = body;
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
      } else {
        reqBody = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
      }
    }

    const res = await fetch(urlStr, {
      method,
      headers: reqHeaders,
      body: reqBody,
    });

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      data,
      text,
    };
  }

  // Health
  async health() {
    return this.request('GET', '/api/health');
  }

  // Registration
  async register(usernameOrPayload, password) {
    const body = typeof usernameOrPayload === 'object'
      ? usernameOrPayload
      : { username: usernameOrPayload, password };
    return this.request('POST', '/api/register', { body });
  }

  // Login
  async login(usernameOrPayload, password) {
    const body = typeof usernameOrPayload === 'object'
      ? usernameOrPayload
      : { username: usernameOrPayload, password };
    return this.request('POST', '/api/login', { body });
  }

  // Bootstrap
  async bootstrap(token) {
    return this.request('GET', '/api/bootstrap', { token });
  }

  // Servers
  async getServers(token) {
    return this.request('GET', '/api/servers', { token });
  }

  async createServer(payload, token) {
    const body = typeof payload === 'string' ? { name: payload } : payload;
    return this.request('POST', '/api/servers', { body, token });
  }

  async joinServer(serverId, token) {
    return this.request('POST', `/api/servers/${encodeURIComponent(serverId)}/join`, { token });
  }

  // Channels
  async createChannel(serverId, payload, token) {
    return this.request('POST', `/api/servers/${encodeURIComponent(serverId)}/channels`, {
      body: payload,
      token,
    });
  }

  // Messages
  async getMessages(channelId, query = {}, token) {
    return this.request('GET', `/api/channels/${encodeURIComponent(channelId)}/messages`, {
      query,
      token,
    });
  }

  async postMessage(channelId, payload, token) {
    const body = typeof payload === 'string' ? { content: payload } : payload;
    return this.request('POST', `/api/channels/${encodeURIComponent(channelId)}/messages`, {
      body,
      token,
    });
  }

  async deleteMessage(messageId, token) {
    return this.request('DELETE', `/api/messages/${encodeURIComponent(messageId)}`, { token });
  }

  // Reactions
  async toggleReaction(messageId, emojiOrToken, token) {
    const body = typeof emojiOrToken === 'string' ? { emoji: emojiOrToken } : emojiOrToken;
    return this.request('POST', `/api/messages/${encodeURIComponent(messageId)}/reactions`, {
      body,
      token,
    });
  }

  // Voice
  async joinVoice(channelId, token) {
    return this.request('POST', `/api/channels/${encodeURIComponent(channelId)}/voice/join`, { token });
  }

  async leaveVoice(channelId, token) {
    return this.request('POST', `/api/channels/${encodeURIComponent(channelId)}/voice/leave`, { token });
  }

  // Logout
  async logout(token) {
    return this.request('POST', '/api/logout', { token });
  }

  // Settings
  async getSettings(token) {
    return this.request('GET', '/api/users/@me/settings', { token });
  }

  async patchSettings(settingsPayload, token) {
    return this.request('PATCH', '/api/users/@me/settings', {
      body: settingsPayload,
      token,
    });
  }

  // Profile
  async patchMe(profilePayload, token) {
    return this.request('PATCH', '/api/users/@me', {
      body: profilePayload,
      token,
    });
  }

  async patchProfile(profilePayload, token) {
    return this.patchMe(profilePayload, token);
  }

  // Channels (Deletion)
  async deleteChannel(channelId, token) {
    return this.request('DELETE', `/api/channels/${encodeURIComponent(channelId)}`, { token });
  }

  // Servers (Leave)
  async leaveServer(serverId, token) {
    return this.request('POST', `/api/servers/${encodeURIComponent(serverId)}/leave`, { token });
  }
}
