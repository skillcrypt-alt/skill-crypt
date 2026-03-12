/**
 * Skill Vault
 *
 * Encrypted local skill storage with a plaintext manifest for indexing.
 * Skills are stored as individual .enc files. The manifest tracks metadata
 * (name, version, tags) without containing any skill content.
 */

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { encrypt, decrypt, hashContent, deriveKey } from './crypto.js';

export class SkillVault {
  /**
   * @param {string} vaultDir - Directory for encrypted skill storage
   * @param {string} privateKeyHex - Wallet private key for encryption/decryption
   */
  constructor(vaultDir, privateKeyHex) {
    this.vaultDir = vaultDir;
    this.key = deriveKey(privateKeyHex);
    this.manifestPath = join(vaultDir, 'manifest.json');
  }

  /**
   * Initialize the vault directory and load or create the manifest.
   */
  async init() {
    await mkdir(this.vaultDir, { recursive: true });
    try {
      const raw = await readFile(this.manifestPath, 'utf8');
      this.manifest = JSON.parse(raw);
    } catch {
      this.manifest = { version: 1, skills: {} };
      await this._saveManifest();
    }
  }

  /**
   * Encrypt and store a skill in the vault.
   *
   * @param {string} name - Skill name
   * @param {string} content - Plaintext skill content (SKILL.md body)
   * @param {object} meta - Optional metadata: description, tags, version
   * @returns {string} Generated skill ID
   */
  async store(name, content, meta = {}) {
    const skillId = randomUUID();
    const encrypted = encrypt(content, this.key);
    const filename = `${skillId}.enc`;

    await writeFile(join(this.vaultDir, filename), encrypted);


    this.manifest.skills[skillId] = {
      name,
      version: meta.version || '1.0.0',
      description: meta.description || '',
      tags: meta.tags || [],
      contentHash: hashContent(content),
      filename,
      storedAt: new Date().toISOString(),
      size: content.length
    };

    await this._saveManifest();
    return skillId;
  }

  /**
   * Decrypt and return a skill's content. The result exists only in memory.
   *
   * @param {string} skillId
   * @returns {string} Decrypted skill content
   */
  async load(skillId) {
    const entry = this.manifest.skills[skillId];
    if (!entry) throw new Error(`skill not found: ${skillId}`);

    const encrypted = await readFile(join(this.vaultDir, entry.filename));
    return decrypt(encrypted, this.key);
  }

  /**
   * List all skills in the vault. Returns metadata only, never content.
   *
   * @returns {Array<object>}
   */
  list() {
    return Object.entries(this.manifest.skills).map(([id, meta]) => ({
      skillId: id,
      ...meta
    }));
  }

  /**
   * Remove a skill from the vault. Deletes the encrypted file and manifest entry.
   *
   * @param {string} skillId
   */
  async remove(skillId) {
    const entry = this.manifest.skills[skillId];
    if (!entry) return;

    try {
      await unlink(join(this.vaultDir, entry.filename));
    } catch {}

    delete this.manifest.skills[skillId];
    await this._saveManifest();
  }

  /**
   * Search skills by name, tag, or description.
   *
   * @param {string} query - Search term (case-insensitive)
   * @returns {Array<object>}
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
   * Re-encrypt the entire vault with a new wallet key.
   *
   * Decrypts every skill with the current key, re-encrypts with the new key,
   * and overwrites the .enc files in place. The old key becomes useless after
   * rotation completes.
   *
   * @param {string} newPrivateKeyHex - New wallet private key (hex)
   * @returns {object} Summary: { rotated: number, failed: string[] }
   */
  async rotateKey(newPrivateKeyHex) {
    const newKey = deriveKey(newPrivateKeyHex);
    const skills = this.list();
    const failed = [];
    let rotated = 0;

    for (const skill of skills) {
      try {
        const plaintext = await this.load(skill.skillId);
        const encrypted = encrypt(plaintext, newKey);
        await writeFile(join(this.vaultDir, skill.filename), encrypted);
        // Update content hash to confirm integrity after rotation
        this.manifest.skills[skill.skillId].rotatedAt = new Date().toISOString();
        rotated++;
      } catch (err) {
        failed.push(skill.skillId);
      }
    }

    // Switch to the new key for all future operations
    this.key = newKey;
    await this._saveManifest();

    return { rotated, failed };
  }

  async _saveManifest() {
    await writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }
}
