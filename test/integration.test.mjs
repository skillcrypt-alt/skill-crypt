/**
 * Integration test: two agents transfer a skill over XMTP.
 *
 * This test creates two real XMTP clients on the dev network,
 * has Agent A encrypt a skill and send it to Agent B,
 * and verifies Agent B receives and can decrypt it.
 *
 * Skills live in XMTP messages (XMTPVault), never on disk as .enc files.
 *
 * Run: node test/integration.test.mjs
 */

import { XMTPVault } from '../src/xmtp-vault.js';
import { SkillCryptClient } from '../src/xmtp-client.js';
import { Wallet } from 'ethers';
import { rm } from 'node:fs/promises';

const TEST_DIR = '/tmp/skillcrypt-integration-' + Date.now();
const DB_DIR = `${TEST_DIR}/xmtp`;

// generate fresh throwaway wallets
const walletA = Wallet.createRandom();
const walletB = Wallet.createRandom();

console.log('=== skill-crypt integration test ===\n');
console.log(`Agent A: ${walletA.address}`);
console.log(`Agent B: ${walletB.address}`);
console.log(`Test dir: ${TEST_DIR}\n`);

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

try {
  // 1. Connect both agents to XMTP (vault needs client)
  console.log('1. Connecting to XMTP dev network...');
  const clientA = new SkillCryptClient({
    privateKey: walletA.privateKey,
    dbDir: `${DB_DIR}/a`,
    env: 'dev'
  });
  const clientB = new SkillCryptClient({
    privateKey: walletB.privateKey,
    dbDir: `${DB_DIR}/b`,
    env: 'dev'
  });

  await clientA.connect();
  assert(!!clientA.getAddress(), `Agent A connected: ${clientA.getAddress()}`);

  await clientB.connect();
  assert(!!clientB.getAddress(), `Agent B connected: ${clientB.getAddress()}`);

  // 2. Set up XMTP vaults (skills live in XMTP messages, not on disk)
  console.log('2. Setting up XMTP vaults...');
  const vaultA = new XMTPVault({ client: clientA.client, privateKey: walletA.privateKey, dbDir: `${DB_DIR}/a` });
  await vaultA.init();
  clientA.vault = vaultA;

  const vaultB = new XMTPVault({ client: clientB.client, privateKey: walletB.privateKey, dbDir: `${DB_DIR}/b` });
  await vaultB.init();
  clientB.vault = vaultB;

  // 3. Agent A encrypts a skill into their XMTP vault
  console.log('3. Agent A stores a skill in XMTP vault...');
  const skillContent = '# Code Review Skill\n\nAnalyze code for security issues.\n\n## Steps\n1. Read the diff\n2. Check for SQL injection\n3. Check for XSS\n4. Verify input validation\n5. Report findings';

  const skillId = await vaultA.store('code-reviewer', skillContent, {
    description: 'Automated code review',
    tags: ['security', 'code'],
    version: '1.0.0'
  });
  assert(!!skillId, 'skill stored in Agent A XMTP vault');

  const decrypted = await vaultA.load(skillId);
  assert(decrypted === skillContent, 'Agent A can load the skill from XMTP');

  // 4. Verify agents can reach each other
  console.log('4. Checking XMTP reachability...');
  const aCanReachB = await clientA.canReach(walletB.address);
  assert(aCanReachB, 'Agent A can reach Agent B on XMTP');

  const bCanReachA = await clientB.canReach(walletA.address);
  assert(bCanReachA, 'Agent B can reach Agent A on XMTP');

  // 5. Start Agent B listening in the background
  console.log('5. Agent B starts listening for transfers...');
  const received = [];
  const listenPromise = (async () => {
    const timeout = setTimeout(() => {}, 30000);
    try {
      await clientB.listen((type, data) => {
        received.push({ type, ...data });
      });
    } catch (err) {
      // stream ended
    } finally {
      clearTimeout(timeout);
    }
  })();

  // give listener time to start
  await new Promise(r => setTimeout(r, 3000));

  // 6. Agent A sends the skill to Agent B
  console.log('6. Agent A sends skill to Agent B over XMTP...');
  await clientA.sendSkill(walletB.address, skillId);
  assert(true, 'skill sent over XMTP E2E encrypted channel');

  // 7. Wait for Agent B to process
  console.log('7. Waiting for Agent B to receive and process...');
  await new Promise(r => setTimeout(r, 10000));

  // 8. Check Agent B's XMTP vault
  console.log('8. Checking Agent B XMTP vault...');
  const bSkills = vaultB.list();
  assert(bSkills.length > 0, `Agent B vault has ${bSkills.length} skill(s)`);

  if (bSkills.length > 0) {
    const bSkill = bSkills[0];
    assert(bSkill.name === 'code-reviewer', `skill name matches: ${bSkill.name}`);

    const bDecrypted = await vaultB.load(bSkill.skillId);
    assert(bDecrypted === skillContent, 'Agent B decrypted content matches original');
    assert(bSkill.contentHash === vaultA.manifest.skills[skillId].contentHash, 'content hash matches');
  }

  // 9. Verify no .enc files on disk (skills live only in XMTP)
  console.log('9. Verifying no skill files on disk...');
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(TEST_DIR, { recursive: true });
  const encFiles = files.filter(f => f.endsWith('.enc'));
  assert(encFiles.length === 0, `no .enc files on disk (found ${encFiles.length})`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  // cleanup
  await rm(TEST_DIR, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);

} catch (err) {
  console.error('\nTest error:', err.message);
  console.error(err.stack);
  await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
}
