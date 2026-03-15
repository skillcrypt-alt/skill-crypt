#!/usr/bin/env node
/**
 * End-to-end XMTP vault learning test.
 *
 * Two agents store skills in their XMTP vaults, join the network,
 * transfer skills, and verify they can "learn" (load into memory)
 * skills exclusively from the XMTP vault — never from disk.
 *
 * Skills use the same schema as our real skills (SKILL.md frontmatter
 * + markdown body).
 *
 * Usage: SKILLCRYPT_ORACLE_KEY=0x... node test/e2e-vault-learn.mjs
 */

import { XMTPVault } from '../src/xmtp-vault.js';
import { SkillCryptClient } from '../src/xmtp-client.js';
import { SkillShare } from '../src/skill-share.js';
import { buildJoinRequest } from '../src/oracle.js';
import { DEFAULTS } from '../src/config.js';
import { Wallet } from 'ethers';
import { readdir, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── Test skills matching our real SKILL.md schema ──────────────────

const SKILL_A = {
  name: 'log-analysis',
  content: `---
name: log-analysis
version: 1.0.0
description: >
  Parse and analyze application logs for error patterns, anomalies,
  and security events. Supports JSON, syslog, and common web server
  formats.
metadata:
  openclaw:
    requires:
      bins: [node]
      node_version: ">=18"
    trust:
      source: operator
      audit: true
      network: xmtp-mls
      crypto: aes-256-gcm
      disk_writes: none
---

# Log Analysis

## What This Skill Does

Analyze application logs for error patterns, anomalies, and security
events. Supports structured (JSON) and unstructured (syslog, nginx,
apache) log formats.

## Steps

1. Accept log input (file path, stdin, or raw text)
2. Detect format (JSON, syslog, nginx, apache, custom)
3. Parse entries into structured records
4. Identify error patterns and anomalies
5. Flag security events (auth failures, privilege escalation, unusual IPs)
6. Return structured analysis with severity levels

## Security

- Never write parsed logs to disk
- Sanitize file paths against directory traversal
- Rate limit analysis to prevent resource exhaustion
- Redact credentials and tokens found in log entries

## Output Format

\`\`\`json
{
  "summary": { "total": 1000, "errors": 12, "warnings": 45, "security": 3 },
  "patterns": [{ "pattern": "connection refused", "count": 8, "severity": "high" }],
  "security_events": [{ "type": "auth_failure", "source": "10.0.0.5", "count": 23 }],
  "recommendations": ["investigate repeated auth failures from 10.0.0.5"]
}
\`\`\`
`,
  meta: {
    description: 'Log parsing and security event detection',
    tags: ['logs', 'security', 'monitoring', 'analysis'],
    version: '1.0.0'
  }
};

const SKILL_B = {
  name: 'api-health-check',
  content: `---
name: api-health-check
version: 2.1.0
description: >
  Monitor API endpoints for availability, response time, and correctness.
  Supports REST and GraphQL with configurable thresholds and alerting.
metadata:
  openclaw:
    requires:
      bins: [node]
      node_version: ">=18"
    trust:
      source: operator
      audit: true
      network: xmtp-mls
      crypto: aes-256-gcm
      disk_writes: none
---

# API Health Check

## What This Skill Does

Monitor API endpoints for availability, latency, and response correctness.
Supports REST and GraphQL endpoints with configurable thresholds.

## Steps

1. Accept endpoint configuration (URL, method, headers, expected status)
2. Send probe requests at configured intervals
3. Measure response time, status code, body hash
4. Compare against thresholds (latency, error rate, content drift)
5. Report health status with detailed metrics

## Security

- Never log request bodies containing credentials
- Validate URLs against SSRF allowlist before probing
- TLS certificate verification enabled by default
- Timeout all requests (default 10s) to prevent hanging

## Configuration

\`\`\`json
{
  "endpoints": [
    {
      "url": "https://api.example.com/health",
      "method": "GET",
      "expectedStatus": 200,
      "maxLatencyMs": 500,
      "interval": "30s"
    }
  ],
  "alerting": {
    "consecutiveFailures": 3,
    "channels": ["xmtp"]
  }
}
\`\`\`

## Output Format

\`\`\`json
{
  "endpoint": "https://api.example.com/health",
  "status": "healthy",
  "latencyMs": 142,
  "statusCode": 200,
  "lastChecked": "2026-03-15T10:00:00Z",
  "uptime": "99.97%"
}
\`\`\`
`,
  meta: {
    description: 'API endpoint monitoring and health checks',
    tags: ['api', 'monitoring', 'health', 'devops'],
    version: '2.1.0'
  }
};

// ── Helpers ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.log(`  ✗ FAIL: ${msg}`); failed++; }
}

function log(agent, msg) {
  console.log(`[${agent}] ${msg}`);
}

async function noEncFiles(dir) {
  try {
    const files = await readdir(dir, { recursive: true });
    return files.filter(f => f.endsWith('.enc')).length === 0;
  } catch { return true; }
}

async function noPlaintextOnDisk(dir, skills) {
  try {
    const files = await readdir(dir, { recursive: true });
    for (const f of files) {
      try {
        const content = await readFile(join(dir, f), 'utf8');
        for (const skill of skills) {
          if (content.includes(skill.content.slice(0, 100))) return false;
        }
      } catch { /* binary or unreadable */ }
    }
    return true;
  } catch { return true; }
}

// ── Main ───────────────────────────────────────────────────────────

const TEST_DIR = `/tmp/e2e-vault-learn-${Date.now()}`;
const walletAlpha = Wallet.createRandom();
const walletBeta = Wallet.createRandom();

console.log('=== XMTP Vault Learning E2E Test ===\n');
console.log(`Alpha: ${walletAlpha.address}`);
console.log(`Beta:  ${walletBeta.address}`);
console.log(`Dir:   ${TEST_DIR}\n`);

const dirA = join(TEST_DIR, 'alpha');
const dirB = join(TEST_DIR, 'beta');
await mkdir(dirA, { recursive: true });
await mkdir(dirB, { recursive: true });

try {
  // ── 1. Connect both agents to XMTP ──────────────────────────────

  console.log('\n1. Connecting agents to XMTP (production)...');

  const clientA = new SkillCryptClient({
    privateKey: walletAlpha.privateKey,
    dbDir: join(dirA, 'xmtp'),
    env: 'production'
  });
  await clientA.connect();
  log('alpha', `connected: ${clientA.getAddress()}`);

  const clientB = new SkillCryptClient({
    privateKey: walletBeta.privateKey,
    dbDir: join(dirB, 'xmtp'),
    env: 'production'
  });
  await clientB.connect();
  log('beta', `connected: ${clientB.getAddress()}`);

  // ── 2. Create XMTP vaults ───────────────────────────────────────

  console.log('\n2. Creating XMTP vaults (skills live in XMTP messages)...');

  const vaultA = new XMTPVault({
    client: clientA.client,
    privateKey: walletAlpha.privateKey,
    dbDir: join(dirA, 'xmtp')
  });
  await vaultA.init();
  clientA.vault = vaultA;
  log('alpha', `vault created, group: ${vaultA.group.id}`);

  const vaultB = new XMTPVault({
    client: clientB.client,
    privateKey: walletBeta.privateKey,
    dbDir: join(dirB, 'xmtp')
  });
  await vaultB.init();
  clientB.vault = vaultB;
  log('beta', `vault created, group: ${vaultB.group.id}`);

  // ── 3. Store skills in XMTP vaults ──────────────────────────────

  console.log('\n3. Storing skills in XMTP vaults...');

  const idA = await vaultA.store(SKILL_A.name, SKILL_A.content, SKILL_A.meta);
  log('alpha', `stored "${SKILL_A.name}" -> ${idA}`);
  assert(!!idA, 'alpha stored log-analysis in XMTP vault');

  const idB = await vaultB.store(SKILL_B.name, SKILL_B.content, SKILL_B.meta);
  log('beta', `stored "${SKILL_B.name}" -> ${idB}`);
  assert(!!idB, 'beta stored api-health-check in XMTP vault');

  // ── 4. Verify no skill files on disk ─────────────────────────────

  console.log('\n4. Verifying no skill content on disk...');

  assert(await noEncFiles(dirA), 'no .enc files in alpha dir');
  assert(await noEncFiles(dirB), 'no .enc files in beta dir');
  assert(await noPlaintextOnDisk(dirA, [SKILL_A]), 'no plaintext skill content in alpha dir');
  assert(await noPlaintextOnDisk(dirB, [SKILL_B]), 'no plaintext skill content in beta dir');

  // ── 5. Learn skills from XMTP vault (load into memory) ──────────

  console.log('\n5. Learning skills from XMTP vault (memory only)...');

  const learnedA = await vaultA.load(idA);
  assert(learnedA === SKILL_A.content, 'alpha learned log-analysis from XMTP vault');
  assert(learnedA.includes('---\nname: log-analysis'), 'skill has correct SKILL.md frontmatter');
  assert(learnedA.includes('## Steps'), 'skill has steps section');
  assert(learnedA.includes('## Security'), 'skill has security section');
  log('alpha', `learned skill: ${learnedA.length} bytes, starts with: ${learnedA.slice(0, 40).replace(/\n/g, ' ')}...`);

  const learnedB = await vaultB.load(idB);
  assert(learnedB === SKILL_B.content, 'beta learned api-health-check from XMTP vault');
  assert(learnedB.includes('---\nname: api-health-check'), 'skill has correct SKILL.md frontmatter');
  log('beta', `learned skill: ${learnedB.length} bytes`);

  // ── 6. Verify vault list returns metadata only ───────────────────

  console.log('\n6. Checking vault list (metadata only, no content)...');

  const listA = vaultA.list();
  assert(listA.length === 1, `alpha vault has 1 skill (got ${listA.length})`);
  assert(listA[0].name === 'log-analysis', 'alpha skill name correct');
  assert(listA[0].tags.includes('security'), 'alpha skill tags present');
  assert(!listA[0]._content, 'no content leaked in list metadata');
  assert(!listA[0].payload, 'no payload leaked in list metadata');

  const listB = vaultB.list();
  assert(listB.length === 1, `beta vault has 1 skill (got ${listB.length})`);
  assert(listB[0].name === 'api-health-check', 'beta skill name correct');

  // ── 7. Join network via oracle DM flow ───────────────────────────

  console.log('\n7. Joining Skill Share network (oracle DM flow)...');

  async function requestJoin(client, vault, name, description, seeks) {
    const joinReq = buildJoinRequest(client.getAddress(), {
      name, description,
      seeks: seeks.split(','),
      skillCount: vault.list().length
    });
    await client.send(DEFAULTS.oracleAddress, joinReq);
    log(name, `sent join request to oracle`);

    // poll for approval
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      await client.client.conversations.sync();
      const convos = await client.client.conversations.list();
      for (const c of convos) {
        if (c.isGroup) continue;
        await c.sync();
        const msgs = await c.messages({ limit: 5 });
        for (const m of msgs) {
          let text = typeof m.content === 'string' ? m.content : m.content?.text;
          if (!text) continue;
          try {
            const p = JSON.parse(text);
            if (p.type === 'skillcrypt:join-approved' && p.groupId) {
              log(name, `approved! group: ${p.groupId}`);
              return p.groupId;
            }
          } catch {}
        }
      }
    }
    throw new Error(`${name}: timed out waiting for oracle approval`);
  }

  const shareA = new SkillShare({
    client: clientA, vault: vaultA,
    dataDir: join(dirA, 'share'),
    agentName: 'alpha'
  });

  const groupIdA = await requestJoin(clientA, vaultA, 'alpha', 'log analysis and monitoring agent', 'api,monitoring');
  await shareA.join(groupIdA);
  log('alpha', 'joined network');
  assert(!!groupIdA, 'alpha joined via oracle approval');

  // space out to avoid XMTP rate limits
  await new Promise(r => setTimeout(r, 3000));

  const shareB = new SkillShare({
    client: clientB, vault: vaultB,
    dataDir: join(dirB, 'share'),
    agentName: 'beta'
  });

  const groupIdB = await requestJoin(clientB, vaultB, 'beta', 'api health monitoring agent', 'logs,security');
  await shareB.join(groupIdB);
  log('beta', 'joined network');
  assert(!!groupIdB, 'beta joined via oracle approval');
  assert(groupIdA === groupIdB, 'both agents joined the same group');

  await new Promise(r => setTimeout(r, 3000));

  // Post listings
  console.log('\n8. Posting skill listings to network...');
  await shareA.postAllListings();
  log('alpha', 'posted listings');

  await new Promise(r => setTimeout(r, 3000));

  await shareB.postAllListings();
  log('beta', 'posted listings');

  await new Promise(r => setTimeout(r, 3000));

  // ── 9. Browse network and verify listings ────────────────────────

  console.log('\n9. Browsing network...');
  await shareB.syncHistory();
  const browseB = shareB.getListings({});
  log('beta', `sees ${browseB.length} listing(s)`);
  assert(browseB.length >= 1, 'beta can see listings on network');

  await shareA.syncHistory();
  const browseA = shareA.getListings({});
  log('alpha', `sees ${browseA.length} listing(s)`);

  // ── 10. Transfer skill: alpha -> beta ────────────────────────────

  console.log('\n10. Skill transfer: alpha sends log-analysis to beta...');

  // Start beta listening for incoming transfers
  const transferReceived = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('transfer timed out')), 45000);
    clientB.listen((type, data) => {
      if (type === 'transfer:received' || type === 'transfer_complete') {
        clearTimeout(timeout);
        resolve(data);
      }
    }).catch(() => {});
  });

  await new Promise(r => setTimeout(r, 2000));

  // Alpha sends skill to beta
  await clientA.sendSkill(walletBeta.address, idA);
  log('alpha', 'sent log-analysis to beta');

  // Wait for transfer
  try {
    const result = await transferReceived;
    log('beta', `received transfer: ${JSON.stringify(result)}`);
    assert(true, 'beta received skill transfer');
  } catch (e) {
    log('beta', `transfer wait: ${e.message}`);
    // even if event doesn't fire, check vault directly
  }

  await new Promise(r => setTimeout(r, 3000));

  // ── 11. Beta learns transferred skill from XMTP vault ───────────

  console.log('\n11. Beta learns transferred skill from XMTP vault...');

  // Resync beta's vault from XMTP messages
  await vaultB._syncManifest();
  const listB2 = vaultB.list();
  log('beta', `vault now has ${listB2.length} skill(s): ${listB2.map(s => s.name).join(', ')}`);

  assert(listB2.length >= 2, `beta vault has 2+ skills after transfer (got ${listB2.length})`);

  const transferredSkill = listB2.find(s => s.name === 'log-analysis');
  if (transferredSkill) {
    const learned = await vaultB.load(transferredSkill.skillId);
    assert(learned === SKILL_A.content, 'beta learned log-analysis from XMTP vault (content matches exactly)');
    assert(learned.includes('---\nname: log-analysis'), 'transferred skill has correct frontmatter');
    assert(learned.includes('## Security'), 'transferred skill has security section');
    log('beta', `learned transferred skill: ${learned.length} bytes from XMTP vault`);
  } else {
    assert(false, 'transferred skill not found in beta vault');
  }

  // ── 12. Final disk verification ──────────────────────────────────

  console.log('\n12. Final disk verification...');

  assert(await noEncFiles(dirA), 'still no .enc files in alpha dir');
  assert(await noEncFiles(dirB), 'still no .enc files in beta dir');
  assert(await noPlaintextOnDisk(dirA, [SKILL_A, SKILL_B]), 'no plaintext skill content in alpha dir after transfer');
  assert(await noPlaintextOnDisk(dirB, [SKILL_A, SKILL_B]), 'no plaintext skill content in beta dir after transfer');

  // Check what IS on disk (should only be xmtp db + share state)
  const filesA = await readdir(dirA, { recursive: true });
  const filesB = await readdir(dirB, { recursive: true });
  log('alpha', `disk files: ${filesA.join(', ')}`);
  log('beta', `disk files: ${filesB.join(', ')}`);

  // ── Results ──────────────────────────────────────────────────────

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  await rm(TEST_DIR, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);

} catch (err) {
  console.error('\n\nTest error:', err.message);
  console.error(err.stack);
  await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
}
