#!/usr/bin/env node

/**
 * skill-crypt CLI
 *
 * Commands:
 *   encrypt <path>              Encrypt a skill file into the vault
 *   decrypt <skill-id>          Decrypt a skill to stdout (never to file)
 *   vault list                  List all skills in the vault
 *   vault find <query>          Search skills by name, tag, or description
 *   vault remove <skill-id>     Remove a skill from the vault
 *   rotate <new-wallet-key>     Re-encrypt all skills with a new wallet key
 *   transfer catalog <address>  Request a skill catalog from another agent
 *   transfer request <address> <skill-id>  Request a skill from another agent
 *   transfer listen             Listen for incoming skill requests and transfers
 *
 * Environment:
 *   SKILLCRYPT_WALLET_KEY       Wallet private key (required)
 *   SKILLCRYPT_VAULT            Vault directory (default: ./data/vault)
 *   SKILLCRYPT_XMTP_ENV         XMTP environment: production or dev (default: production)
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { SkillVault } from './vault.js';

const VAULT_DIR = process.env.SKILLCRYPT_VAULT || './data/vault';
const WALLET_KEY = process.env.SKILLCRYPT_WALLET_KEY;
const XMTP_ENV = process.env.SKILLCRYPT_XMTP_ENV || 'production';

function usage() {
  console.log(`skill-crypt: encrypted skill storage and transfer

Usage:
  skill-crypt encrypt <path>                    Encrypt a skill file into the vault
  skill-crypt decrypt <skill-id>                Decrypt a skill to stdout
  skill-crypt vault list                        List all encrypted skills
  skill-crypt vault find <query>                Search skills
  skill-crypt vault remove <skill-id>           Remove a skill
  skill-crypt rotate <new-wallet-key>            Re-encrypt vault with new key
  skill-crypt transfer catalog <address>        Request skill catalog from agent
  skill-crypt transfer request <address> <id>   Request a skill from agent
  skill-crypt transfer listen                   Listen for incoming requests

Environment:
  SKILLCRYPT_WALLET_KEY    Wallet private key (required)
  SKILLCRYPT_VAULT         Vault directory (default: ./data/vault)
  SKILLCRYPT_XMTP_ENV      XMTP network: production or dev (default: production)`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === 'help' || cmd === '--help') {
    usage();
    return;
  }

  if (!WALLET_KEY) {
    console.error('error: SKILLCRYPT_WALLET_KEY environment variable is required');
    process.exit(1);
  }

  const vault = new SkillVault(VAULT_DIR, WALLET_KEY);
  await vault.init();

  switch (cmd) {
    case 'encrypt': {
      const filePath = args[0];
      if (!filePath) {
        console.error('usage: skill-crypt encrypt <path>');
        process.exit(1);
      }
      const content = await readFile(filePath, 'utf8');
      const name = basename(filePath, '.md')
        .replace(/^SKILL$/, basename(filePath, '.md'))
        .toLowerCase();
      const skillId = await vault.store(name, content, {
        description: `encrypted from ${basename(filePath)}`
      });
      console.log(`stored: ${skillId}`);
      console.log(`  name: ${name}`);
      console.log(`  hash: ${vault.manifest.skills[skillId].contentHash}`);
      console.log(`  size: ${content.length} bytes`);
      break;
    }

    case 'decrypt': {
      const skillId = args[0];
      if (!skillId) {
        console.error('usage: skill-crypt decrypt <skill-id>');
        process.exit(1);
      }
      const content = await vault.load(skillId);
      process.stdout.write(content);
      break;
    }

    case 'vault': {
      const sub = args[0];
      if (sub === 'list') {
        const skills = vault.list();
        if (skills.length === 0) {
          console.log('vault is empty');
        } else {
          console.log(`${skills.length} skill(s) in vault:\n`);
          for (const s of skills) {
            console.log(`  ${s.skillId}`);
            console.log(`    name: ${s.name} v${s.version}`);
            console.log(`    tags: ${s.tags.join(', ') || 'none'}`);
            console.log(`    size: ${s.size} bytes`);
            console.log(`    stored: ${s.storedAt}`);
            console.log('');
          }
        }
      } else if (sub === 'find') {
        const query = args[1];
        if (!query) {
          console.error('usage: skill-crypt vault find <query>');
          process.exit(1);
        }
        const results = vault.find(query);
        if (results.length === 0) {
          console.log(`no skills matching "${query}"`);
        } else {
          for (const s of results) {
            console.log(`${s.skillId}  ${s.name}  ${s.description}`);
          }
        }
      } else if (sub === 'remove') {
        const skillId = args[1];
        if (!skillId) {
          console.error('usage: skill-crypt vault remove <skill-id>');
          process.exit(1);
        }
        await vault.remove(skillId);
        console.log(`removed: ${skillId}`);
      } else {
        console.error('usage: skill-crypt vault [list|find|remove]');
        process.exit(1);
      }
      break;
    }

    case 'rotate': {
      const newKey = args[0];
      if (!newKey) {
        console.error('usage: skill-crypt rotate <new-wallet-key>');
        process.exit(1);
      }
      const skills = vault.list();
      if (skills.length === 0) {
        console.log('vault is empty, nothing to rotate');
        break;
      }
      console.log(`rotating ${skills.length} skill(s) to new wallet key...`);
      const result = await vault.rotateKey(newKey);
      console.log(`rotated: ${result.rotated} skill(s)`);
      if (result.failed.length > 0) {
        console.error(`failed: ${result.failed.join(', ')}`);
        process.exit(1);
      }
      console.log('done. update SKILLCRYPT_WALLET_KEY to the new key.');
      break;
    }

    case 'transfer': {
      const sub = args[0];
      const { SkillCryptClient } = await import('./xmtp-client.js');
      const client = new SkillCryptClient({
        privateKey: WALLET_KEY,
        env: XMTP_ENV
      });
      await client.connect(vault);

      if (sub === 'catalog') {
        const address = args[1];
        if (!address) {
          console.error('usage: skill-crypt transfer catalog <address>');
          process.exit(1);
        }
        console.log(`requesting catalog from ${address}...`);
        await client.requestCatalog(address);
        console.log('catalog request sent');
      } else if (sub === 'request') {
        const address = args[1];
        const skillId = args[2];
        if (!address || !skillId) {
          console.error('usage: skill-crypt transfer request <address> <skill-id>');
          process.exit(1);
        }
        console.log(`requesting skill ${skillId} from ${address}...`);
        await client.requestSkill(address, skillId);
        console.log('skill request sent');
      } else if (sub === 'listen') {
        console.log('listening for incoming skill requests...');
        await client.listen((msg) => {
          console.log(`[non-protocol message from ${msg.senderInboxId}]`);
        });
      } else {
        console.error('usage: skill-crypt transfer [catalog|request|listen]');
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
