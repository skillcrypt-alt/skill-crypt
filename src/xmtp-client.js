/**
 * XMTP Client
 *
 * Connects to the XMTP network using the agent's wallet key.
 * Handles sending and receiving skillcrypt protocol messages
 * through end-to-end encrypted conversations.
 */

import { Client, IdentifierKind, LogLevel } from '@xmtp/node-sdk';
import { toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { parseMessage, handleMessage } from './transfer.js';

/**
 * Create an XMTP-compatible signer from a hex private key.
 *
 * @param {string} privateKeyHex - 0x-prefixed hex private key
 * @returns {object} Signer compatible with XMTP Node SDK
 */
function createSigner(privateKeyHex) {
  const key = privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`;
  const account = privateKeyToAccount(key);

  return {
    type: 'EOA',
    getIdentifier() {
      return {
        identifier: account.address.toLowerCase(),
        identifierKind: 0  // Ethereum
      };
    },
    async signMessage(message) {
      const sig = await account.signMessage({
        message: typeof message === 'string' ? message : { raw: message }
      });
      return toBytes(sig);
    }
  };
}

export class SkillCryptClient {
  /**
   * @param {object} opts
   * @param {string} opts.privateKey - Wallet private key (hex)
   * @param {string} [opts.dbDir] - Directory for XMTP database files
   * @param {string} [opts.env] - XMTP environment: "production" or "dev"
   */
  constructor(opts) {
    this.privateKey = opts.privateKey;
    this.dbDir = opts.dbDir || './data/xmtp';
    this.env = opts.env || 'dev';
    this.client = null;
    this.vault = null;
    this.address = null;
  }

  /**
   * Connect to the XMTP network.
   *
   * @param {SkillVault} [vault] - Local vault for handling incoming transfers
   * @returns {SkillCryptClient}
   */
  async connect(vault) {
    this.vault = vault || null;
    const signer = createSigner(this.privateKey);
    this.address = signer.getIdentifier().identifier;

    await mkdir(this.dbDir, { recursive: true });

    // deterministic db path per wallet to avoid installation limit
    const dbPath = join(this.dbDir, `skillcrypt-${this.address.slice(0, 10)}.db`);

    this.client = await Client.create(signer, {
      env: this.env,
      dbPath,
      logLevel: LogLevel.off
    });

    if (!this.client.isRegistered) {
      await this.client.register();
    }

    console.log(`[skillcrypt] connected: ${this.address} (${this.env})`);
    return this;
  }

  /**
   * Send a skillcrypt protocol message to another agent via DM.
   *
   * @param {string} peerAddress - Recipient wallet address
   * @param {object} payload - Protocol message object
   */
  async send(peerAddress, payload) {
    const peer = peerAddress.toLowerCase();
    const identifier = { identifier: peer, identifierKind: 0 };
    const canMsg = await this.client.canMessage([identifier]);

    if (!canMsg.get(peer)) {
      throw new Error(`peer not reachable on XMTP: ${peerAddress}`);
    }

    const dm = await this.client.conversations.createDmWithIdentifier(
      { identifier: peer, identifierKind: 0 }
    );
    await dm.sync();
    await dm.sendText(JSON.stringify(payload));
  }

  /**
   * Request a skill catalog from another agent.
   *
   * @param {string} peerAddress
   */
  async requestCatalog(peerAddress) {
    await this.send(peerAddress, {
      type: 'skillcrypt:catalog-request',
      timestamp: new Date().toISOString()
    });
    console.log(`[skillcrypt] catalog requested from ${peerAddress}`);
  }

  /**
   * Request a specific skill from another agent.
   *
   * @param {string} peerAddress
   * @param {string} skillId
   */
  async requestSkill(peerAddress, skillId) {
    await this.send(peerAddress, {
      type: 'skillcrypt:skill-request',
      skillId,
      timestamp: new Date().toISOString()
    });
    console.log(`[skillcrypt] skill ${skillId} requested from ${peerAddress}`);
  }

  /**
   * Start listening for incoming skillcrypt messages.
   * Processes catalog requests, skill requests, and transfers automatically.
   *
   * @param {function} [onEvent] - Optional callback for events: onEvent(type, data)
   */
  /**
   * Set context for the message handler (used for payments).
   * Call before listen() to enable paid skill support.
   *
   * @param {object} ctx - { payTo: 'wallet address for receiving USDC' }
   */
  setListenContext(ctx) {
    this._listenContext = { ...(this._listenContext || {}), ...ctx };
  }

  async listen(onEvent) {
    console.log('[skillcrypt] listening for messages...');

    await this.client.conversations.sync();

    const processMessage = async (message) => {
      if (message.senderInboxId === this.client.inboxId) return;

      let text = null;
      if (typeof message.content === 'string') {
        text = message.content;
      } else if (message.content?.text) {
        text = message.content.text;
      } else if (typeof message.content === 'object') {
        try { text = JSON.stringify(message.content); } catch {}
      }

      if (!text) return;

      const parsed = parseMessage(text);
      if (parsed && this.vault) {
        if (onEvent) onEvent('message:in', { type: parsed.type, from: message.senderInboxId });

        const conversation = await this.client.conversations.getConversationById(
          message.conversationId
        );

        await handleMessage(parsed, this.vault, async (response) => {
          await conversation.sendText(response);
          if (onEvent) {
            const resp = JSON.parse(response);
            onEvent('message:out', { type: resp.type });
          }
        }, this._listenContext || {});
      }
    };

    // streamAllMessages misses DMs from new conversations (XMTP SDK bug).
    // Fix: use streamAllGroupMessages for groups + streamAllDmMessages for DMs.
    const groupStream = await this.client.conversations.streamAllGroupMessages();
    (async () => {
      for await (const message of groupStream) {
        try { await processMessage(message); } catch (e) {
          console.error('[skillcrypt] group message error:', e.message);
        }
      }
    })();

    const dmStream = await this.client.conversations.streamAllDmMessages();
    (async () => {
      for await (const message of dmStream) {
        try { await processMessage(message); } catch (e) {
          console.error('[skillcrypt] DM message error:', e.message);
        }
      }
    })();

    // Periodic sync to pick up new DM conversations (XMTP SDK bug workaround).
    // Without this, DMs from agents we've never talked to get dropped.
    setInterval(async () => {
      try { await this.client.conversations.sync(); } catch {}
    }, 5000);

    // Keep alive
    await new Promise(() => {});
  }

  /**
   * Send a skill from the local vault to another agent.
   *
   * @param {string} peerAddress - Recipient wallet address
   * @param {string} skillId - ID of skill in the vault
   */
  async sendSkill(peerAddress, skillId) {
    if (!this.vault) throw new Error('no vault connected');

    const entry = this.vault.manifest.skills[skillId];
    if (!entry) throw new Error(`skill not found: ${skillId}`);

    const content = await this.vault.load(skillId);

    const { buildTransfer } = await import('./transfer.js');
    const { transfer, keyMsg } = buildTransfer({
      skillId,
      name: entry.name,
      content,
      contentHash: entry.contentHash,
      version: entry.version,
      description: entry.description,
      tags: entry.tags
    });

    // Send encrypted payload first, then key separately
    await this.send(peerAddress, transfer);
    await this.send(peerAddress, keyMsg);
    console.log(`[skillcrypt] sent "${entry.name}" to ${peerAddress} (encrypted transfer)`);
  }

  /**
   * Get the connected wallet address.
   *
   * @returns {string}
   */
  getAddress() {
    return this.address;
  }

  /**
   * Check if a peer is reachable on XMTP.
   *
   * @param {string} peerAddress
   * @returns {boolean}
   */
  async canReach(peerAddress) {
    const identifier = {
      identifier: peerAddress.toLowerCase(),
      identifierKind: 0  // Ethereum
    };
    const result = await this.client.canMessage([identifier]);
    return result.get(peerAddress.toLowerCase()) || false;
  }
}
