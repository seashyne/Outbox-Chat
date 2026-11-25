/**
 * Subscription catalog, Stripe Checkout integration, HMAC webhook verification,
 * and sandbox completion for OutboxHub Durable Object.
 */

import { constantTimeEqual, hmacSha256Hex } from "./crypto.js";
import { HttpError, accountSummary, cmp, jsonResponse, newId, nowIso, publicUser, readJson } from "./utils.js";

const PLANS = [
  { id: "free", tier: "free", name: "Free", price_thb: 0, amount_satang: 0, interval_days: 0, max_upload_mb: 5, max_stickers: 24, hd_screen: false },
  { id: "plus_monthly", tier: "plus", name: "Outbox Plus", price_thb: 99, amount_satang: 9900, interval_days: 30, max_upload_mb: 15, max_stickers: 24, hd_screen: true },
  { id: "pro_monthly", tier: "pro", name: "Outbox Pro", price_thb: 249, amount_satang: 24900, interval_days: 30, max_upload_mb: 25, max_stickers: 48, hd_screen: true },
];

const stripeSecretKey = (hub) => String(hub.env?.STRIPE_SECRET_KEY || "").trim();

function safeReturnBase(raw) {
  const s = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  if (s === "https://outbox.lenout.com" || s.startsWith("http://localhost:") || s.startsWith("http://127.0.0.1:")) return s;
  return "https://outbox.lenout.com";
}

function activatePaidOrder(hub, orderId) {
  const order = hub.store.orders?.[orderId];
  if (!order) return null;
  if (order.status === "paid") {
    const u = hub.store.users[order.user_id];
    return { order, user: u ? publicUser(u) : null };
  }
  order.status = "paid";
  order.paid_at = nowIso();

  const u = hub.store.users[order.user_id];
  if (u) {
    const existingMs = u.plan_expires_at ? Date.parse(u.plan_expires_at) : NaN;
    const baseMs = Number.isFinite(existingMs) && existingMs > Date.now() && u.plan === order.tier ? existingMs : Date.now();
    u.plan = order.tier;
    u.plan_expires_at = new Date(baseMs + 30 * 86400000).toISOString();
  }
  return { order, user: u ? publicUser(u) : null };
}

/** Lists subscription plans (`GET /api/billing/plans`). */
export function handleListPlans(hub, request) {
  const stripeOk = Boolean(stripeSecretKey(hub));
  const authHeader = request.headers.get("Authorization") || "";
  const tok = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const uid = tok ? hub.store.tokens[tok] : null;
  const u = uid ? hub.store.users[uid] : null;
  return jsonResponse({
    plans: PLANS,
    currency: "thb",
    stripe_configured: stripeOk,
    payment_mode: stripeOk ? "stripe" : "sandbox",
    account: u && !u.suspended ? accountSummary(u) : null,
  });
}

/** Lists authenticated caller's orders (`GET /api/billing/orders`). */
export function handleListMyOrders(hub, request) {
  const user = hub.authenticate(request);
  const list = Object.values(hub.store.orders || {})
    .filter((o) => o.user_id === user.id)
    .sort((a, b) => cmp(b.created_at, a.created_at));
  return jsonResponse(list);
}

/** Creates a live Stripe Checkout session or a sandbox order (`POST /api/billing/checkout`). */
export async function handleCreateCheckout(hub, request) {
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const plan = PLANS.find((p) => p.id === String(body.plan_id || "").trim() && p.amount_satang > 0);
  if (!plan) throw new HttpError(400, "invalid subscription plan");

  const orderId = newId();
  const secret = stripeSecretKey(hub);
  const baseUrl = safeReturnBase(body.return_origin);
  let sessionId = null;
  let checkoutUrl = null;

  if (secret) {
    const pm = body.payment_method === "promptpay" ? "promptpay" : "card";
    const form = new URLSearchParams({
      mode: "payment",
      success_url: `${baseUrl}/?checkout=success&order_id=${orderId}`,
      cancel_url: `${baseUrl}/?checkout=cancel&order_id=${orderId}`,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "thb",
      "line_items[0][price_data][unit_amount]": String(plan.amount_satang),
      "line_items[0][price_data][product_data][name]": `${plan.name} (30 Days)`,
      "metadata[order_id]": orderId,
      "metadata[user_id]": user.id,
      "metadata[plan_id]": plan.id,
      "payment_method_types[0]": pm,
    });
    if (pm !== "promptpay") form.append("payment_method_types[1]", "promptpay");

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.id || !data?.url) {
      throw new HttpError(400, data?.error?.message || "Stripe checkout creation failed");
    }
    sessionId = data.id;
    checkoutUrl = data.url;
  }

  const order = {
    id: orderId,
    user_id: user.id,
    plan_id: plan.id,
    tier: plan.tier,
    amount_satang: plan.amount_satang,
    currency: "thb",
    status: "pending",
    provider: secret ? "stripe" : "sandbox",
    checkout_session_id: sessionId,
    created_at: nowIso(),
    paid_at: null,
  };
  hub.store.orders = hub.store.orders || {};
  hub.store.orders[order.id] = order;
  if (sessionId) {
    hub.store.stripe_session_orders = hub.store.stripe_session_orders || {};
    hub.store.stripe_session_orders[sessionId] = order.id;
  }
  hub.persistStore();
  return jsonResponse({ mode: order.provider, order, checkout_url: checkoutUrl });
}

/** Completes a sandbox checkout order when Stripe keys are not configured. */
export async function handleSandboxComplete(hub, request) {
  if (stripeSecretKey(hub)) throw new HttpError(403, "sandbox checkout is disabled when Stripe is configured");
  const user = hub.authenticate(request);
  const body = await readJson(request);
  const existing = hub.store.orders?.[body.order_id];
  if (!existing) throw new HttpError(404, "order not found");
  if (existing.user_id !== user.id) throw new HttpError(403, "not your order");
  if (existing.provider !== "sandbox") throw new HttpError(400, "order is not a sandbox order");

  const res = activatePaidOrder(hub, existing.id);
  hub.persistStore();
  if (res?.user) hub.emit({ type: "user_update", user: res.user });
  return jsonResponse({ order: res?.order, user: res?.user, account: accountSummary(user) });
}

/** Syncs order payment status directly with Stripe (`GET /api/billing/orders/{id}/sync`). */
export async function handleSyncOrder(hub, request, orderId) {
  const user = hub.authenticate(request);
  const existing = hub.store.orders?.[orderId];
  if (!existing) throw new HttpError(404, "order not found");
  if (existing.user_id !== user.id) throw new HttpError(403, "not your order");

  const secret = stripeSecretKey(hub);
  if (existing.status === "pending" && existing.provider === "stripe" && secret && existing.checkout_session_id) {
    try {
      const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(existing.checkout_session_id)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const sess = await resp.json().catch(() => null);
      if (sess?.payment_status === "paid") {
        const res = activatePaidOrder(hub, orderId);
        hub.persistStore();
        if (res?.user) hub.emit({ type: "user_update", user: res.user });
      }
    } catch {}
  }
  return jsonResponse({ order: hub.store.orders[orderId], user: publicUser(user), account: accountSummary(user) });
}

/** Verifies `Stripe-Signature` HMAC-SHA256 and activates paid checkout orders (`POST /api/billing/webhook`). */
export async function handleStripeWebhook(hub, request) {
  const whSecret = String(hub.env?.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!whSecret) throw new HttpError(403, "webhook secret is not configured");
  const sigHeader = request.headers.get("stripe-signature") || "";
  if (!sigHeader) throw new HttpError(403, "missing Stripe-Signature header");

  let ts = null;
  const v1Sigs = [];
  for (const part of sigHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") ts = Number.parseInt(v, 10);
    else if (k === "v1") v1Sigs.push(v);
  }
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300 || !v1Sigs.length) {
    throw new HttpError(403, "expired or missing Stripe signature");
  }

  const rawBody = await request.text();
  const expectedMac = await hmacSha256Hex(whSecret, `${ts}.${rawBody}`);
  if (!v1Sigs.some((s) => constantTimeEqual(expectedMac, s))) {
    throw new HttpError(403, "invalid Stripe webhook signature");
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { throw new HttpError(400, "invalid JSON"); }
  if (event?.type === "checkout.session.completed" && event?.data?.object?.payment_status === "paid") {
    const sess = event.data.object;
    const oid = sess.metadata?.order_id || hub.store.stripe_session_orders?.[sess.id];
    if (oid) {
      const res = activatePaidOrder(hub, oid);
      hub.persistStore();
      if (res?.user) hub.emit({ type: "user_update", user: res.user });
    }
  }
  return jsonResponse({ received: true });
}
