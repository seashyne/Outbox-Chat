/**
 * Tier 1 E2E: Account Management, Membership Storefront Commerce,
 * Plan-Based Upload/Sticker Quotas, and Platform Admin Console.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ApiClient, TARGET_URL, checkSkip, isServerOnline, randomPassword, randomUsername } from '../helpers/client.js';

let online = false;
test.before(async () => {
  online = await isServerOnline();
});

async function registerAcc(prefix) {
  const password = randomPassword();
  const username = randomUsername(prefix);
  const client = new ApiClient(TARGET_URL);
  const res = await client.register(username, password);
  assert.equal(res.status, 200);
  return {
    username,
    password,
    user: res.data.user,
    account: res.data.account,
    token: res.data.token,
    client: new ApiClient(TARGET_URL, res.data.token),
  };
}

test('Account: email validation, unique email 409, password rotation, and permanent deletion', async (t) => {
  if (checkSkip(t, online)) return;
  const alice = await registerAcc('ac_a');
  const bob = await registerAcc('ac_b');

  // Inspect @me account projection
  const meRes = await alice.client.request('GET', '/api/users/@me');
  assert.equal(meRes.status, 200);
  assert.equal(meRes.data.account.plan, 'free');

  // Invalid email rejected, valid email accepted, duplicate email rejected (409)
  const badEmail = await alice.client.request('PATCH', '/api/users/@me', { body: { email: 'not-an-email' } });
  assert.equal(badEmail.status, 400);

  const uniqueMail = `${alice.username}@example.com`;
  const setMail = await alice.client.request('PATCH', '/api/users/@me', { body: { email: uniqueMail } });
  assert.equal(setMail.status, 200);
  assert.equal(setMail.data.account.email, uniqueMail);

  const dupMail = await bob.client.request('PATCH', '/api/users/@me', { body: { email: uniqueMail } });
  assert.equal(dupMail.status, 409);

  // Wrong current password rejected
  const wrongPw = await alice.client.request('POST', '/api/users/@me/password', {
    body: { current_password: 'WrongPassword123', new_password: 'NewPassword456!' },
  });
  assert.equal(wrongPw.status, 403);

  // Rotate password -> old token invalidated -> new token & new password work
  const nextPw = randomPassword();
  const rotRes = await alice.client.request('POST', '/api/users/@me/password', {
    body: { current_password: alice.password, new_password: nextPw },
  });
  assert.equal(rotRes.status, 200);
  assert.ok(rotRes.data.token && rotRes.data.token !== alice.token);

  const oldMe = await alice.client.request('GET', '/api/users/@me');
  assert.equal(oldMe.status, 401);

  const newClient = new ApiClient(TARGET_URL, rotRes.data.token);
  const newMe = await newClient.request('GET', '/api/users/@me');
  assert.equal(newMe.status, 200);

  const loginRes = await new ApiClient(TARGET_URL).login(alice.username, nextPw);
  assert.equal(loginRes.status, 200);

  // Create shared server with Bob, then delete Alice's account -> server transfers to Bob
  const srv = await newClient.createServer('Transfer Guild');
  assert.equal(srv.status, 200);
  const joinRes = await bob.client.joinServer(srv.data.id);
  assert.equal(joinRes.status, 200);

  const delWrong = await newClient.request('POST', '/api/users/@me/delete', { body: { password: 'nope' } });
  assert.equal(delWrong.status, 403);

  const delOk = await newClient.request('POST', '/api/users/@me/delete', { body: { password: nextPw } });
  assert.equal(delOk.status, 204);

  const deadLogin = await new ApiClient(TARGET_URL).login(alice.username, nextPw);
  assert.equal(deadLogin.status, 401);

  const bobBoot = await bob.client.bootstrap();
  assert.equal(bobBoot.status, 200);
  const transferred = bobBoot.data.servers.find((s) => s.id === srv.data.id);
  assert.ok(transferred);
  assert.equal(transferred.owner_id, bob.user.id);
});

test('Commerce: storefront plans, upload quota upgrade (5MB -> 15MB), and Pro sticker boost', async (t) => {
  if (checkSkip(t, online)) return;
  const buyer = await registerAcc('ac_buy');

  const catalog = await buyer.client.request('GET', '/api/billing/plans');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.plans.length, 3);
  assert.equal(catalog.data.account.plan, 'free');

  // Free user cannot upload 5.5 MB (> 5 MB limit)
  const bigBuf = new Uint8Array(Math.floor(5.5 * 1024 * 1024));
  const freeUpload = await fetch(`${TARGET_URL}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': 'big.bin' },
    body: bigBuf,
  });
  assert.equal(freeUpload.status, 400);

  if (!catalog.data.stripe_configured) {
    // Upgrade to Plus via Sandbox Checkout
    const coPlus = await buyer.client.request('POST', '/api/billing/checkout', {
      body: { plan_id: 'plus_monthly', payment_method: 'promptpay' },
    });
    assert.equal(coPlus.status, 200);
    assert.equal(coPlus.data.mode, 'sandbox');
    assert.ok(coPlus.data.order.id);

    const donePlus = await buyer.client.request('POST', '/api/billing/sandbox-complete', {
      body: { order_id: coPlus.data.order.id },
    });
    assert.equal(donePlus.status, 200);
    assert.equal(donePlus.data.account.plan, 'plus');
    assert.equal(donePlus.data.user.plan, 'plus');

    // Now 5.5 MB upload succeeds within Plus 15 MB limit
    const plusUpload = await fetch(`${TARGET_URL}/api/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'video/mp4', 'X-File-Name': 'plus-clip.mp4' },
      body: bigBuf,
    });
    assert.equal(plusUpload.status, 200);

    // Upgrade to Pro and confirm > 24 stickers allowed (up to 48)
    const coPro = await buyer.client.request('POST', '/api/billing/checkout', {
      body: { plan_id: 'pro_monthly', payment_method: 'card' },
    });
    assert.equal(coPro.status, 200);
    const donePro = await buyer.client.request('POST', '/api/billing/sandbox-complete', {
      body: { order_id: coPro.data.order.id },
    });
    assert.equal(donePro.status, 200);
    assert.equal(donePro.data.account.plan, 'pro');
    assert.equal(donePro.data.account.max_stickers, 48);

    const srv = await buyer.client.createServer('Pro Stickers');
    assert.equal(srv.status, 200);
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    for (let i = 1; i <= 25; i++) {
      const st = await buyer.client.request('POST', `/api/servers/${srv.data.id}/stickers`, {
        body: { name: `st_${i}`, data_url: tinyPng },
      });
      assert.equal(st.status, 200, `Sticker ${i} should succeed on Pro`);
    }

    const orders = await buyer.client.request('GET', '/api/billing/orders');
    assert.equal(orders.status, 200);
    assert.ok(orders.data.filter((o) => o.status === 'paid').length >= 2);
  }

  // Signed webhook invalid signature or unconfigured secret must always be rejected
  const badSig = await fetch(`${TARGET_URL}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=123,v1=deadbeef' },
    body: JSON.stringify({ type: 'checkout.session.completed' }),
  });
  assert.ok([400, 401, 403, 503].includes(badSig.status));
});

test('Platform Admin: RBAC guard, user overview, manual plan grant, suspend & unsuspend', async (t) => {
  if (checkSkip(t, online)) return;
  const adminOrFirst = await registerAcc('ac_adm');
  const regular = await registerAcc('ac_reg');

  // Non-admin is strictly blocked (403)
  const denied = await regular.client.request('GET', '/api/admin/overview');
  assert.equal(denied.status, 403);

  // Also test fake claim secret rejection
  const claimFail = await regular.client.request('POST', '/api/admin/claim', {
    body: { secret: crypto.randomBytes(12).toString('hex') },
  });
  assert.ok([403, 503].includes(claimFail.status));

  // Promote via claim secret if not first user (so Admin flows run even after earlier tests)
  if (!adminOrFirst.account?.is_platform_admin && process.env.TEST_ADMIN_CLAIM_SECRET) {
    const claimed = await adminOrFirst.client.request('POST', '/api/admin/claim', {
      body: { secret: process.env.TEST_ADMIN_CLAIM_SECRET },
    });
    assert.equal(claimed.status, 200);
    adminOrFirst.account = claimed.data.account;
  }
  if (!adminOrFirst.account?.is_platform_admin) return;

  const ov = await adminOrFirst.client.request('GET', '/api/admin/overview');
  assert.equal(ov.status, 200);
  assert.ok(ov.data.users_total >= 2);

  const users = await adminOrFirst.client.request('GET', '/api/admin/users', { query: { q: regular.username } });
  assert.equal(users.status, 200);
  assert.equal(users.data.length, 1);

  // Grant Plus plan manually & verify
  const grant = await adminOrFirst.client.request('PATCH', `/api/admin/users/${regular.user.id}`, {
    body: { plan: 'plus', plan_days: 14 },
  });
  assert.equal(grant.status, 200);
  assert.equal(grant.data.plan, 'plus');

  // Suspend revokes active tokens and rejects login (403)
  const susp = await adminOrFirst.client.request('PATCH', `/api/admin/users/${regular.user.id}`, {
    body: { suspended: true },
  });
  assert.equal(susp.status, 200);

  const blockedMe = await regular.client.request('GET', '/api/users/@me');
  assert.ok([401, 403].includes(blockedMe.status));

  const blockedLogin = await new ApiClient(TARGET_URL).login(regular.username, regular.password);
  assert.equal(blockedLogin.status, 403);

  // Unsuspend restores login
  const unsusp = await adminOrFirst.client.request('PATCH', `/api/admin/users/${regular.user.id}`, {
    body: { suspended: false },
  });
  assert.equal(unsusp.status, 200);
  const restored = await new ApiClient(TARGET_URL).login(regular.username, regular.password);
  assert.equal(restored.status, 200);

  const orders = await adminOrFirst.client.request('GET', '/api/admin/orders');
  assert.equal(orders.status, 200);
  assert.ok(Array.isArray(orders.data));
});
