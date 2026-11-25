/**
 * Platform-wide owner/admin management handlers for OutboxHub Durable Object.
 */

import { HttpError, activePlan, cmp, jsonResponse, publicUser, readJson } from "./utils.js";

function requirePlatformAdmin(user) {
  if (!user.platform_admin) throw new HttpError(403, "platform administrator privileges required");
}

/** Returns platform totals, subscription breakdown, revenue, and Stripe config status. */
export function handleAdminOverview(hub, request) {
  const actor = hub.authenticate(request);
  requirePlatformAdmin(actor);
  const stripeOk = Boolean(String(hub.env?.STRIPE_SECRET_KEY || "").trim());
  const humans = Object.values(hub.store.users).filter((u) => !u.bot);
  const plusUsers = humans.filter((u) => activePlan(u) === "plus").length;
  const proUsers = humans.filter((u) => activePlan(u) === "pro").length;
  const suspendedUsers = humans.filter((u) => Boolean(u.suspended)).length;

  const orders = Object.values(hub.store.orders || {});
  const paidOrders = orders.filter((o) => o.status === "paid");
  const pendingOrdersCount = orders.filter((o) => o.status === "pending").length;
  const totalRevenueSatang = paidOrders.reduce((sum, o) => sum + (Number(o.amount_satang) || 0), 0);
  const messagesTotal = Object.values(hub.store.messages).reduce((sum, l) => sum + l.length, 0);

  return jsonResponse({
    users_total: humans.length,
    active_paid_users: plusUsers + proUsers,
    plus_users: plusUsers,
    pro_users: proUsers,
    suspended_users: suspendedUsers,
    paid_orders_count: paidOrders.length,
    pending_orders_count: pendingOrdersCount,
    total_revenue_satang: totalRevenueSatang,
    servers_total: Object.keys(hub.store.servers).length,
    messages_total: messagesTotal,
    stripe_configured: stripeOk,
    payment_mode: stripeOk ? "stripe" : "sandbox",
  });
}

/** Lists platform user accounts with optional search query (`GET /api/admin/users?q=...`). */
export function handleAdminListUsers(hub, request, url) {
  const actor = hub.authenticate(request);
  requirePlatformAdmin(actor);
  const needle = (url.searchParams.get("q") || "").trim().toLowerCase();

  let humans = Object.values(hub.store.users).filter((u) => !u.bot);
  if (needle) {
    humans = humans.filter(
      (u) =>
        u.username.toLowerCase().includes(needle) ||
        u.display_name.toLowerCase().includes(needle) ||
        (u.email || "").toLowerCase().includes(needle)
    );
  }
  humans.sort((a, b) => cmp(b.created_at, a.created_at));

  const rows = humans.slice(0, 200).map((u) => ({
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    email: u.email || null,
    plan: activePlan(u),
    plan_expires_at: u.plan_expires_at || null,
    suspended: Boolean(u.suspended),
    platform_admin: Boolean(u.platform_admin),
    created_at: u.created_at,
    servers_count: Object.values(hub.store.members).filter((m) => Boolean(m?.[u.id])).length,
  }));
  return jsonResponse(rows);
}

/** Updates a user's plan, suspension, or platform admin role (`PATCH /api/admin/users/{id}`). */
export async function handleAdminUpdateUser(hub, request, targetId) {
  const actor = hub.authenticate(request);
  requirePlatformAdmin(actor);
  if (targetId === "outbox-bot") throw new HttpError(403, "cannot modify bot account");
  const u = hub.store.users[targetId];
  if (!u) throw new HttpError(404, "user not found");
  if (u.bot) throw new HttpError(403, "cannot modify bot account");

  const body = await readJson(request);
  if (body.suspended === true && targetId === actor.id) {
    throw new HttpError(400, "cannot suspend your own account");
  }
  if (body.platform_admin === false && targetId === actor.id) {
    throw new HttpError(400, "cannot revoke your own admin role");
  }
  if (body.plan !== undefined) {
    if (!["free", "plus", "pro"].includes(body.plan)) {
      throw new HttpError(400, "plan must be free, plus, or pro");
    }
    u.plan = body.plan;
    if (body.plan === "free") {
      u.plan_expires_at = null;
    } else {
      const days = Math.min(Math.max(Number(body.plan_days) || 30, 1), 3650);
      u.plan_expires_at = new Date(Date.now() + days * 86400000).toISOString();
    }
  } else if (body.plan_days !== undefined && (u.plan === "plus" || u.plan === "pro")) {
    const days = Math.min(Math.max(Number(body.plan_days) || 30, 1), 3650);
    u.plan_expires_at = new Date(Date.now() + days * 86400000).toISOString();
  }
  if (typeof body.suspended === "boolean") {
    u.suspended = body.suspended;
    if (body.suspended) {
      for (const [tok, uid] of Object.entries(hub.store.tokens)) {
        if (uid === targetId) delete hub.store.tokens[tok];
      }
    }
  }
  if (typeof body.platform_admin === "boolean") u.platform_admin = body.platform_admin;

  hub.persistStore();
  hub.emit({ type: "user_update", user: publicUser(u) });
  return jsonResponse({
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    email: u.email || null,
    plan: activePlan(u),
    plan_expires_at: u.plan_expires_at || null,
    suspended: Boolean(u.suspended),
    platform_admin: Boolean(u.platform_admin),
    created_at: u.created_at,
  });
}

/** Lists recent platform billing orders (`GET /api/admin/orders`). */
export function handleAdminListOrders(hub, request) {
  const actor = hub.authenticate(request);
  requirePlatformAdmin(actor);
  const rows = Object.values(hub.store.orders || {})
    .sort((a, b) => cmp(b.created_at, a.created_at))
    .slice(0, 100)
    .map((o) => {
      const buyer = hub.store.users[o.user_id];
      return {
        ...o,
        username: buyer ? buyer.username : "-",
        display_name: buyer ? buyer.display_name : "ผู้ใช้ที่ถูกลบ",
      };
    });
  return jsonResponse(rows);
}
