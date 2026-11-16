/**
 * Tier 4 Scenario Tests: Concurrent Users & Workload Bursts
 * Real-world concurrency testing: parallel registrations, simultaneous messages,
 * concurrent duplicate conflict handling, and reaction contention.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiClient,
  TARGET_URL,
  isServerOnline,
  checkSkip,
  randomUsername,
  randomPassword,
} from '../helpers/client.js';

describe('Tier 4: Concurrency & Real-World Workloads', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('S3.1: handles 10 concurrent registrations with unique IDs and session tokens', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const count = 10;
    const users = Array.from({ length: count }, (_, i) => ({
      username: randomUsername(`burst_${i}`),
      password: randomPassword(14),
    }));

    const regPromises = users.map((u) => client.register(u.username, u.password));
    const results = await Promise.all(regPromises);

    const userIds = new Set();
    const tokens = new Set();

    results.forEach((res, i) => {
      assert.equal(res.status, 200, `Concurrent registration ${i} failed: ${res.text}`);
      assert.ok(res.data.token);
      assert.ok(res.data.user?.id);
      tokens.add(res.data.token);
      userIds.add(res.data.user.id);
    });

    assert.equal(userIds.size, count, `All ${count} user IDs must be unique`);
    assert.equal(tokens.size, count, `All ${count} session tokens must be unique`);
  });

  it('S3.2: concurrent duplicate registration conflict resolution (only one succeeds with 200, other 409)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const targetUsername = randomUsername('race_dup');
    const password = randomPassword(14);

    // Fire two identical registration requests concurrently
    const [res1, res2] = await Promise.all([
      client.register(targetUsername, password),
      client.register(targetUsername, password),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      `Expected exactly one 200 OK and one 409 Conflict, got: ${res1.status} and ${res2.status}`
    );
  });

  it('S3.3: handles simultaneous message posts from 5 users in the same channel without data loss', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const count = 5;
    const pass = randomPassword(14);

    // Register 5 users
    const users = await Promise.all(
      Array.from({ length: count }, (_, i) => client.register(randomUsername(`par_post_${i}`), pass))
    );
    users.forEach((u) => assert.equal(u.status, 200));

    // Concurrently post one message from each user
    const burstTimestamp = Date.now();
    const postPromises = users.map((u, i) => {
      const content = `Parallel message from user ${i} [${burstTimestamp}]`;
      return client.postMessage('demo-0', { content }, u.data.token);
    });

    const postResults = await Promise.all(postPromises);
    postResults.forEach((res, i) => {
      assert.equal(res.status, 200, `Message post ${i} failed: ${res.text}`);
      assert.ok(res.data.id);
    });

    const postedIds = postResults.map((r) => r.data.id);

    // Verify all messages appear in channel history
    const listRes = await client.getMessages('demo-0', { limit: 50 }, users[0].data.token);
    assert.equal(listRes.status, 200);

    const historyIds = new Set(listRes.data.map((m) => m.id));
    for (const id of postedIds) {
      assert.ok(historyIds.has(id), `Message ${id} should be present in channel history`);
    }
  });

  it('S3.4: concurrent reaction toggling on a single target message', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const pass = randomPassword(14);
    const author = await client.register(randomUsername('rx_target_u'), pass);
    const postRes = await client.postMessage('demo-0', { content: 'Reaction stress target' }, author.data.token);
    const targetMsgId = postRes.data.id;

    // Register 4 voters
    const voters = await Promise.all(
      Array.from({ length: 4 }, (_, i) => client.register(randomUsername(`voter_${i}`), pass))
    );

    // Concurrently all 4 voters add "+1" reaction
    const votePromises = voters.map((v) => client.toggleReaction(targetMsgId, '+1', v.data.token));
    const voteResults = await Promise.all(votePromises);
    voteResults.forEach((r) => assert.equal(r.status, 200));

    // Verify final state
    const finalHistory = await client.getMessages('demo-0', { limit: 10 }, author.data.token);
    const targetMsg = finalHistory.data.find((m) => m.id === targetMsgId);
    assert.ok(targetMsg);

    const plusOne = targetMsg.reactions.find((r) => r.emoji === '+1');
    assert.ok(plusOne, 'Expected "+1" reaction on message');
    assert.equal(plusOne.count, 4, 'Reaction count should be 4');
  });
});
