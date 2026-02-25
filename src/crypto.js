/**
 * skill-crypt core encryption
 *
 * AES-256-GCM with wallet-derived keys via HKDF-SHA256.
 * Zero external dependencies. Uses only Node.js built-in crypto.
 */

import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'skillcrypt-v1';
const INFO = 'skill-encryption';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derive a 256-bit AES key from a wallet private key.
 *
 * Uses HKDF-SHA256 with a fixed salt and info string.
 * Same wallet key always produces the same encryption key.
 *
 * @param {string} privateKeyHex - Wallet private key (hex, with or without 0x prefix)
 * @returns {Buffer} 32-byte AES key
 */
export function deriveKey(privateKeyHex) {
  const keyBytes = Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex');
  return Buffer.from(hkdfSync('sha256', keyBytes, SALT, INFO, 32));
}

/**
 * Encrypt plaintext skill content.
 *
 * Output format: [IV: 16 bytes][Auth Tag: 16 bytes][Ciphertext]
 * Each call generates a random IV, so the same input produces different output.
 *
 * @param {string} plaintext - Skill content to encrypt
 * @param {Buffer} key - 32-byte AES key from deriveKey()
 * @returns {Buffer} Encrypted payload
 */
export function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypt an encrypted skill payload.
 *
 * Throws if the key is wrong or the data has been tampered with.
 *
 * @param {Buffer} payload - Output from encrypt()
 * @param {Buffer} key - 32-byte AES key from deriveKey()
 * @returns {string} Decrypted plaintext
 */
export function decrypt(payload, key) {
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Compute a SHA-256 content hash for integrity verification.
 *
 * @param {string} content - Content to hash
 * @returns {string} Hash in format "sha256:<hex>"
 */
export function hashContent(content) {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}
