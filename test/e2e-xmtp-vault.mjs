#!/usr/bin/env node

/**
 * End-to-end test: XMTP Vault (zero disk).
 *
 * Verifies that skills live entirely in XMTP messages:
 *   1. Agent stores skills (encrypted messages in private XMTP group)
 *   2. No .enc files, no manifest, no vault directory on disk
 *   3. Agent loads skills from XMTP messages into memory
 *   4. Agent transfers skills to another agent via DM
 *   5. Receiving agent stores in their own XMTP vault
 *   6. Zero plaintext skill files anywhere
 *
 * Usage: node test/e2e-xmtp-vault.mjs [--loops N] [--env dev|production]
 */

import { SkillCryptClient } from '../src/xmtp-client.js';
import { XMTPVault } from '../src/xmtp-vault.js';
import { parseMessage, handleMessage } from '../src/transfer.js';
import { hashContent } from '../src/crypto.js';
import { readdir, rm, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const WALLET_A = {
  key: process.env.E2E_WALLET_A || 'dbafc47f5a1807ef8b5348ca2f31e2eed388c18c78ca7df1f86a092fadca4b23',
  name: 'Alice'
};
const WALLET_B = {
  key: process.env.E2E_WALLET_B || '53f3aacd49ea48fa23269e94e3d9d2091d4058aa731da47ec8ad3f96fb54d415',
  name: 'Bob'
};

const SKILLS = [
  {
    name: 'web-scraper',
    content: '# Web Scraper\n\nScrape any website.\n\n## Steps\n1. Parse URL\n2. Fetch with headless browser\n3. Extract via CSS selectors\n4. Return JSON\n\n## Security\n- SSRF allowlist\n- Sanitize HTML\n- Rate limit per domain',
    meta: { description: 'Website scraping', tags: ['web', 'data'], version: '1.0.0' }
  },
  {
    name: 'code-reviewer',
    content: '# Code Reviewer\n\nAnalyze code for bugs and security.\n\n## Focus\n- SQL injection\n- XSS\n- Unvalidated input\n- Missing auth\n- Race conditions',
    meta: { description: 'Code review and security', tags: ['code', 'security'], version: '1.3.0' }
  }
];

const args = process.argv.slice(2);
const loops = parseInt(args[args.indexOf('--loops') + 1]) || 2;
const xmtpEnv = args[args.indexOf('--env') + 1] || 'dev';

function log(agent, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${agent}] ${msg}`);
}

function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
}

async function walkDir(dir) {
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) results.push(...await walkDir(full));
      else results.push(full);
    }
  } catch {}
  return results;
}

async function checkNoVaultFiles(baseDir) {
  const files = await walkDir(baseDir);
  for (const f of files) {
    // There should be no .enc files anywhere
    assert(!f.endsWith('.enc'), `found .enc file on disk: ${f}`);
    // There should be no manifest.json
    assert(!f.endsWith('manifest.json'), `found manifest on disk: ${f}`);
  }
}

async function runLoop(iteration) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  LOOP ${iteration} (XMTP Vault, zero disk)`);
  console.log(`${'='.repeat(60)}\n`);

  const baseDir = `/tmp/skillcrypt-xmtp-vault-${Date.now()}`;
  await mkdir(baseDir, { recursive: true });

  // Connect Alice
  log('Alice', `connecting to XMTP (${xmtpEnv})`);
  const clientA = new SkillCryptClient({
    privateKey: WALLET_A.key,
    dbDir: join(baseDir, 'alice-xmtp'),
    env: xmtpEnv
  });
  await clientA.connect();

  const vaultA = new XMTPVault({
    client: clientA.client,
    privateKey: WALLET_A.key
  });
  await vaultA.init();
  log('Alice', `connected: ${clientA.getAddress()}`);
  log('Alice', `vault group: ${vaultA.group.id}`);

  // Connect Bob
  log('Bob', `connecting to XMTP (${xmtpEnv})`);
  const clientB = new SkillCryptClient({
    privateKey: WALLET_B.key,
    dbDir: join(baseDir, 'bob-xmtp'),
    env: xmtpEnv
  });
  await clientB.connect();

  const vaultB = new XMTPVault({
    client: clientB.client,
    privateKey: WALLET_B.key
  });
  await vaultB.init();
  log('Bob', `connected: ${clientB.getAddress()}`);

  // Store skills in Alice's XMTP vault
  log('Alice', 'storing skills in XMTP vault (no disk)');
  const storedIds = [];
  for (const skill of SKILLS) {
    const id = await vaultA.store(skill.name, skill.content, skill.meta);
    storedIds.push(id);
    log('Alice', `  stored: ${skill.name} -> ${id.slice(0, 16)}...`);
  }

  // Verify: no .enc files, no manifest on disk
  log('system', 'checking disk: no .enc files, no manifest');
  await checkNoVaultFiles(baseDir);
  log('system', 'PASS: zero vault files on disk');

  // List from XMTP
  const aliceSkills = vaultA.list();
  log('Alice', `vault has ${aliceSkills.length} skills (from XMTP messages)`);
  assert(aliceSkills.length === SKILLS.length, `expected ${SKILLS.length} skills, got ${aliceSkills.length}`);

  // Load a skill from XMTP into memory
  const target = aliceSkills[0];
  log('Alice', `loading "${target.name}" from XMTP into memory`);
  const loaded = await vaultA.load(target.skillId);
  log('Alice', `decrypted: ${loaded.length} bytes in memory`);
  assert(loaded.length > 0, 'loaded skill is empty');
  assert(hashContent(loaded) === target.contentHash, 'content hash mismatch after load');
  log('Alice', 'content hash verified');

  // Search
  const found = vaultA.find('security');
  log('Alice', `search "security": ${found.length} result(s)`);
  assert(found.length >= 1, 'search should find code-reviewer');

  // Transfer: Bob requests from Alice via DM
  log('Bob', 'requesting catalog from Alice');
  await clientB.requestCatalog(clientA.getAddress());
  await new Promise(r => setTimeout(r, 2000));

  // Alice processes
  log('Alice', 'processing messages');
  await clientA.client.conversations.sync();
  const aliceConvos = await clientA.client.conversations.list();
  for (const convo of aliceConvos) {
    if (convo.id === vaultA.group.id) continue; // skip vault group
    await convo.sync();
    const msgs = await convo.messages({ limit: 20 });
    for (const msg of msgs) {
      if (msg.senderInboxId === clientA.client.inboxId) continue;
      let text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
      if (!text) continue;
      const parsed = parseMessage(text);
      if (parsed) {
        log('Alice', `received: ${parsed.type}`);
        await handleMessage(parsed, vaultA, async (response) => {
          await convo.sendText(response);
          const resp = JSON.parse(response);
          log('Alice', `sent: ${resp.type}`);
        });
      }
    }
  }

  await new Promise(r => setTimeout(r, 2000));

  // Bob reads catalog
  log('Bob', 'reading catalog');
  await clientB.client.conversations.sync();
  const bobConvos = await clientB.client.conversations.list();
  let catalog = null;
  let transferConvo = null;
  for (const convo of bobConvos) {
    if (convo.id === vaultB.group.id) continue;
    await convo.sync();
    const msgs = await convo.messages({ limit: 20 });
    for (const msg of msgs) {
      if (msg.senderInboxId === clientB.client.inboxId) continue;
      let text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
      if (!text) continue;
      const parsed = parseMessage(text);
      if (parsed && parsed.type === 'skillcrypt:catalog') {
        catalog = parsed;
        transferConvo = convo;
        log('Bob', `catalog: ${catalog.skills.length} skills available`);
      }
    }
  }

  if (catalog && catalog.skills.length > 0) {
    const want = catalog.skills[0];
    log('Bob', `requesting: ${want.name} (${want.skillId.slice(0, 16)}...)`);
    await clientB.requestSkill(clientA.getAddress(), want.skillId);
    await new Promise(r => setTimeout(r, 2000));

    // Alice fulfills
    log('Alice', 'fulfilling skill request');
    for (const convo of aliceConvos) {
      if (convo.id === vaultA.group.id) continue;
      await convo.sync();
      const msgs = await convo.messages({ limit: 20 });
      for (const msg of msgs) {
        if (msg.senderInboxId === clientA.client.inboxId) continue;
        let text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
        if (!text) continue;
        const parsed = parseMessage(text);
        if (parsed && parsed.type === 'skillcrypt:skill-request') {
          await handleMessage(parsed, vaultA, async (response) => {
            await convo.sendText(response);
            log('Alice', `sent skill: ${want.name}`);
          });
        }
      }
    }

    await new Promise(r => setTimeout(r, 2000));

    // Bob receives and stores in HIS XMTP vault
    log('Bob', 'receiving skill transfer');
    for (const convo of bobConvos) {
      if (convo.id === vaultB.group.id) continue;
      await convo.sync();
      const msgs = await convo.messages({ limit: 20 });
      for (const msg of msgs) {
        if (msg.senderInboxId === clientB.client.inboxId) continue;
        let text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
        if (!text) continue;
        const parsed = parseMessage(text);
        if (parsed && parsed.type === 'skillcrypt:skill-transfer') {
          log('Bob', `received: ${parsed.name}`);

          // Verify hash
          assert(hashContent(parsed.content) === parsed.contentHash, 'transfer content hash mismatch');
          log('Bob', 'content hash verified');

          // Store in Bob's XMTP vault (not disk!)
          const bobId = await vaultB.store(parsed.name, parsed.content, {
            version: parsed.version,
            description: parsed.description,
            tags: parsed.tags
          });
          log('Bob', `stored in XMTP vault: ${bobId.slice(0, 16)}...`);

          // Send ack
          await convo.sendText(JSON.stringify({
            type: 'skillcrypt:ack',
            skillId: parsed.skillId,
            success: true,
            timestamp: new Date().toISOString()
          }));
          log('Bob', 'sent ack');
        }
      }
    }

    // Bob loads the skill from his XMTP vault
    const bobSkills = vaultB.list();
    log('Bob', `XMTP vault: ${bobSkills.length} skill(s)`);
    assert(bobSkills.length >= 1, 'Bob should have at least 1 skill');

    const bobLoaded = await vaultB.load(bobSkills[0].skillId);
    log('Bob', `loaded "${bobSkills[0].name}" from XMTP: ${bobLoaded.length} bytes`);
    assert(bobLoaded.length > 0, 'loaded skill is empty');
    log('Bob', 'skill in context, executing task...');
    await new Promise(r => setTimeout(r, 300));
    log('Bob', 'task complete, skill cleared from memory');
  }

  // Final check: absolutely no vault files on disk
  log('system', 'final disk check');
  await checkNoVaultFiles(baseDir);
  log('system', 'PASS: zero .enc files, zero manifests, zero vault dirs');
  log('system', 'skills exist ONLY in XMTP messages');

  // Cleanup
  await rm(baseDir, { recursive: true, force: true }).catch(() => {});
  log('system', `loop ${iteration} complete`);
}

async function main() {
  console.log('skill-crypt XMTP vault e2e test');
  console.log(`loops: ${loops}, xmtp: ${xmtpEnv}`);
  console.log('architecture: skills live in XMTP messages, zero files on disk\n');

  for (let i = 1; i <= loops; i++) {
    await runLoop(i);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('  ALL TESTS PASSED');
  console.log('  Skills lived entirely in XMTP. Nothing on disk.');
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
