/**
 * Cloudflare Worker entry point for Outbox Chat.
 * Separates Frontend (`outbox.lenout.com`) from Backend API/WS (`api-outbox.lenout.com`)
 * while preserving combined routing for `localhost` dev and `workers.dev` previews.
 */

import { OutboxHub } from "./hub.js";
import { CORS_HEADERS, jsonResponse } from "./utils.js";

export { OutboxHub };

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const overrideHost = request.headers.get("x-outbox-host");
    const host = (overrideHost || url.hostname).split(":")[0].toLowerCase();
    const isEdge = request.headers.has("cf-ray") || Boolean(overrideHost);
    const isApiCall = url.pathname.startsWith("/api/") || url.pathname === "/api";
    const isApiHost = host === "api-outbox.lenout.com" || host.startsWith("api-");
    const isStrictWebHost = isEdge && host === "outbox.lenout.com";

    if (isApiHost) {
      if (isApiCall) {
        const stub = env.OUTBOX_HUB.get(env.OUTBOX_HUB.idFromName("global"));
        return stub.fetch(request);
      }
      return jsonResponse({
        status: "ok",
        role: "api",
        service: "outbox-chat-api",
        frontend: "https://outbox.lenout.com",
      });
    }

    if (isStrictWebHost) {
      if (isApiCall) {
        return jsonResponse(
          { error: "API endpoints are served on https://api-outbox.lenout.com", status: 404 },
          404
        );
      }
      return env.ASSETS.fetch(request);
    }

    if (isApiCall) {
      const stub = env.OUTBOX_HUB.get(env.OUTBOX_HUB.idFromName("global"));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
