#!/usr/bin/env node
/**
 * Outbox Chat E2E Automated Test Suite Runner & Summary Reporter
 * Zero-dependency test runner using Node.js built-ins (`node:test`, `node:test/reporters`).
 *
 * Usage:
 *   node tests/run-all.js
 *   node tests/run-all.js --tier 3
 *   node tests/run-all.js --grep settings
 *   TARGET_URL=http://127.0.0.1:8787 node tests/run-all.js
 *   TARGET_URL=http://127.0.0.1:3000 node tests/run-all.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { TARGET_URL, isServerOnline } from './helpers/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootTestsDir = __dirname;

// CLI Arguments parsing
let targetUrl = TARGET_URL;
let tierFilter = null;
let grepFilter = null;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if ((arg === '--target' || arg === '-t') && args[i + 1]) {
    targetUrl = args[++i].replace(/\/+$/, '');
    process.env.TARGET_URL = targetUrl;
  } else if (arg === '--tier' && args[i + 1]) {
    tierFilter = args[++i];
  } else if ((arg === '--grep' || arg === '-g') && args[i + 1]) {
    grepFilter = args[++i];
  }
}

const TIER_DEFINITIONS = [
  { id: '1', key: 'tier1-features', name: 'Tier 1: Feature Isolation' },
  { id: '2', key: 'tier2-boundaries', name: 'Tier 2: Boundary & Corner Cases' },
  { id: '3', key: 'tier3-combinations', name: 'Tier 3: Cross-Feature Combinations' },
  { id: '4', key: 'tier4-scenarios', name: 'Tier 4: Real-World Scenarios' },
];

// Discover test files grouped by Tier
function discoverTestFiles() {
  const tierFilesMap = new Map();
  const allFiles = [];

  for (const tier of TIER_DEFINITIONS) {
    if (tierFilter && tierFilter !== tier.id && tierFilter !== tier.key) {
      continue;
    }

    const tierDir = path.join(rootTestsDir, tier.key);
    if (!fs.existsSync(tierDir)) continue;

    const filesInTier = [];
    const entries = fs.readdirSync(tierDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.test.js')) {
        const fullPath = path.join(tierDir, entry.name);
        if (grepFilter && !entry.name.includes(grepFilter)) {
          continue;
        }
        filesInTier.push(fullPath);
      }
    }
    filesInTier.sort();
    tierFilesMap.set(tier.key, filesInTier);
    allFiles.push(...filesInTier);
  }

  return { tierFilesMap, allFiles };
}

async function main() {
  console.log('='.repeat(76));
  console.log('  OUTBOX CHAT — AUTOMATED E2E TEST SUITE (TIERS 1-4)');
  console.log('='.repeat(76));
  console.log(`  Target Backend URL : ${targetUrl}`);
  if (tierFilter) console.log(`  Tier Filter        : Tier ${tierFilter}`);
  if (grepFilter) console.log(`  Name Filter (grep) : "${grepFilter}"`);

  const online = await isServerOnline(targetUrl);
  if (online) {
    console.log(`  Backend Health     : [ONLINE] Server responding at ${targetUrl}/api/health`);
  } else {
    console.log(`  Backend Health     : [OFFLINE] Server not reachable at ${targetUrl}`);
    console.log('  Notice             : Tests requiring active backend will report as skipped.');
    console.log('                       Start backend with "npx wrangler dev" (8787) or "cargo run" (3000).');
  }

  const { tierFilesMap, allFiles } = discoverTestFiles();
  console.log(`  Test Files Found   : ${allFiles.length} suites across active tiers`);
  console.log('='.repeat(76));
  console.log();

  if (allFiles.length === 0) {
    console.error('Error: No matching test files found.');
    process.exit(1);
  }

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;

  // Track per-file test results for tier breakdown
  const fileStats = new Map();
  for (const f of allFiles) {
    fileStats.set(f, { pass: 0, fail: 0, skip: 0 });
  }

  const testStream = run({
    files: allFiles,
  });

  testStream.on('test:pass', (info) => {
    if (info.details?.type === 'suite') return;

    const file = info.file;
    const stat = fileStats.get(file);
    if (info.skip) {
      skippedTests++;
      if (stat) stat.skip++;
    } else {
      passedTests++;
      if (stat) stat.pass++;
    }
    totalTests++;
  });

  testStream.on('test:fail', (info) => {
    if (info.details?.type === 'suite') return;

    const file = info.file;
    const stat = fileStats.get(file);
    failedTests++;
    if (stat) stat.fail++;
    totalTests++;
  });

  // Compose with standard spec reporter for live terminal output
  testStream.compose(new spec()).pipe(process.stdout);

  await new Promise((resolve) => {
    testStream.on('end', resolve);
  });

  console.log();
  console.log('='.repeat(76));
  console.log('  TIER BREAKDOWN & EXECUTION SUMMARY');
  console.log('='.repeat(76));

  for (const tier of TIER_DEFINITIONS) {
    const files = tierFilesMap.get(tier.key) || [];
    if (files.length === 0) continue;

    let tierPass = 0;
    let tierFail = 0;
    let tierSkip = 0;

    for (const f of files) {
      const s = fileStats.get(f) || { pass: 0, fail: 0, skip: 0 };
      tierPass += s.pass;
      tierFail += s.fail;
      tierSkip += s.skip;
    }
    const tierTotal = tierPass + tierFail + tierSkip;
    const statusMark = tierFail > 0 ? '❌ FAIL' : '✅ PASS';

    console.log(`  ${tier.name.padEnd(35)} : ${files.length.toString().padStart(2)} suites | ${tierTotal.toString().padStart(3)} tests (${tierPass} passed, ${tierSkip} skipped, ${tierFail} failed) [${statusMark}]`);
  }

  console.log('-'.repeat(76));
  console.log(`  Total Test Suites  : ${allFiles.length}`);
  console.log(`  Total Test Cases   : ${totalTests}`);
  console.log(`  Passed             : ${passedTests}`);
  console.log(`  Failed             : ${failedTests}`);
  console.log(`  Skipped            : ${skippedTests}`);
  console.log(`  Target URL Tested  : ${targetUrl}`);
  console.log('='.repeat(76));

  if (failedTests > 0) {
    console.log('❌ FAILURES DETECTED: Some test cases failed assertions.');
    process.exitCode = 1;
  } else {
    console.log('✅ TEST SUITE SUCCESS: Zero test failures.');
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
