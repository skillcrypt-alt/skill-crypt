/**
 * Skill Share Oracle
 *
 * The oracle wallet owns the canonical Skill Share group.
 * It creates the group, manages membership, and validates
 * join requests. Agents discover the group ID from config
 * and request access. The oracle adds them after confirming
 * they are reachable on XMTP (proof of identity).
 *
 * This keeps the group secure: only the oracle can add members,
 * and only verified XMTP identities get in.
 */

import { SkillCryptClient } from './xmtp-client.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { emit } from './events.js';

const JOIN_REQUEST_TYPE = 'skillcrypt:join-request';
const JOIN_APPROVED_TYPE = 'skillcrypt:join-approved';
const JOIN_DENIED_TYPE = 'skillcrypt:join-denied';

export class SkillShareOracle {
  /**
   * @param {object} opts
   * @param {string} opts.privateKey - Oracle wallet private key
   * @param {string} [opts.dataDir] - Persistence directory
   * @param {string} [opts.env] - XMTP environment
   * @param {string} [opts.groupName] - Group display name
   */
  constructor(opts) {
    this.privateKey = opts.privateKey;
    this.dataDir = opts.dataDir || './data/oracle';
    this.env = opts.env || 'dev';
    this.groupName = opts.groupName || 'Skill Share';
    this.client = null;
    this.group = null;
    this.groupId = null;
    this.members = new Set();
    this.statePath = join(this.dataDir, 'oracle-state.json');
  }

  /**
   * Connect the oracle to XMTP.
   */
  async connect() {
    this.client = new SkillCryptClient({
      privateKey: this.privateKey,
      dbDir: join(this.dataDir, 'xmtp'),
      env: this.env
    });
    await this.client.connect();
    await this._loadState();
    return this;
  }

  /**
   * Create the canonical Skill Share group.
   * Only needs to run once. Persists the group ID.
   */
  async createGroup() {
    if (this.groupId) {
      console.log(`[oracle] group already exists: ${this.groupId}`);
      return this.groupId;
    }

    const group = await this.client.client.conversations.createGroup([], {
      name: this.groupName,
      description: 'skill-crypt shared discovery group. managed by oracle.'
    });

    this.group = group;
    this.groupId = group.id;
    await this._saveState();

    console.log(`[oracle] created group: ${this.groupId}`);
    emit('oracle:group-created', { groupId: this.groupId });

    return this.groupId;
  }

  /**
   * Resume an existing group from saved state.
   */
  async resumeGroup() {
    if (!this.groupId) {
      throw new Error('no group ID in state -- run createGroup first');
    }

    await this.client.client.conversations.sync();
    this.group = await this.client.client.conversations.getConversationById(this.groupId);

    if (!this.group) {
      throw new Error(`group not found: ${this.groupId}`);
    }

    console.log(`[oracle] resumed group: ${this.groupId}`);
    return this.groupId;
  }

  /**
   * Add an agent to the group by wallet address.
   * Validates they are reachable on XMTP first.
   *
   * @param {string} address - Agent wallet address
   * @returns {boolean} true if added, false if unreachable
   */
  async addMember(address) {
    const addr = address.toLowerCase();

    if (this.members.has(addr)) {
      console.log(`[oracle] ${addr} already a member`);
      return true;
    }

    // validate: must be reachable on XMTP
    const reachable = await this.client.canReach(addr);
    if (!reachable) {
      console.log(`[oracle] rejected ${addr} -- not reachable on XMTP`);
      emit('oracle:join-denied', { address: addr, reason: 'not reachable on XMTP' });
      return false;
    }

    // resolve inbox ID (required for XMTP group add -- direct address add is broken)
    const { getInboxIdForIdentifier } = await import('@xmtp/node-sdk');
    const inboxId = await getInboxIdForIdentifier(
      { identifier: addr, identifierKind: 0 },
      this.env === 'dev' ? 'dev' : 'production'
    );

    if (!inboxId) {
      console.log(`[oracle] rejected ${addr} -- no inbox ID`);
      emit('oracle:join-denied', { address: addr, reason: 'no XMTP inbox' });
      return false;
    }

    await this.group.addMembers([inboxId]);
    this.members.add(addr);
    await this._saveState();

    console.log(`[oracle] added ${addr} to group`);
    emit('oracle:member-added', { address: addr, groupId: this.groupId });
    return true;
  }

  /**
   * Listen for DM join requests and process them.
   * Agents send a join-request DM to the oracle address.
   * Oracle validates and adds them to the group.
   *
   * @param {object} [opts]
   * @param {function} [opts.onEvent] - Event callback
   * @param {function} [opts.approvalFn] - Custom approval function(address) => boolean.
   *                                       If not set, all reachable XMTP agents are approved.
   */
  async listen(opts = {}) {
    console.log(`[oracle] listening for join requests...`);
    console.log(`[oracle] group: ${this.groupId}`);
    console.log(`[oracle] address: ${this.client.getAddress()}`);

    await this.client.client.conversations.sync();
    const stream = await this.client.client.conversations.streamAllMessages();

    for await (const message of stream) {
      if (message.senderInboxId === this.client.client.inboxId) continue;

      let text = null;
      if (typeof message.content === 'string') {
        text = message.content;
      } else if (message.content?.text) {
        text = message.content.text;
      }
      if (!text) continue;

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }

      if (parsed.type !== JOIN_REQUEST_TYPE) continue;

      const requesterAddress = parsed.address?.toLowerCase();
      if (!requesterAddress) continue;

      console.log(`[oracle] join request from ${requesterAddress}`);
      emit('oracle:join-request', { address: requesterAddress });

      if (opts.onEvent) opts.onEvent('join-request', { address: requesterAddress });

      // custom approval gate if provided
      if (opts.approvalFn) {
        const approved = await opts.approvalFn(requesterAddress);
        if (!approved) {
          await this._respond(message.conversationId, {
            type: JOIN_DENIED_TYPE,
            reason: 'not approved',
            timestamp: new Date().toISOString()
          });
          continue;
        }
      }

      const added = await this.addMember(requesterAddress);

      const conversation = await this.client.client.conversations.getConversationById(
        message.conversationId
      );

      if (added) {
        await conversation.sendText(JSON.stringify({
          type: JOIN_APPROVED_TYPE,
          groupId: this.groupId,
          timestamp: new Date().toISOString()
        }));
        if (opts.onEvent) opts.onEvent('join-approved', { address: requesterAddress });
      } else {
        await conversation.sendText(JSON.stringify({
          type: JOIN_DENIED_TYPE,
          reason: 'XMTP identity validation failed',
          timestamp: new Date().toISOString()
        }));
        if (opts.onEvent) opts.onEvent('join-denied', { address: requesterAddress });
      }
    }
  }

  /**
   * Get oracle status.
   */
  getStatus() {
    return {
      address: this.client?.getAddress(),
      groupId: this.groupId,
      memberCount: this.members.size,
      members: [...this.members],
      env: this.env
    };
  }

  async _respond(conversationId, payload) {
    const conv = await this.client.client.conversations.getConversationById(conversationId);
    if (conv) {
      await conv.sendText(JSON.stringify(payload));
    }
  }

  async _saveState() {
    await mkdir(this.dataDir, { recursive: true });
    const state = {
      groupId: this.groupId,
      members: [...this.members],
      groupName: this.groupName
    };
    await writeFile(this.statePath, JSON.stringify(state, null, 2));
  }

  async _loadState() {
    try {
      const raw = await readFile(this.statePath, 'utf8');
      const state = JSON.parse(raw);
      this.groupId = state.groupId || null;
      this.members = new Set(state.members || []);
      this.groupName = state.groupName || this.groupName;
    } catch {
      // fresh state
    }
  }
}

/**
 * Build a join request message to send to the oracle.
 *
 * @param {string} address - Your wallet address
 * @param {string} [agentName] - Optional display name
 * @returns {object} Protocol message
 */
export function buildJoinRequest(address, agentName) {
  return {
    type: JOIN_REQUEST_TYPE,
    address: address.toLowerCase(),
    name: agentName || 'anonymous',
    timestamp: new Date().toISOString()
  };
}
