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

const key = process.env.SKILLCRYPT_ORACLE_KEY;
if (!key) {
  console.error('SKILLCRYPT_ORACLE_KEY is required');
  process.exit(1);
}

const env = process.env.SKILLCRYPT_XMTP_ENV || 'dev';
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
  console.log(`\noracle listening. agents can DM ${oracle.client.getAddress()} to request access.\n`);

  await oracle.listen({
    onEvent(type, data) {
      console.log(`[event] ${type}:`, JSON.stringify(data));
    }
  });
}
