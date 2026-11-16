/**
 * Tier 2 Boundary Tests: Zero-Tolerance Emoji & Emote Audit
 * Requirement R2: Emote & Emoji Removal across UI, Seed Data, and API Endpoints
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

// Unicode Extended Pictographic and common decorative symbols
const EMOJI_AND_DECORATIVE_REGEX = /[\p{Extended_Pictographic}\u{2190}-\u{21FF}\u{27F0}-\u{27FF}💬→↓☺➤🚀👋💜⚡🔊]/u;

function containsEmoji(str) {
  if (typeof str !== 'string') return false;
  return EMOJI_AND_DECORATIVE_REGEX.test(str);
}

function findEmojisInObject(obj, path = '') {
  const found = [];
  if (obj === null || obj === undefined) return found;

  if (typeof obj === 'string') {
    if (containsEmoji(obj)) {
      found.push({ path, value: obj });
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      found.push(...findEmojisInObject(item, `${path}[${index}]`));
    });
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'color' && key !== 'id') { // exclude non-user text
        found.push(...findEmojisInObject(value, path ? `${path}.${key}` : key));
      }
    }
  }
  return found;
}

describe('Tier 2: Zero-Tolerance Emoji & Emote Audit', () => {
  let client;
  let serverOnline = false;

  before(async () => {
    client = new ApiClient(TARGET_URL);
    serverOnline = await isServerOnline(TARGET_URL);
  });

  it('B5.1: verifies zero emojis in GET /api/health response payload', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const res = await client.health();
    assert.equal(res.status, 200);

    const violations = findEmojisInObject(res.data);
    assert.equal(
      violations.length,
      0,
      `Found emojis in /api/health: ${JSON.stringify(violations)}`
    );
  });

  it('B5.2: verifies zero emojis in GET /api/bootstrap (server icons, channels, server names)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('emoji_check');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    assert.equal(reg.status, 200);

    const bootstrap = await client.bootstrap(reg.data.token);
    assert.equal(bootstrap.status, 200);

    // Specifically inspect demo server
    const demoServer = bootstrap.data.servers.find((s) => s.id === 'demo');
    if (demoServer) {
      assert.notEqual(demoServer.icon, '🚀', 'Demo server icon must not be rocket emoji 🚀');
      assert.ok(
        !containsEmoji(demoServer.name),
        `Demo server name "${demoServer.name}" must not contain emojis`
      );
      assert.ok(
        !containsEmoji(demoServer.icon),
        `Demo server icon "${demoServer.icon}" must not contain emojis`
      );

      for (const channel of demoServer.channels) {
        assert.ok(
          !containsEmoji(channel.name),
          `Channel name "${channel.name}" must not contain emojis`
        );
        if (channel.topic) {
          assert.ok(
            !containsEmoji(channel.topic),
            `Channel topic "${channel.topic}" must not contain emojis`
          );
        }
      }
    }
  });

  it('B5.3: verifies seed messages in demo-0 text channel do not contain emojis (👋, ⚡, 💜)', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('seed_check');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    const listRes = await client.getMessages('demo-0', { limit: 20 }, token);
    assert.equal(listRes.status, 200);

    const forbiddenSymbols = ['👋', '⚡', '💜', '🚀', '💬'];

    for (const msg of listRes.data) {
      for (const sym of forbiddenSymbols) {
        assert.ok(
          !msg.content.includes(sym),
          `Seed message "${msg.content}" contains forbidden emoji ${sym}`
        );
      }
      for (const rx of msg.reactions || []) {
        for (const sym of forbiddenSymbols) {
          assert.notEqual(
            rx.emoji,
            sym,
            `Seed reaction contains forbidden emoji ${sym}`
          );
        }
      }
    }
  });

  it('B5.4: verifies web frontend served assets (index.html, app.js, style.css) have zero emojis', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const assets = ['/', '/index.html', '/app.js', '/style.css'];

    for (const assetPath of assets) {
      const res = await client.request('GET', assetPath);
      // If static assets are served by the backend:
      if (res.status === 200 && typeof res.text === 'string') {
        const matches = res.text.match(new RegExp(EMOJI_AND_DECORATIVE_REGEX.source, 'gu'));
        assert.equal(
          matches,
          null,
          `Asset ${assetPath} contains forbidden emojis: ${JSON.stringify(matches?.slice(0, 10))}`
        );
      }
    }
  });

  it('B5.5: allows server creation with clean text/standard icons without emojis', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('clean_srv');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    const cleanIcons = ['HQ', 'DEV', 'A1', 'X'];
    for (const icon of cleanIcons) {
      const srvRes = await client.createServer({ name: `Server_${icon}`, icon }, token);
      assert.equal(srvRes.status, 200);
      assert.equal(srvRes.data.icon, icon);
      assert.ok(!containsEmoji(srvRes.data.icon));
    }
  });

  it('B5.6: accepts and stores clean text tokens in reaction operations', async (t) => {
    if (checkSkip(t, serverOnline)) return;

    const username = randomUsername('clean_rx');
    const password = randomPassword(12);

    const reg = await client.register(username, password);
    const token = reg.data.token;

    const postRes = await client.postMessage('demo-0', { content: 'Clean reactions check' }, token);
    const messageId = postRes.data.id;

    const cleanTokens = ['+1', 'Like', 'Ack', 'Done', 'Help', 'Idea'];
    for (const tokenStr of cleanTokens) {
      const rxRes = await client.toggleReaction(messageId, tokenStr, token);
      assert.equal(rxRes.status, 200);
      const rx = rxRes.data.reactions.find((r) => r.emoji === tokenStr);
      assert.ok(rx, `Expected reaction ${tokenStr}`);
      assert.ok(!containsEmoji(rx.emoji), `Reaction token ${tokenStr} must not contain emojis`);
    }
  });
});
