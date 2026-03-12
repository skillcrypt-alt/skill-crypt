/**
 * XMTP Vault
 *
 * Skills live inside the agent's XMTP inbox, not on disk.
 * The agent has a private XMTP group (only itself as member)
 * that stores encrypted skill messages. Loading a skill means
 * querying your own messages and decrypting into memory.
 *
 * No .enc files. No vault directory. No plaintext manifest on disk.
 * The wallet key is the vault.
 */

import { encrypt, decrypt, hashContent, deriveKey } from './crypto.js';
import { emit } from './events.js';

const VAULT_GROUP_NAME = 'skillcrypt:vault';

export class XMTPVault {
  /**
   * @param {object} opts
   * @param {import('@xmtp/node-sdk').Client} opts.client - Connected XMTP client
   * @param {string} opts.privateKey - Wallet private key for encryption
   */
  constructor(opts) {
    this.client = opts.client;
    this.key = deriveKey(opts.privateKey);
    this.group = null;

    // In-memory manifest rebuilt from XMTP messages on sync
    this.manifest = { version: 2, skills: {} };
  }

  /**
   * Initialize the vault. Creates or finds the private vault group,
   * then syncs the manifest from message history.
   */
  async init() {
    await this.client.conversations.sync();
    const convos = await this.client.conversations.list();

    // Find existing vault group
    for (const c of convos) {
      try {
        if (typeof c.name === 'function') {
          const name = c.name();
          if (name === VAULT_GROUP_NAME) {
            this.group = c;
            break;
          }
        } else if (c.name === VAULT_GROUP_NAME) {
          this.group = c;
          break;
        }
        // Also check via metadata/groupName
        const meta = c.groupName || c.metadata?.name;
        if (meta === VAULT_GROUP_NAME) {
          this.group = c;
          break;
        }
      } catch {}
    }

    if (!this.group) {
      // Create a private group with only ourselves
      this.group = await this.client.conversations.createGroup([], {
        name: VAULT_GROUP_NAME,
        description: 'skill-crypt encrypted skill vault'
      });
      emit('vault:created', { groupId: this.group.id });
    }

    // Rebuild manifest from message history
    await this._syncManifest();
  }

  /**
   * Encrypt and store a skill as an XMTP message in the vault group.
   *
   * @param {string} name - Skill name
   * @param {string} content - Plaintext skill content
   * @param {object} meta - Optional: description, tags, version
   * @returns {string} Skill ID (message-based)
   */
  async store(name, content, meta = {}) {
    const encrypted = encrypt(content, this.key);
    const contentHash = hashContent(content);

    const envelope = {
      type: 'skillcrypt:vault-entry',
      name,
      version: meta.version || '1.0.0',
      description: meta.description || '',
      tags: meta.tags || [],
      contentHash,
      size: content.length,
      // Encrypted content as base64 (the XMTP message itself is also E2E encrypted)
      payload: encrypted.toString('base64'),
      storedAt: new Date().toISOString()
    };

    await this.group.sync();
    await this.group.sendText(JSON.stringify(envelope));

    // Add to in-memory manifest
    const skillId = contentHash; // use content hash as ID (deduplicates)
    this.manifest.skills[skillId] = {
      name,
      version: envelope.version,
      description: envelope.description,
      tags: envelope.tags,
      contentHash,
      size: content.length,
      storedAt: envelope.storedAt
    };

    emit('vault:stored', { name, skillId, size: content.length });
    return skillId;
  }

  /**
   * Decrypt and return a skill's content from the vault.
   * Searches XMTP messages for the matching skill, decrypts into memory.
   *
   * @param {string} skillId - Skill ID (content hash)
   * @returns {string} Decrypted skill content
   */
  async load(skillId) {
    const entry = this.manifest.skills[skillId];
    if (!entry) throw new Error(`skill not found: ${skillId}`);

    await this.group.sync();
    const messages = await this.group.messages();

    // Find the message with matching content hash
    for (const msg of messages) {
      if (msg.senderInboxId !== this.client.inboxId) continue;
      let text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
      if (!text) continue;

      try {
        const envelope = JSON.parse(text);
        if (envelope.type !== 'skillcrypt:vault-entry') continue;
        if (envelope.contentHash !== skillId) continue;

        const payload = Buffer.from(envelope.payload, 'base64');
        const content = decrypt(payload, this.key);

        // Verify integrity
        const hash = hashContent(content);
        if (hash !== envelope.contentHash) {
          throw new Error(`integrity check failed for ${entry.name}`);
        }

        emit('vault:loaded', { name: entry.name, skillId, size: content.length });
        return content;
      } catch (e) {
        if (e.message.includes('integrity check')) throw e;
        // Not a vault entry or parse error, skip
      }
    }

    throw new Error(`skill content not found in XMTP messages: ${skillId}`);
  }

  /**
   * List all skills in the vault. Returns metadata only, never content.
   */
  list() {
    return Object.entries(this.manifest.skills).map(([id, meta]) => ({
      skillId: id,
      ...meta
    }));
  }

  /**
   * Search skills by name, tag, or description.
   */
  find(query) {
    const q = query.toLowerCase();
    return this.list().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q)) ||
      s.description.toLowerCase().includes(q)
    );
  }

  /**
   * Remove a skill from the vault.
   * Since XMTP messages can't be deleted from history, we post a
   * tombstone message that marks the skill as removed. The manifest
   * rebuild skips tombstoned skills.
   */
  async remove(skillId) {
    const entry = this.manifest.skills[skillId];
    if (!entry) return;

    const tombstone = {
      type: 'skillcrypt:vault-tombstone',
      contentHash: skillId,
      name: entry.name,
      removedAt: new Date().toISOString()
    };

    await this.group.sync();
    await this.group.sendText(JSON.stringify(tombstone));

    delete this.manifest.skills[skillId];
    emit('vault:removed', { name: entry.name, skillId });
  }

  /**
   * Re-encrypt all skills with a new wallet key.
   * Reads each skill, decrypts with old key, re-encrypts with new key,
   * and posts the new version. Old versions remain as dead messages
   * (unreadable with the new key, tombstoned in manifest).
   */
  async rotateKey(newPrivateKeyHex) {
    const newKey = deriveKey(newPrivateKeyHex);
    const skills = this.list();
    const failed = [];
    let rotated = 0;

    for (const skill of skills) {
      try {
        // Decrypt with current key
        const content = await this.load(skill.skillId);

        // Tombstone the old entry
        await this.remove(skill.skillId);

        // Re-encrypt with new key and store
        const encrypted = encrypt(content, newKey);
        const envelope = {
          type: 'skillcrypt:vault-entry',
          name: skill.name,
          version: skill.version,
          description: skill.description,
          tags: skill.tags,
          contentHash: skill.contentHash,
          size: content.length,
          payload: encrypted.toString('base64'),
          storedAt: new Date().toISOString(),
          rotatedFrom: skill.skillId
        };

        await this.group.sync();
        await this.group.sendText(JSON.stringify(envelope));

        rotated++;
      } catch (err) {
        failed.push(skill.skillId);
      }
    }

    // Switch to new key
    this.key = newKey;

    // Rebuild manifest with new key
    await this._syncManifest();

    return { rotated, failed };
  }

  /**
   * Rebuild the in-memory manifest from XMTP message history.
   * Processes vault-entry and vault-tombstone messages in order.
   */
  async _syncManifest() {
    this.manifest = { version: 2, skills: {} };
    const tombstones = new Set();

    await this.group.sync();
    const messages = await this.group.messages();

    // Process in chronological order (messages come newest first)
    const ordered = [...messages].reverse();

    for (const msg of ordered) {
      if (msg.senderInboxId !== this.client.inboxId) continue;
      let text = typeof msg.content === 'string' ? msg.content : msg.content?.text;
      if (!text) continue;

      try {
        const envelope = JSON.parse(text);

        if (envelope.type === 'skillcrypt:vault-tombstone') {
          tombstones.add(envelope.contentHash);
          delete this.manifest.skills[envelope.contentHash];
          continue;
        }

        if (envelope.type !== 'skillcrypt:vault-entry') continue;
        if (tombstones.has(envelope.contentHash)) continue;

        this.manifest.skills[envelope.contentHash] = {
          name: envelope.name,
          version: envelope.version,
          description: envelope.description,
          tags: envelope.tags,
          contentHash: envelope.contentHash,
          size: envelope.size,
          storedAt: envelope.storedAt
        };
      } catch {
        // Not a vault message, skip
      }
    }

    emit('vault:synced', { skillCount: Object.keys(this.manifest.skills).length });
  }
}
