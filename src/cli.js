#!/usr/bin/env node

/**
 * skill-crypt CLI
 *
 * All commands connect to XMTP because the vault IS your XMTP inbox.
 * No files on disk. Skills are encrypted messages in a private XMTP group.
 *
 * Commands:
 *   store <path>               Encrypt a skill and store in XMTP vault
 *   load <skill-id>            Decrypt a skill to stdout (memory only)
 *   list                       List all skills in your XMTP vault
 *   find <query>               Search skills by name, tag, or description
 *   remove <skill-id>          Tombstone a skill in the vault
 *   rotate <new-wallet-key>    Re-encrypt vault with a new wallet key
 *   transfer catalog <address> Request catalog from another agent
 *   transfer request <addr> <id>  Request a skill from another agent
 *   transfer listen            Listen for incoming requests
 *   share create [name]        Create a Skill Share group
 *   share join [group-id]       Join Skill Share (no args = request via oracle)
 *   share profile [--seeks x]  Post your agent profile
 *   share post [id|--all]      Post skill listing(s)
 *   share request <query>      Ask group for a skill
 *   share browse [--tag x]     Browse listings
 *   share reviews [--provider] Browse reviews
 *   share review <s> <a> <1-5> Post a review
 *   share listen [--auto]      Listen for group activity
 *
 * Environment:
 *   SKILLCRYPT_WALLET_KEY      Wallet private key (required)
 *   SKILLCRYPT_XMTP_ENV        XMTP environment (default: production)
 *   SKILLCRYPT_AGENT_NAME      Agent display name (default: anonymous)
 *   SKILLCRYPT_DATA            Data dir for Skill Share state (default: ./data)
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const DATA_DIR = process.env.SKILLCRYPT_DATA || './data';
const WALLET_KEY = process.env.SKILLCRYPT_WALLET_KEY;
const XMTP_ENV = process.env.SKILLCRYPT_XMTP_ENV || 'production';
const AGENT_NAME = process.env.SKILLCRYPT_AGENT_NAME || 'anonymous';

function usage() {
  console.log(`skill-crypt: skills live in your XMTP inbox, not on disk

Usage:
  skill-crypt store <path>                     Encrypt and store in XMTP vault
  skill-crypt load <skill-id>                  Decrypt to stdout (memory only)
  skill-crypt list                             List vault contents
  skill-crypt find <query>                     Search skills
  skill-crypt remove <skill-id>                Remove a skill
  skill-crypt rotate <new-wallet-key>          Re-encrypt with new key

  skill-crypt transfer catalog <address>       Request catalog from agent
  skill-crypt transfer request <address> <id>  Request a skill
  skill-crypt transfer listen                  Listen for incoming requests

  skill-crypt share create [name]              Create a Skill Share group
  skill-crypt share join <group-id>            Join a group
  skill-crypt share profile [--seeks t1,t2]    Post your profile
  skill-crypt share post [skill-id|--all]      Post listing(s)
  skill-crypt share request <query>            Ask for a skill
  skill-crypt share browse [--tag x]           Browse listings
  skill-crypt share reviews [--provider addr]  Browse reviews
  skill-crypt share review <skill> <addr> <1-5> [comment]
  skill-crypt share listen [--auto]            Listen for activity

Environment:
  SKILLCRYPT_WALLET_KEY    Wallet private key (required)
  SKILLCRYPT_XMTP_ENV      XMTP network (default: production)
  SKILLCRYPT_AGENT_NAME    Agent display name (default: anonymous)
  SKILLCRYPT_DATA          Data dir for Skill Share state (default: ./data)`);
}

/**
 * Connect to XMTP and initialize the vault.
 * Every command needs this because the vault IS XMTP.
 */
async function connect() {
  const { SkillCryptClient } = await import('./xmtp-client.js');
  const { XMTPVault } = await import('./xmtp-vault.js');

  const client = new SkillCryptClient({
    privateKey: WALLET_KEY,
    env: XMTP_ENV
  });
  await client.connect();

  const vault = new XMTPVault({
    client: client.client,
    privateKey: WALLET_KEY,
    dbDir: client.dbDir
  });
  await vault.init();

  // Wire the vault into the client for transfer handling
  client.vault = vault;

  return { client, vault };
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

  switch (cmd) {
    case 'store': {
      const filePath = args[0];
      if (!filePath) {
        console.error('usage: skill-crypt store <path>');
        process.exit(1);
      }
      const { vault } = await connect();
      const content = await readFile(filePath, 'utf8');
      const name = basename(filePath, '.md').replace(/^SKILL$/, basename(filePath, '.md')).toLowerCase();
      const skillId = await vault.store(name, content, {
        description: `stored from ${basename(filePath)}`
      });
      console.log(`stored in XMTP vault: ${skillId}`);
      console.log(`  name: ${name}`);
      console.log(`  size: ${content.length} bytes`);
      console.log(`  location: XMTP inbox (no files on disk)`);
      break;
    }

    case 'load': {
      const skillId = args[0];
      if (!skillId) {
        console.error('usage: skill-crypt load <skill-id>');
        process.exit(1);
      }
      const { vault } = await connect();
      const content = await vault.load(skillId);
      process.stdout.write(content);
      break;
    }

    case 'list': {
      const { vault } = await connect();
      const skills = vault.list();
      if (skills.length === 0) {
        console.log('vault is empty');
      } else {
        console.log(`${skills.length} skill(s) in XMTP vault:\n`);
        for (const s of skills) {
          console.log(`  ${s.skillId}`);
          console.log(`    name: ${s.name} v${s.version}`);
          console.log(`    tags: ${s.tags.join(', ') || 'none'}`);
          console.log(`    size: ${s.size} bytes`);
          console.log(`    stored: ${s.storedAt}`);
          console.log('');
        }
      }
      break;
    }

    case 'find': {
      const query = args[0];
      if (!query) {
        console.error('usage: skill-crypt find <query>');
        process.exit(1);
      }
      const { vault } = await connect();
      const results = vault.find(query);
      if (results.length === 0) {
        console.log(`no skills matching "${query}"`);
      } else {
        for (const s of results) {
          console.log(`${s.skillId}  ${s.name}  ${s.description}`);
        }
      }
      break;
    }

    case 'remove': {
      const skillId = args[0];
      if (!skillId) {
        console.error('usage: skill-crypt remove <skill-id>');
        process.exit(1);
      }
      const { vault } = await connect();
      await vault.remove(skillId);
      console.log(`removed: ${skillId}`);
      break;
    }

    case 'rotate': {
      const newKey = args[0];
      if (!newKey) {
        console.error('usage: skill-crypt rotate <new-wallet-key>');
        process.exit(1);
      }
      const { vault } = await connect();
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
      const { client, vault } = await connect();

      if (sub === 'catalog') {
        const address = args[1];
        if (!address) {
          console.error('usage: skill-crypt transfer catalog <address>');
          process.exit(1);
        }
        await client.requestCatalog(address);
        console.log('catalog request sent');
      } else if (sub === 'request') {
        const address = args[1];
        const skillId = args[2];
        if (!address || !skillId) {
          console.error('usage: skill-crypt transfer request <address> <skill-id>');
          process.exit(1);
        }
        await client.requestSkill(address, skillId);
        console.log('skill request sent, waiting for response...');

        // Poll for the skill transfer response (up to 60s)
        const { parseMessage, handleMessage } = await import('./transfer.js');
        const deadline = Date.now() + 60000;
        let received = false;

        while (Date.now() < deadline && !received) {
          await new Promise(r => setTimeout(r, 3000));
          await client.client.conversations.sync();

          const dms = await client.client.conversations.listDms();
          for (const dm of dms) {
            await dm.sync();
            const msgs = await dm.messages({ limit: 10 });
            for (const m of msgs) {
              if (m.senderInboxId === client.client.inboxId) continue;
              const text = typeof m.content === 'string' ? m.content : m.content?.text;
              if (!text) continue;
              const parsed = parseMessage(text);
              if (parsed && parsed.type === 'skillcrypt:skill-transfer' && parsed.skillId === skillId) {
                await vault.store(parsed.name, parsed.content, {
                  version: parsed.version,
                  description: parsed.description,
                  tags: parsed.tags
                });
                console.log(`received and stored: ${parsed.name}`);
                received = true;
                break;
              }
              if (parsed && parsed.type === 'skillcrypt:ack' && !parsed.success) {
                console.error('provider does not have this skill');
                received = true;
                break;
              }
            }
            if (received) break;
          }
        }

        if (!received) {
          console.error('timed out waiting for skill transfer. is the provider listening?');
        }
      } else if (sub === 'listen') {
        console.log('listening for incoming skill requests...');
        await client.listen();
      } else {
        console.error('usage: skill-crypt transfer [catalog|request|listen]');
        process.exit(1);
      }
      break;
    }

    case 'share': {
      const sub = args[0];
      const { client, vault } = await connect();
      const { SkillShare } = await import('./skill-share.js');

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
        console.log('share this ID with other agents so they can join');
      } else if (sub === 'join') {
        let groupId = args[1];

        if (!groupId) {
          // zero-arg join: request access from oracle
          const { DEFAULTS } = await import('./config.js');
          const { buildJoinRequest } = await import('./oracle.js');

          if (DEFAULTS.groupId) {
            // try direct join first (already a member)
            try {
              await share.join(DEFAULTS.groupId);
              console.log(`joined Skill Share group: ${DEFAULTS.groupId}`);
              return;
            } catch {
              // not a member yet, request access from oracle
            }
          }

          if (!DEFAULTS.oracleAddress) {
            console.error('no oracle address configured and no group ID provided');
            process.exit(1);
          }

          console.log(`requesting access from oracle (${DEFAULTS.oracleAddress})...`);
          const joinReq = buildJoinRequest(client.getAddress(), AGENT_NAME);
          await client.send(DEFAULTS.oracleAddress, joinReq);

          // wait for approval (poll DMs for up to 30s)
          console.log('waiting for approval...');
          await client.client.conversations.sync();
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            await client.client.conversations.sync();

            // check for approval message in DMs
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
                    groupId = p.groupId;
                  } else if (p.type === 'skillcrypt:join-denied') {
                    console.error(`access denied: ${p.reason || 'unknown'}`);
                    process.exit(1);
                  }
                } catch {}
              }
              if (groupId) break;
            }
            if (groupId) break;
          }

          if (!groupId) {
            console.error('timed out waiting for oracle approval. is the oracle running?');
            process.exit(1);
          }
        }

        await share.join(groupId);
        console.log(`joined Skill Share group: ${groupId}`);
      } else if (sub === 'profile') {
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
        console.log('profile posted');
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
        if (share.groupId) {
          await share.join(share.groupId);
          await share.syncHistory();
        }
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
        if (share.groupId) {
          await share.join(share.groupId);
          await share.syncHistory();
        }
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
        const dashboardEnabled = args.includes('--dashboard');
        const dashPort = parseInt(args[args.indexOf('--port') + 1]) || 8099;

        if (dashboardEnabled) {
          const { Dashboard } = await import('./dashboard.js');
          const dash = new Dashboard({
            vault,
            share,
            agentName: AGENT_NAME,
            address: client.getAddress(),
            port: dashPort
          });
          dash.start();
        }

        console.log(`listening to Skill Share${autoRespond ? ' (auto-respond)' : ''}${dashboardEnabled ? ` (dashboard on ${dashPort})` : ''}...`);

        await share.listen({
          autoRespond,
          onEvent: (type, data) => {
            switch (type) {
              case 'listing':
                console.log(`[listing] ${data.name} from ${data.address.slice(0, 10)}...`);
                break;
              case 'listing-request':
                console.log(`[request] "${data.query}" from ${data.address.slice(0, 10)}...`);
                break;
              case 'profile':
                console.log(`[profile] ${data.name} (${data.address.slice(0, 10)}...)`);
                break;
              case 'review':
                console.log(`[review] ${data.skillName} ${'*'.repeat(data.rating)}`);
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
