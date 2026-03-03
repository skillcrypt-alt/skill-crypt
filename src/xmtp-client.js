/**
 * XMTP Client
 *
 * Connects to the XMTP network using the agent's wallet key.
 * Handles sending and receiving skillcrypt protocol messages
 * through end-to-end encrypted conversations.
 *
 * This module wraps the XMTP Node SDK and provides a simple interface
 * for the skill transfer protocol.
 */

import { Client } from '@xmtp/node-sdk';
import { Wallet } from 'ethers';
import { createWalletClient, http, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { join } from 'node:path';
import { parseMessage, handleMessage } from './transfer.js';

/**
 * Create an XMTP signer from a wallet private key.
 *
 * @param {string} privateKeyHex - Wallet private key (hex)
 * @returns {object} XMTP-compatible signer
 */
function createSigner(privateKeyHex) {
  const key = privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`;
  const account = privateKeyToAccount(key);

  return {
    type: 'EOA',
    getIdentifier: () => ({
      identifier: account.address.toLowerCase(),
      identifierKind: 'Ethereum'
    }),
    signMessage: async (message) => {
      const signature = await account.signMessage({ message });
      return toBytes(signature);
    }
  };
}

export class SkillCryptClient {
  /**
   * @param {object} opts
   * @param {string} opts.privateKey - Wallet private key (hex)
   * @param {string} [opts.dbPath] - Directory for XMTP database files
   * @param {string} [opts.env] - XMTP environment: "production" or "dev"
   */
  constructor(opts) {
    this.privateKey = opts.privateKey;
    this.dbPath = opts.dbPath || './data/xmtp';
    this.env = opts.env || 'production';
    this.client = null;
    this.vault = null;
  }

  /**
   * Connect to the XMTP network.
   *
   * @param {SkillVault} vault - Local vault for handling incoming transfers
   */
  async connect(vault) {
    this.vault = vault;
    const signer = createSigner(this.privateKey);
    const address = signer.getIdentifier().identifier;

    // Use deterministic database path to avoid hitting installation limits
    const dbPath = join(this.dbPath, `skillcrypt-${address.slice(0, 8)}.db`);

    this.client = await Client.create(signer, {
      env: this.env,
      dbPath
    });

    console.log(`[skillcrypt] connected as ${address}`);
    return this;
  }

  /**
   * Send a skillcrypt protocol message to another agent.
   *
   * @param {string} peerAddress - Recipient wallet address
   * @param {object} payload - Protocol message object (will be JSON.stringified)
   */
  async send(peerAddress, payload) {
    const canMessage = await this.client.canMessage([peerAddress]);
    if (!canMessage.get(peerAddress.toLowerCase())) {
      throw new Error(`peer not reachable on XMTP: ${peerAddress}`);
    }

    const conversation = await this.client.conversations.newDm(peerAddress);
    await conversation.sendText(JSON.stringify(payload));
  }

  /**
   * Request a skill catalog from another agent.
   *
   * @param {string} peerAddress - Target agent's wallet address
   */
  async requestCatalog(peerAddress) {
    await this.send(peerAddress, {
      type: 'skillcrypt:catalog-request',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Request a specific skill from another agent.
   *
   * @param {string} peerAddress - Target agent's wallet address
   * @param {string} skillId - ID of the skill to request
   */
  async requestSkill(peerAddress, skillId) {
    await this.send(peerAddress, {
      type: 'skillcrypt:skill-request',
      skillId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Start listening for incoming skillcrypt messages.
   * Processes catalog requests, skill requests, and incoming transfers.
   *
   * @param {function} [onMessage] - Optional callback for non-protocol messages
   */
  async listen(onMessage) {
    console.log('[skillcrypt] listening for incoming messages');

    await this.client.conversations.sync();
    const stream = this.client.conversations.streamAllMessages();

    for await (const message of stream) {
      // skip our own messages
      if (message.senderInboxId === this.client.inboxId) continue;

      const text = message.content;
      if (typeof text !== 'string') continue;

      const parsed = parseMessage(text);
      if (parsed && this.vault) {
        const conversation = await this.client.conversations.getConversationById(
          message.conversationId
        );
        await handleMessage(parsed, this.vault, async (response) => {
          await conversation.sendText(response);
        });
      } else if (onMessage) {
        onMessage(message);
      }
    }
  }

  /**
   * Get the agent's wallet address.
   *
   * @returns {string}
   */
  getAddress() {
    if (!this.client) throw new Error('not connected');
    return this.client.accountAddress;
  }

  /**
   * Check if a peer address is reachable on XMTP.
   *
   * @param {string} peerAddress
   * @returns {boolean}
   */
  async canReach(peerAddress) {
    const result = await this.client.canMessage([peerAddress]);
    return result.get(peerAddress.toLowerCase()) || false;
  }

  /**
   * Disconnect from the XMTP network.
   */
  async disconnect() {
    // XMTP Node SDK handles cleanup on process exit
    this.client = null;
    console.log('[skillcrypt] disconnected');
  }
}
