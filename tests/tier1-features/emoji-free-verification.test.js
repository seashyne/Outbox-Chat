/**
 * Tier 1 Feature Tests: Emote & Emoji Removal Verification
 * Requirement R4: Zero Unicode Emojis in Static Assets, Seed Data, Responses, and Clean Reaction Tokens
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ApiClient,
  TARGET_URL,
  isServerOnline,
  checkSkip,
  randomUsername,
  randomPassword,
} from '../helpers/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Standard regex matching Unicode Extended Pictographics and legacy chat decoration symbols
const EMOJI_AND_DECORATIVE_REGEX = /[\p{Extended_Pictographic}\u{2190}-\u{21FF}\u{27F0}-\u{27FF}💬→↓☺➤🚀👋💜⚡🔊]/u;

function containsEmoji(str) {
  if (typeof str !== 'string') return false;
  return EMOJI_AND_DECORATIVE_REGEX.test(str);
}

function findEmojisInObject(obj, currentPath = '') {
  const violations = [];
  if (obj === null || obj === undefined) return violations;

  if (typeof obj === 'string') {
    if (containsEmoji(obj)) {
      violations.push({ path: currentPath, value: obj });
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      violations.push(...findEmojisInObject(item, `${currentPath}[${index}]`));
    });
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'color' && key !== 'id' && key !== 'token' && key !== 'created_at') {
        violations.push(...findEmojisInObject(value, currentPath ? `${currentPath}.${key}` : key));
      }
    }
  }
  return violations;
}

describe('Tier 1: Emote & Emoji Removal Verification (Requirement R4)', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('4.1: verifies zero unicode emojis in static frontend source assets (offline + served)', async (t) => {
    // 1. Static file check (offline capable)
    const assetFiles = [
      'web/index.html',
      'web/app.js',
      'web/style.css',
      'web/favicon.svg',
      ...fs.readdirSync(path.join(projectRoot, 'web/js')).map((f) => `web/js/${f}`),
      ...fs.readdirSync(path.join(projectRoot, 'web/css')).map((f) => `web/css/${f}`),
    ];

    for (const relPath of assetFiles) {
      const fullPath = path.join(projectRoot, relPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = content.match(new RegExp(EMOJI_AND_DECORATIVE_REGEX.source, 'gu'));
        assert.equal(
          matches,
          null,
          `Static file ${relPath} contains forbidden emojis: ${JSON.stringify(matches?.slice(0, 10))}`
        );
      }
    }

    // 2. HTTP served assets check (online)
    if (serverOnline) {
      for (const route of ['/', '/index.html', '/app.js', '/style.css']) {
        const res = await client.request('GET', route);
        if (res.status === 200 && typeof res.text === 'string') {
          const matches = res.text.match(new RegExp(EMOJI_AND_DECORATIVE_REGEX.source, 'gu'));
          assert.equal(
            matches,
            null,
            `Served route ${route} returned content containing emojis: ${JSON.stringify(matches?.slice(0, 5))}`
          );
        }
      }
    }
  });

  it('4.2: verifies zero unicode emojis in bootstrap payload (servers, icons, channels, greetings)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('emoji_free');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);

    const bootRes = await client.bootstrap(reg.data.token);
    assert.equal(bootRes.status, 200);

    const violations = findEmojisInObject(bootRes.data);
    assert.equal(
      violations.length,
      0,
      `Bootstrap payload contains forbidden emojis: ${JSON.stringify(violations)}`
    );

    // Specifically verify demo server icon is clean text (e.g. "HQ"), not rocket 🚀
    const demoServer = bootRes.data.servers.find((s) => s.id === 'demo');
    if (demoServer) {
      assert.equal(demoServer.icon, 'HQ', 'Demo server icon must be clean text "HQ"');
    }
  });

  it('4.3: verifies all 6 clean text reaction tokens (+1, Like, Ack, Done, Help, Idea) can be added and removed', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('tokens_u');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'Clean tokens verification target' }, token);
    assert.equal(postRes.status, 200);
    const messageId = postRes.data.id;

    const expectedTokens = ['+1', 'Like', 'Ack', 'Done', 'Help', 'Idea'];

    // Toggle on each token
    for (const tokenStr of expectedTokens) {
      const rxOn = await client.toggleReaction(messageId, tokenStr, token);
      assert.equal(rxOn.status, 200, `Toggle ON failed for ${tokenStr}: ${rxOn.text}`);
      const entry = rxOn.data.reactions.find((r) => r.emoji === tokenStr);
      assert.ok(entry, `Expected reaction entry for ${tokenStr}`);
      assert.equal(entry.count, 1);
      assert.equal(entry.me, true);
    }

    // Toggle off each token
    for (const tokenStr of expectedTokens) {
      const rxOff = await client.toggleReaction(messageId, tokenStr, token);
      assert.equal(rxOff.status, 200, `Toggle OFF failed for ${tokenStr}: ${rxOff.text}`);
      const entry = rxOff.data.reactions.find((r) => r.emoji === tokenStr);
      assert.equal(entry, undefined, `Expected reaction ${tokenStr} to be removed`);
    }
  });

  it('4.4: rejects legacy unicode emoji reaction payloads with HTTP 400 Bad Request', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('reject_emoji');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'Emoji rejection target message' }, token);
    assert.equal(postRes.status, 200);
    const messageId = postRes.data.id;

    const forbiddenEmojis = ['👍', '🎉', '❤️', '😀', '🚀', '👋'];

    for (const emoji of forbiddenEmojis) {
      const res = await client.toggleReaction(messageId, emoji, token);
      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 for legacy emoji reaction "${emoji}", got status ${res.status}`
      );
    }
  });

  it('4.5: preserves clean text reaction tokens in message history without emoji conversion', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('rx_history');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'Reaction history check' }, token);
    assert.equal(postRes.status, 200);
    const messageId = postRes.data.id;

    await client.toggleReaction(messageId, 'Ack', token);
    await client.toggleReaction(messageId, 'Idea', token);

    const listRes = await client.getMessages('demo-0', { limit: 10 }, token);
    assert.equal(listRes.status, 200);

    const fetchedMsg = listRes.data.find((m) => m.id === messageId);
    assert.ok(fetchedMsg, 'Target message must be in message list');
    assert.ok(Array.isArray(fetchedMsg.reactions));
    assert.ok(fetchedMsg.reactions.some((r) => r.emoji === 'Ack'));
    assert.ok(fetchedMsg.reactions.some((r) => r.emoji === 'Idea'));
    assert.ok(!fetchedMsg.reactions.some((r) => containsEmoji(r.emoji)));
  });

  it('4.6: verifies seed messages in demo channel contain zero emojis', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('seed_audit');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);
    const token = reg.data.token;

    const listRes = await client.getMessages('demo-0', { limit: 50 }, token);
    assert.equal(listRes.status, 200);

    for (const msg of listRes.data) {
      assert.ok(!containsEmoji(msg.content), `Seed message "${msg.content}" contains forbidden emojis`);
      for (const rx of msg.reactions || []) {
        assert.ok(!containsEmoji(rx.emoji), `Seed reaction "${rx.emoji}" contains forbidden emojis`);
      }
    }
  });
});
