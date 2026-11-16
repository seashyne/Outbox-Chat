/**
 * WebSocket Connection Helper for Outbox Chat E2E Tests
 * Uses native global `WebSocket` supported in Node.js.
 */

import { TARGET_URL } from './client.js';

export class WsHelper {
  constructor(ws, url) {
    this.ws = ws;
    this.url = url;
    this.events = [];
    this.isOpen = false;
    this.isClosed = false;
    this._listeners = new Set();

    this.ws.addEventListener('message', (event) => {
      let data = event.data;
      if (typeof data !== 'string') {
        data = data.toString();
      }
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = { raw: data };
      }
      this.events.push(parsed);

      for (const listener of this._listeners) {
        try {
          if (listener.predicate(parsed)) {
            listener.resolve(parsed);
            this._listeners.delete(listener);
          }
        } catch (err) {
          listener.reject(err);
          this._listeners.delete(listener);
        }
      }
    });

    this.ws.addEventListener('close', () => {
      this.isOpen = false;
      this.isClosed = true;
    });

    this.ws.addEventListener('error', (err) => {
      for (const listener of this._listeners) {
        listener.reject(new Error(`WebSocket error: ${err.message || 'unknown'}`));
      }
      this._listeners.clear();
    });
  }

  /**
   * Waits for a message that satisfies the predicate.
   * @param {function(object): boolean} predicate
   * @param {number} [timeoutMs]
   * @returns {Promise<object>}
   */
  async waitForMessage(predicate, timeoutMs = 5000) {
    // Check if an existing message in history already satisfies predicate
    const existing = this.events.find(predicate);
    if (existing) {
      return existing;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._listeners.delete(entry);
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for WebSocket message`));
      }, timeoutMs);

      const entry = {
        predicate,
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };

      this._listeners.add(entry);
    });
  }

  /**
   * Sends a JSON payload.
   * @param {object} payload
   */
  send(payload) {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.ws.send(raw);
  }

  /**
   * Sends a ping message.
   */
  ping() {
    this.send({ type: 'ping' });
  }

  /**
   * Closes the connection.
   */
  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }

  /**
   * Waits for the connection to close.
   * @param {number} [timeoutMs]
   * @returns {Promise<void>}
   */
  async waitForClose(timeoutMs = 5000) {
    if (this.isClosed) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for WebSocket close`));
      }, timeoutMs);

      this.ws.addEventListener('close', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}

/**
 * Connects to the Outbox Chat WebSocket gateway.
 * @param {string} token
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<WsHelper>}
 */
export async function connectWs(token, options = {}) {
  const baseUrl = (options.baseUrl || TARGET_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || 5000;

  const wsUrlStr = baseUrl
    .replace(/^http:\/\//i, 'ws://')
    .replace(/^https:\/\//i, 'wss://')
    + `/api/ws?token=${encodeURIComponent(token || '')}`;

  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(wsUrlStr);
    } catch (err) {
      return reject(err);
    }

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error(`WebSocket connection timeout (${timeoutMs}ms) to ${wsUrlStr}`));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      const helper = new WsHelper(ws, wsUrlStr);
      helper.isOpen = true;
      resolve(helper);
    }, { once: true });

    ws.addEventListener('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket connection failed: ${err.message || 'error'}`));
    }, { once: true });
  });
}
