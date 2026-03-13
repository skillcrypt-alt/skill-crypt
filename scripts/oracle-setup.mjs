#!/usr/bin/env node
/**
 * Oracle Setup
 *
 * Creates the canonical Skill Share group and starts
 * listening for join requests. Run once to bootstrap,
 * then run again to resume and keep listening.
 *
 * Usage:
 *   SKILLCRYPT_ORACLE_KEY=0x... node scripts/oracle-setup.mjs [--create|--listen|--status]
 *
 * Env:
 *   SKILLCRYPT_ORACLE_KEY  - Oracle wallet private key (required)
 *   SKILLCRYPT_XMTP_ENV    - "dev" or "production" (default: dev)
 *   SKILLCRYPT_DATA        - Data directory (default: ./data/oracle)
 */

import { SkillShareOracle } from '../src/oracle.js';
import { XMTPVault } from '../src/xmtp-vault.js';
import { SkillShare } from '../src/skill-share.js';

const key = process.env.SKILLCRYPT_ORACLE_KEY;
if (!key) {
  console.error('SKILLCRYPT_ORACLE_KEY is required');
  process.exit(1);
}

const env = process.env.SKILLCRYPT_XMTP_ENV || 'production';
const dataDir = process.env.SKILLCRYPT_DATA || './data/oracle';
const cmd = process.argv[2] || '--listen';

const oracle = new SkillShareOracle({
  privateKey: key,
  dataDir,
  env,
  groupName: 'Skill Share'
});

await oracle.connect();

if (cmd === '--create') {
  const groupId = await oracle.createGroup();
  console.log(`\ngroup created: ${groupId}`);
  console.log(`\nupdate src/config.js with this group ID.`);
  console.log(`then run with --listen to start accepting join requests.\n`);

} else if (cmd === '--status') {
  if (oracle.groupId) {
    await oracle.resumeGroup();
  }
  const status = oracle.getStatus();
  console.log(JSON.stringify(status, null, 2));

} else if (cmd === '--listen') {
  await oracle.resumeGroup();

  // start dashboard if --dashboard flag is present
  if (process.argv.includes('--dashboard')) {
    const dashPort = parseInt(process.argv[process.argv.indexOf('--port') + 1]) || 8099;

    // create vault + share instances for the dashboard
    const vault = new XMTPVault({ client: oracle.client.client, privateKey: key });
    await vault.init();

    const share = new SkillShare({
      client: oracle.client, vault, dataDir, agentName: 'oracle'
    });
    // use the oracle's already-resolved group directly
    share.groupId = oracle.groupId;
    share.group = oracle.group;

    const { Dashboard } = await import('../src/dashboard.js');
    const dash = new Dashboard({
      vault, share,
      agentName: 'oracle',
      address: oracle.client.getAddress(),
      port: dashPort
    });
    dash.start();

    // start share listener in background so dashboard indexes group messages
    await share.syncHistory();
    share.listen({ autoRespond: false, onEvent: () => {} }).catch(() => {});
  }

  console.log(`\noracle listening. agents can DM ${oracle.client.getAddress()} to request access.\n`);

  await oracle.listen({
    onEvent(type, data) {
      console.log(`[event] ${type}:`, JSON.stringify(data));
    }
  });
}
