/**
 * Cloudflare Worker entry point for Outbox Chat.
 * Routes `/api/*` requests to the global `OutboxHub` Durable Object
 * and serves static frontend assets via Cloudflare Workers Assets.
 */

import { OutboxHub } from "./hub.js";
import { CORS_HEADERS } from "./utils.js";

export { OutboxHub };

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      const stub = env.OUTBOX_HUB.get(env.OUTBOX_HUB.idFromName("global"));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
