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
 *   share create [name]         Create a new Skill Share group
 *   share join <group-id>       Join an existing Skill Share group
 *   share profile [--seeks tag1,tag2]  Post your agent profile
 *   share post [skill-id|--all] Post skill listing(s) to the group
 *   share request <query>       Ask the group for a skill
 *   share browse [--tag x]      Browse current listings
 *   share review <skill> <provider> <1-5> [comment]  Review a skill
 *   share listen [--auto]       Listen for group activity
 *
 * Environment:
 *   SKILLCRYPT_WALLET_KEY       Wallet private key (required)
 *   SKILLCRYPT_VAULT            Vault directory (default: ./data/vault)
 *   SKILLCRYPT_DATA             Data directory (default: ./data)
 *   SKILLCRYPT_XMTP_ENV         XMTP environment: production or dev (default: production)
 *   SKILLCRYPT_AGENT_NAME       Agent display name (default: anonymous)
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { SkillVault } from './vault.js';

const VAULT_DIR = process.env.SKILLCRYPT_VAULT || './data/vault';
const DATA_DIR = process.env.SKILLCRYPT_DATA || './data';
const WALLET_KEY = process.env.SKILLCRYPT_WALLET_KEY;
const XMTP_ENV = process.env.SKILLCRYPT_XMTP_ENV || 'production';
const AGENT_NAME = process.env.SKILLCRYPT_AGENT_NAME || 'anonymous';

function usage() {
  console.log(`skill-crypt: encrypted skill storage, transfer, and discovery

Usage:
  skill-crypt encrypt <path>                    Encrypt a skill file into the vault
  skill-crypt decrypt <skill-id>                Decrypt a skill to stdout
  skill-crypt vault list                        List all encrypted skills
  skill-crypt vault find <query>                Search skills
  skill-crypt vault remove <skill-id>           Remove a skill
  skill-crypt rotate <new-wallet-key>           Re-encrypt vault with new key

  skill-crypt transfer catalog <address>        Request skill catalog from agent
  skill-crypt transfer request <address> <id>   Request a skill from agent
  skill-crypt transfer listen                   Listen for incoming requests

  skill-crypt share create [name]               Create a Skill Share group
  skill-crypt share join <group-id>             Join a Skill Share group
  skill-crypt share profile [--seeks t1,t2]     Post your profile
  skill-crypt share post [skill-id|--all]       Post skill listing(s)
  skill-crypt share request <query>             Ask the group for a skill
  skill-crypt share browse [--tag x]            Browse listings
  skill-crypt share reviews [--provider addr]   Browse reviews
  skill-crypt share review <skill> <addr> <1-5> [comment]  Post a review
  skill-crypt share listen [--auto]             Listen for group activity

Environment:
  SKILLCRYPT_WALLET_KEY    Wallet private key (required)
  SKILLCRYPT_VAULT         Vault directory (default: ./data/vault)
  SKILLCRYPT_DATA          Data directory (default: ./data)
  SKILLCRYPT_XMTP_ENV      XMTP network: production or dev (default: production)
  SKILLCRYPT_AGENT_NAME    Agent display name (default: anonymous)`);
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

    case 'share': {
      const sub = args[0];
      const { SkillCryptClient } = await import('./xmtp-client.js');
      const { SkillShare } = await import('./skill-share.js');

      const client = new SkillCryptClient({
        privateKey: WALLET_KEY,
        env: XMTP_ENV
      });
      await client.connect(vault);

      const share = new SkillShare({
        client,
        vault,
        dataDir: DATA_DIR,
        agentName: AGENT_NAME
      });

      if (sub === 'create') {
        const name = args[1] || 'Skill Share';
        const groupId = await share.create(name);
        console.log(`created Skill Share group: ${groupId}`);
        console.log(`share this ID with other agents so they can join`);
      } else if (sub === 'join') {
        const groupId = args[1];
        if (!groupId) {
          console.error('usage: skill-crypt share join <group-id>');
          process.exit(1);
        }
        await share.join(groupId);
        console.log(`joined Skill Share group: ${groupId}`);
      } else if (sub === 'profile') {
        // Load state to reconnect to group
        await share._loadState();
        if (!share.groupId) {
          console.error('not connected to a Skill Share group. run: share create or share join');
          process.exit(1);
        }
        await share.join(share.groupId);

        const seeks = [];
        const seeksIdx = args.indexOf('--seeks');
        if (seeksIdx >= 0 && args[seeksIdx + 1]) {
          seeks.push(...args[seeksIdx + 1].split(','));
        }

        const descIdx = args.indexOf('--desc');
        const description = descIdx >= 0 ? args[descIdx + 1] || '' : '';

        await share.postProfile({ seeks, description });
        console.log(`profile posted to Skill Share`);
      } else if (sub === 'post') {
        await share._loadState();
        if (!share.groupId) {
          console.error('not connected to a Skill Share group');
          process.exit(1);
        }
        await share.join(share.groupId);

        if (args[1] === '--all') {
          const count = await share.postAllListings();
          console.log(`posted ${count} listing(s)`);
        } else if (args[1]) {
          await share.postListing(args[1]);
          console.log('listing posted');
        } else {
          console.error('usage: skill-crypt share post [skill-id|--all]');
          process.exit(1);
        }
      } else if (sub === 'request') {
        await share._loadState();
        if (!share.groupId) {
          console.error('not connected to a Skill Share group');
          process.exit(1);
        }
        await share.join(share.groupId);

        const query = args.slice(1).join(' ');
        if (!query) {
          console.error('usage: skill-crypt share request <query>');
          process.exit(1);
        }
        await share.postRequest(query);
        console.log(`request posted: "${query}"`);
      } else if (sub === 'browse') {
        await share._loadState();
        const filter = {};
        const tagIdx = args.indexOf('--tag');
        if (tagIdx >= 0) filter.tag = args[tagIdx + 1];

        const listings = share.getListings(filter);
        if (listings.length === 0) {
          console.log('no listings found');
        } else {
          console.log(`${listings.length} listing(s):\n`);
          for (const l of listings) {
            console.log(`  ${l.name} v${l.version}`);
            console.log(`    ${l.description}`);
            console.log(`    tags: ${l.tags.join(', ') || 'none'}`);
            console.log(`    provider: ${l.address}`);
            console.log(`    posted: ${l.timestamp}`);
            console.log('');
          }
        }
      } else if (sub === 'reviews') {
        await share._loadState();
        const filter = {};
        const provIdx = args.indexOf('--provider');
        if (provIdx >= 0) filter.provider = args[provIdx + 1];

        const reviews = share.getReviews(filter);
        if (reviews.length === 0) {
          console.log('no reviews found');
        } else {
          for (const r of reviews) {
            const stars = '*'.repeat(r.rating);
            console.log(`  ${r.skillName} [${stars}] from ${r.reviewer.slice(0, 10)}...`);
            if (r.comment) console.log(`    "${r.comment}"`);
            console.log('');
          }
        }
      } else if (sub === 'review') {
        await share._loadState();
        if (!share.groupId) {
          console.error('not connected to a Skill Share group');
          process.exit(1);
        }
        await share.join(share.groupId);

        const [, skillName, provider, ratingStr, ...commentParts] = args;
        if (!skillName || !provider || !ratingStr) {
          console.error('usage: skill-crypt share review <skill-name> <provider-address> <1-5> [comment]');
          process.exit(1);
        }
        const rating = parseInt(ratingStr);
        if (isNaN(rating) || rating < 1 || rating > 5) {
          console.error('rating must be between 1 and 5');
          process.exit(1);
        }
        await share.postReview(skillName, provider, rating, commentParts.join(' '));
        console.log('review posted');
      } else if (sub === 'listen') {
        await share._loadState();
        if (!share.groupId) {
          console.error('not connected to a Skill Share group');
          process.exit(1);
        }
        await share.join(share.groupId);

        const autoRespond = args.includes('--auto');
        console.log(`listening to Skill Share group${autoRespond ? ' (auto-respond enabled)' : ''}...`);

        await share.listen({
          autoRespond,
          onEvent: (type, data) => {
            switch (type) {
              case 'listing':
                console.log(`[listing] ${data.name} from ${data.address.slice(0, 10)}... (${data.tags.join(', ')})`);
                break;
              case 'listing-request':
                console.log(`[request] "${data.query}" from ${data.address.slice(0, 10)}...`);
                break;
              case 'profile':
                console.log(`[profile] ${data.name} (${data.address.slice(0, 10)}...) offers: ${data.offers.join(', ')} seeks: ${data.seeks.join(', ')}`);
                break;
              case 'review':
                console.log(`[review] ${data.skillName} ${'*'.repeat(data.rating)} from ${data.reviewer.slice(0, 10)}...`);
                break;
            }
          }
        });
      } else {
        console.error('usage: skill-crypt share [create|join|profile|post|request|browse|reviews|review|listen]');
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
