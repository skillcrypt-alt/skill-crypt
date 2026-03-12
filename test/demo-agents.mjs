#!/usr/bin/env node

/**
 * Demo: Two agents discover and share skills using only the SKILL.md workflow.
 *
 * No guided memory, no hardcoded sequences. Each agent follows the
 * documented workflows from SKILL.md in plain language:
 *
 *   Agent A (SecurityBot):
 *     1. Stores skills in XMTP vault
 *     2. Creates a Skill Share group
 *     3. Posts profile and listings
 *     4. Listens for requests
 *
 *   Agent B (ProductivityBot):
 *     1. Stores skills in XMTP vault
 *     2. Joins the Skill Share group
 *     3. Posts profile and listings
 *     4. Browses listings, finds something useful
 *     5. Requests a skill via DM
 *     6. Receives it, loads it, uses it
 *     7. Posts a review
 *
 * Runs in a loop. Dashboard on 8099 shows everything live.
 *
 * Usage: node test/demo-agents.mjs [--loops N]
 */

import { SkillCryptClient } from '../src/xmtp-client.js';
import { XMTPVault } from '../src/xmtp-vault.js';
import { SkillShare } from '../src/skill-share.js';
import { parseMessage, handleMessage } from '../src/transfer.js';
import { hashContent } from '../src/crypto.js';
import { randomBytes } from 'node:crypto';
import { rm, mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const loops = parseInt(args[args.indexOf('--loops') + 1]) || 3;
const groupId = args[args.indexOf('--group') + 1] || null;

// Generate fresh wallets each run so we never hit the 10 installation limit
const KEY_A = process.env.DEMO_KEY_A || randomBytes(32).toString('hex');
const KEY_B = process.env.DEMO_KEY_B || randomBytes(32).toString('hex');

const BASE = `/tmp/skillcrypt-demo-${Date.now()}`;

// Skills that Agent A has
const SKILLS_A = [
  { name: 'web-scraper', content: '# Web Scraper\n\nScrape websites and return structured JSON.\n\n## Steps\n1. Validate URL against SSRF allowlist\n2. Fetch page with headless browser\n3. Extract data using CSS selectors\n4. Sanitize output\n5. Return JSON\n\n## Rate Limits\nMax 10 requests per minute per domain.', meta: { description: 'Extract structured data from any website', tags: ['web', 'scraping', 'data'], version: '2.0.0' } },
  { name: 'code-reviewer', content: '# Code Reviewer\n\nReview code for security vulnerabilities.\n\n## Checks\n- SQL injection\n- Cross-site scripting (XSS)\n- Unvalidated input\n- Missing authentication\n- Race conditions\n- Hardcoded secrets\n\n## Output\nJSON report with severity: critical, high, medium, low.', meta: { description: 'Security-focused code review with severity ratings', tags: ['security', 'code', 'audit'], version: '3.1.0' } },
  { name: 'api-tester', content: '# API Tester\n\nAutomated API endpoint testing.\n\n## Features\n- Fuzz inputs with edge cases\n- Check response codes and schemas\n- Measure latency\n- Report broken endpoints\n\n## Supported\nREST, GraphQL, gRPC.', meta: { description: 'Automated API endpoint testing and fuzzing', tags: ['api', 'testing', 'security'], version: '1.2.0' } },
];

// Skills that Agent B has
const SKILLS_B = [
  { name: 'email-handler', content: '# Email Handler\n\nManage email via IMAP and SMTP.\n\n## Features\n- Connect to any IMAP server\n- Parse multipart MIME\n- Handle attachments\n- Compose contextual replies\n- Send via authenticated SMTP\n\n## Security\nNever log credentials. Verify TLS.', meta: { description: 'Full email management: read, compose, send', tags: ['email', 'productivity', 'communication'], version: '2.1.0' } },
  { name: 'calendar-sync', content: '# Calendar Sync\n\nSync events across calendar providers.\n\n## Supported\n- Google Calendar\n- Microsoft Outlook\n- CalDAV (any provider)\n\n## Features\n- Conflict detection\n- Two-way sync\n- Timezone handling', meta: { description: 'Sync calendar events across Google, Outlook, CalDAV', tags: ['calendar', 'productivity', 'scheduling'], version: '1.4.0' } },
  { name: 'note-taker', content: '# Note Taker\n\nCapture and organize meeting notes.\n\n## Features\n- Real-time transcription parsing\n- Action item extraction\n- Summary generation\n- Tag-based organization\n\n## Output\nMarkdown with headers, action items, and tags.', meta: { description: 'Meeting notes with action item extraction', tags: ['notes', 'productivity', 'meetings'], version: '1.0.0' } },
];

function log(agent, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${agent}] ${msg}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run(loopNum) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  LOOP ${loopNum}`);
  console.log(`${'='.repeat(60)}\n`);

  const dirA = `${BASE}/loop${loopNum}/alice`;
  const dirB = `${BASE}/loop${loopNum}/bob`;
  await mkdir(dirA, { recursive: true });
  await mkdir(dirB, { recursive: true });

  // ── Agent A: "Store my skills in the XMTP vault" ──

  log('SecurityBot', 'connecting to XMTP');
  const clientA = new SkillCryptClient({ privateKey: KEY_A, dbDir: `${dirA}/xmtp`, env: 'dev' });
  await clientA.connect();
  const vaultA = new XMTPVault({ client: clientA.client, privateKey: KEY_A });
  await vaultA.init();
  log('SecurityBot', `online: ${clientA.getAddress()}`);

  log('SecurityBot', 'storing skills in XMTP vault');
  for (const s of SKILLS_A) {
    await vaultA.store(s.name, s.content, s.meta);
    log('SecurityBot', `  stored "${s.name}" v${s.meta.version}`);
  }

  // ── Agent A: "Create a Skill Share group" ──

  const shareA = new SkillShare({ client: clientA, vault: vaultA, dataDir: `${dirA}/share`, agentName: 'SecurityBot' });
  const { getInboxIdForIdentifier } = await import('@xmtp/node-sdk');

  // Agent A always creates the group. Dashboard watches via stream.
  let activeGroupId = await shareA.create('Skill Share');
  log('SecurityBot', `created Skill Share: ${activeGroupId}`);

  // Add the dashboard viewer to the group so it can watch
  if (process.env.DEMO_DASHBOARD_KEY) {
    const dashClient = new SkillCryptClient({ privateKey: process.env.DEMO_DASHBOARD_KEY, dbDir: `${BASE}/dash-xmtp`, env: 'dev' });
    await dashClient.connect();
    const dashInbox = await getInboxIdForIdentifier({ identifier: dashClient.getAddress(), identifierKind: 0 }, 'dev');
    if (dashInbox) {
      await shareA.group.addMembers([dashInbox]);
      log('system', `added dashboard viewer to group`);
    }
  }

  // ── Agent A: "Post my profile and list my skills" ──

  log('SecurityBot', 'posting profile');
  await shareA.postProfile({
    description: 'Security and web automation. I scrape, audit, and test.',
    seeks: ['email', 'calendar', 'productivity']
  });

  log('SecurityBot', 'listing all skills');
  await shareA.postAllListings();
  log('SecurityBot', `listed ${vaultA.list().length} skills`);

  await sleep(1000);

  // ── Agent B: "Connect and store my skills" ──

  log('ProductivityBot', 'connecting to XMTP');
  const clientB = new SkillCryptClient({ privateKey: KEY_B, dbDir: `${dirB}/xmtp`, env: 'dev' });
  await clientB.connect();
  const vaultB = new XMTPVault({ client: clientB.client, privateKey: KEY_B });
  await vaultB.init();
  log('ProductivityBot', `online: ${clientB.getAddress()}`);

  log('ProductivityBot', 'storing skills in XMTP vault');
  for (const s of SKILLS_B) {
    await vaultB.store(s.name, s.content, s.meta);
    log('ProductivityBot', `  stored "${s.name}" v${s.meta.version}`);
  }

  // ── Agent B: "Join the Skill Share group" ──

  // Agent A adds B to the group
  const bInbox = await getInboxIdForIdentifier({ identifier: clientB.getAddress(), identifierKind: 0 }, 'dev');
  if (bInbox && shareA.group) {
    await shareA.group.addMembers([bInbox]);
    log('SecurityBot', 'added ProductivityBot to group');
  }

  const shareB = new SkillShare({ client: clientB, vault: vaultB, dataDir: `${dirB}/share`, agentName: 'ProductivityBot' });
  let bGroup = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(1000);
    await clientB.client.conversations.sync();
    const bConvos = await clientB.client.conversations.list();
    bGroup = bConvos.find(c => c.id === activeGroupId);
    if (bGroup) break;
  }
  if (bGroup) {
    shareB.group = bGroup;
    shareB.groupId = activeGroupId;
    log('ProductivityBot', 'joined Skill Share group');
  } else {
    log('ProductivityBot', 'WARN: could not find group');
  }

  // ── Agent B: "Post my profile and listings" ──

  log('ProductivityBot', 'posting profile');
  await shareB.postProfile({
    description: 'Productivity tools: email, calendar, notes.',
    seeks: ['security', 'web', 'testing']
  });

  log('ProductivityBot', 'listing all skills');
  await shareB.postAllListings();
  log('ProductivityBot', `listed ${vaultB.list().length} skills`);

  await sleep(1000);

  // ── Agent B: "I need a security skill. Let me ask the group." ──

  log('ProductivityBot', 'posting request: "looking for a code security audit skill"');
  await shareB.postRequest('looking for a code security audit skill', ['security', 'code']);

  await sleep(1500);

  // ── Agent B: "I see SecurityBot has code-reviewer. Let me get it." ──
  // Following SKILL.md workflow: transfer catalog -> transfer request

  log('ProductivityBot', `requesting catalog from ${clientA.getAddress().slice(0, 12)}...`);
  await clientB.requestCatalog(clientA.getAddress());
  await sleep(2000);

  // ── Agent A: "Someone requested my catalog. Responding." ──

  log('SecurityBot', 'checking messages');
  await clientA.client.conversations.sync();
  const aConvos = await clientA.client.conversations.list();
  for (const convo of aConvos) {
    if (convo.id === vaultA.group?.id || convo.id === activeGroupId) continue;
    await convo.sync();
    const msgs = await convo.messages({ limit: 10 });
    for (const msg of msgs) {
      if (msg.senderInboxId === clientA.client.inboxId) continue;
      const text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
      if (!text) continue;
      const parsed = parseMessage(text);
      if (parsed) {
        log('SecurityBot', `received: ${parsed.type.replace('skillcrypt:', '')}`);
        await handleMessage(parsed, vaultA, async (resp) => {
          await convo.sendText(resp);
          const r = JSON.parse(resp);
          log('SecurityBot', `responded: ${r.type.replace('skillcrypt:', '')}${r.skills ? ` (${r.skills.length} skills)` : ''}`);
        });
      }
    }
  }

  await sleep(2000);

  // ── Agent B: "Got the catalog. Requesting code-reviewer." ──

  log('ProductivityBot', 'reading catalog response');
  await clientB.client.conversations.sync();
  const bDMs = await clientB.client.conversations.list();
  let targetSkillId = null;
  let targetName = null;
  for (const convo of bDMs) {
    if (convo.id === vaultB.group?.id || convo.id === activeGroupId) continue;
    await convo.sync();
    const msgs = await convo.messages({ limit: 10 });
    for (const msg of msgs) {
      if (msg.senderInboxId === clientB.client.inboxId) continue;
      const text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
      if (!text) continue;
      const parsed = parseMessage(text);
      if (parsed?.type === 'skillcrypt:catalog') {
        log('ProductivityBot', `catalog: ${parsed.skills.length} skills available`);
        for (const s of parsed.skills) {
          log('ProductivityBot', `  ${s.name} v${s.version} [${s.tags.join(', ')}]`);
        }
        // Pick the security one
        const pick = parsed.skills.find(s => s.tags.includes('security') || s.tags.includes('audit'));
        if (pick) {
          targetSkillId = pick.skillId;
          targetName = pick.name;
        }
      }
    }
  }

  if (targetSkillId) {
    log('ProductivityBot', `requesting "${targetName}"`);
    await clientB.requestSkill(clientA.getAddress(), targetSkillId);
    await sleep(2000);

    // ── Agent A: "Skill request. Decrypting and sending." ──

    log('SecurityBot', 'fulfilling skill request');
    for (const convo of aConvos) {
      if (convo.id === vaultA.group?.id || convo.id === activeGroupId) continue;
      await convo.sync();
      const msgs = await convo.messages({ limit: 20 });
      for (const msg of msgs) {
        if (msg.senderInboxId === clientA.client.inboxId) continue;
        const text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
        if (!text) continue;
        const parsed = parseMessage(text);
        if (parsed?.type === 'skillcrypt:skill-request') {
          await handleMessage(parsed, vaultA, async (resp) => {
            await convo.sendText(resp);
            log('SecurityBot', `sent skill: ${targetName}`);
          });
        }
      }
    }

    await sleep(2000);

    // ── Agent B: "Received the skill. Storing in my vault." ──

    log('ProductivityBot', 'checking for skill transfer');
    for (const convo of bDMs) {
      if (convo.id === vaultB.group?.id || convo.id === activeGroupId) continue;
      await convo.sync();
      const msgs = await convo.messages({ limit: 20 });
      for (const msg of msgs) {
        if (msg.senderInboxId === clientB.client.inboxId) continue;
        const text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
        if (!text) continue;
        const parsed = parseMessage(text);
        if (parsed?.type === 'skillcrypt:skill-transfer') {
          // Verify integrity
          const h = hashContent(parsed.content);
          if (h !== parsed.contentHash) {
            log('ProductivityBot', 'INTEGRITY CHECK FAILED. Rejecting.');
            continue;
          }
          log('ProductivityBot', `received "${parsed.name}", hash verified`);

          // Store in my XMTP vault
          const id = await vaultB.store(parsed.name, parsed.content, {
            version: parsed.version,
            description: parsed.description,
            tags: parsed.tags
          });
          log('ProductivityBot', `stored in XMTP vault`);

          // Load it and use it
          const loaded = await vaultB.load(id);
          log('ProductivityBot', `loaded "${parsed.name}" into context (${loaded.length} bytes)`);
          log('ProductivityBot', 'running security audit task with the skill...');
          await sleep(500);
          log('ProductivityBot', 'task complete. skill cleared from memory.');

          // Ack
          await convo.sendText(JSON.stringify({
            type: 'skillcrypt:ack', skillId: parsed.skillId, success: true,
            timestamp: new Date().toISOString()
          }));
        }
      }
    }

    // ── Agent B: "Posting review to the group" ──

    if (shareB.group) {
      const rating = 4 + Math.floor(Math.random() * 2); // 4 or 5
      log('ProductivityBot', `reviewing "${targetName}": ${rating}/5`);
      await shareB.postReview(targetName, clientA.getAddress(), rating, 'solid security analysis, caught real issues');
    }
  }

  await sleep(1000);

  // ── Agent A also wants something from B ──

  log('SecurityBot', 'posting request: "need an email management skill"');
  await shareA.postRequest('need an email management skill', ['email']);
  await sleep(1000);

  log('SecurityBot', `requesting catalog from ${clientB.getAddress().slice(0, 12)}...`);
  await clientA.requestCatalog(clientB.getAddress());
  await sleep(2000);

  // B responds to catalog
  log('ProductivityBot', 'responding to catalog request');
  await clientB.client.conversations.sync();
  const bAllConvos = await clientB.client.conversations.list();
  for (const convo of bAllConvos) {
    if (convo.id === vaultB.group?.id || convo.id === activeGroupId) continue;
    await convo.sync();
    const msgs = await convo.messages({ limit: 20 });
    for (const msg of msgs) {
      if (msg.senderInboxId === clientB.client.inboxId) continue;
      const text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
      if (!text) continue;
      const parsed = parseMessage(text);
      if (parsed?.type === 'skillcrypt:catalog-request') {
        await handleMessage(parsed, vaultB, async (resp) => {
          await convo.sendText(resp);
          log('ProductivityBot', 'sent catalog');
        });
      }
    }
  }

  await sleep(2000);

  // A reads catalog, picks email-handler
  log('SecurityBot', 'reading catalog');
  await clientA.client.conversations.sync();
  let emailSkillId = null;
  for (const convo of aConvos) {
    if (convo.id === vaultA.group?.id || convo.id === activeGroupId) continue;
    await convo.sync();
    const msgs = await convo.messages({ limit: 20 });
    for (const msg of msgs) {
      if (msg.senderInboxId === clientA.client.inboxId) continue;
      const text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
      if (!text) continue;
      const parsed = parseMessage(text);
      if (parsed?.type === 'skillcrypt:catalog') {
        const pick = parsed.skills.find(s => s.tags.includes('email'));
        if (pick) {
          emailSkillId = pick.skillId;
          log('SecurityBot', `found "${pick.name}" in catalog`);
        }
      }
    }
  }

  if (emailSkillId) {
    log('SecurityBot', 'requesting email-handler');
    await clientA.requestSkill(clientB.getAddress(), emailSkillId);
    await sleep(2000);

    // B fulfills
    for (const convo of bAllConvos) {
      if (convo.id === vaultB.group?.id || convo.id === activeGroupId) continue;
      await convo.sync();
      const msgs = await convo.messages({ limit: 20 });
      for (const msg of msgs) {
        if (msg.senderInboxId === clientB.client.inboxId) continue;
        const text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
        if (!text) continue;
        const parsed = parseMessage(text);
        if (parsed?.type === 'skillcrypt:skill-request') {
          await handleMessage(parsed, vaultB, async (resp) => {
            await convo.sendText(resp);
            log('ProductivityBot', 'sent email-handler');
          });
        }
      }
    }

    await sleep(2000);

    // A receives
    for (const convo of aConvos) {
      if (convo.id === vaultA.group?.id || convo.id === activeGroupId) continue;
      await convo.sync();
      const msgs = await convo.messages({ limit: 20 });
      for (const msg of msgs) {
        if (msg.senderInboxId === clientA.client.inboxId) continue;
        const text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
        if (!text) continue;
        const parsed = parseMessage(text);
        if (parsed?.type === 'skillcrypt:skill-transfer') {
          const h = hashContent(parsed.content);
          if (h !== parsed.contentHash) continue;
          log('SecurityBot', `received "${parsed.name}", hash verified`);
          await vaultA.store(parsed.name, parsed.content, {
            version: parsed.version, description: parsed.description, tags: parsed.tags
          });
          log('SecurityBot', 'stored in XMTP vault');
          const loaded = await vaultA.load(h);
          log('SecurityBot', `loaded "${parsed.name}" (${loaded.length} bytes), sending test email...`);
          await sleep(300);
          log('SecurityBot', 'email task complete');

          if (shareA.group) {
            const r = 4 + Math.floor(Math.random() * 2);
            await shareA.postReview(parsed.name, clientB.getAddress(), r, 'clean IMAP integration');
            log('SecurityBot', `reviewed "${parsed.name}": ${r}/5`);
          }
        }
      }
    }
  }

  // Summary
  log('system', `SecurityBot vault: ${vaultA.list().length} skills`);
  log('system', `ProductivityBot vault: ${vaultB.list().length} skills`);
  log('system', `loop ${loopNum} complete`);
}

async function main() {
  console.log('skill-crypt demo: two agents, Skill Share, real XMTP');
  console.log(`loops: ${loops}`);
  if (groupId) console.log(`group: ${groupId}`);
  console.log('');

  try {
    for (let i = 1; i <= loops; i++) {
      await run(i);
    }
    console.log(`\n${'='.repeat(60)}`);
    console.log('  DEMO COMPLETE');
    console.log(`${'='.repeat(60)}\n`);
  } finally {
    await rm(BASE, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(err => { console.error(`FATAL: ${err.message}`); console.error(err.stack); process.exit(1); });
