/**
 * Key Guard — device-bound encryption + IP whitelist for wallet keys.
 *
 * Two layers:
 *   1. Key encrypted at rest with AES-256-GCM, derived from machine-id + salt via scrypt
 *   2. All decrypt operations gated by IP whitelist (private ranges only)
 *
 * Nothing in the codebase touches the raw key except through this guard.
 */

import {
  scryptSync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID
} from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Wallet } from 'ethers';

const ALGORITHM = 'aes-256-gcm';
const SALT_FILE = '.key-salt';
const ENCRYPTED_KEY_FILE = '.wallet-key.enc';
const PLAINTEXT_KEY_FILE = '.wallet-key';
const ACCESS_LOG_FILE = 'key-access.log';

export class KeyGuard {
  /**
   * @param {string} dataDir — where encrypted key + salt live
   * @param {string[]} [allowedIPs] — extra IPs beyond private ranges
   */
  constructor(dataDir, allowedIPs = []) {
    this.dataDir = dataDir;
    this.allowedIPs = new Set(allowedIPs);
    this.logPath = join(dataDir, ACCESS_LOG_FILE);

    mkdirSync(dataDir, { recursive: true });

    // auto-migrate plaintext key on load
    this._migrateIfNeeded();
  }

  /**
   * Check if an IP is allowed (private range or explicitly whitelisted).
   */
  isAllowedIP(ip) {
    if (!ip) return false;
    const clean = ip.replace(/^::ffff:/, '');
    if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
    if (this.allowedIPs.has(clean)) return true;

    const parts = clean.split('.').map(Number);
    if (parts.length !== 4) return false;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    return false;
  }

  /**
   * Derive a device-bound encryption key from machine-id + random salt.
   * Same device + same salt = same key. Different device = different key.
   */
  _getEncryptionKey() {
    let machineId;
    try {
      machineId = readFileSync('/etc/machine-id', 'utf8').trim();
    } catch {
      try {
        machineId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      } catch {
        machineId = require('os').hostname();
      }
    }

    const saltPath = join(this.dataDir, SALT_FILE);
    let salt;
    if (existsSync(saltPath)) {
      salt = readFileSync(saltPath, 'utf8').trim();
    } else {
      salt = randomBytes(32).toString('hex');
      writeFileSync(saltPath, salt, { mode: 0o600 });
    }

    return scryptSync(machineId + salt, 'skillcrypt-key-guard', 32);
  }

  /**
   * Encrypt a private key and store it.
   */
  _encrypt(privateKey) {
    const key = this._getEncryptionKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    const encPath = join(this.dataDir, ENCRYPTED_KEY_FILE);
    writeFileSync(encPath, JSON.stringify({
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted
    }), { mode: 0o600 });

    return true;
  }

  /**
   * Decrypt and return the private key. Returns null if no key exists.
   */
  _decrypt() {
    const encPath = join(this.dataDir, ENCRYPTED_KEY_FILE);
    if (!existsSync(encPath)) return null;

    const { iv, tag, data } = JSON.parse(readFileSync(encPath, 'utf8'));
    const key = this._getEncryptionKey();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Migrate plaintext .wallet-key → encrypted .wallet-key.enc
   * Securely overwrites and deletes the plaintext file.
   */
  _migrateIfNeeded() {
    const plainPath = join(this.dataDir, PLAINTEXT_KEY_FILE);
    const encPath = join(this.dataDir, ENCRYPTED_KEY_FILE);

    if (existsSync(plainPath) && !existsSync(encPath)) {
      const key = readFileSync(plainPath, 'utf8').trim();
      if (key) {
        this._encrypt(key);
        // overwrite with zeros then delete
        writeFileSync(plainPath, '0'.repeat(key.length), { mode: 0o600 });
        unlinkSync(plainPath);
        this._log('migrate', 'OK', 'migrated plaintext key to encrypted storage');
      }
    }
  }

  /**
   * Check if an encrypted key exists.
   */
  hasKey() {
    return existsSync(join(this.dataDir, ENCRYPTED_KEY_FILE));
  }

  /**
   * Read the private key (decrypts from disk). IP-gated.
   *
   * @param {string} [callerIP='127.0.0.1'] — IP of the caller
   * @param {string} [reason='wallet-operation'] — audit trail reason
   * @returns {string|null} Private key hex, or null if none stored
   */
  readKey(callerIP = '127.0.0.1', reason = 'wallet-operation') {
    if (!this.isAllowedIP(callerIP)) {
      this._log('read', 'BLOCKED', `non-private IP: ${callerIP}, reason: ${reason}`);
      throw new Error('key access denied: non-private IP');
    }

    const key = this._decrypt();
    if (!key) return null;

    this._log('read', 'OK', `reason: ${reason}, ip: ${callerIP}`);
    return key;
  }

  /**
   * Store a private key (encrypts to disk). IP-gated.
   *
   * @param {string} privateKey — hex private key (with or without 0x prefix)
   * @param {string} [callerIP='127.0.0.1']
   */
  storeKey(privateKey, callerIP = '127.0.0.1') {
    if (!this.isAllowedIP(callerIP)) {
      this._log('store', 'BLOCKED', `non-private IP: ${callerIP}`);
      throw new Error('key store denied: non-private IP');
    }

    this._encrypt(privateKey);
    this._log('store', 'OK', `ip: ${callerIP}`);
    return true;
  }

  /**
   * Generate a fresh wallet, encrypt the key, return the address.
   * The private key never touches disk in plaintext.
   *
   * @param {string} [callerIP='127.0.0.1']
   * @returns {{ address: string }} Wallet address (key is stored encrypted)
   */
  generateAndStore(callerIP = '127.0.0.1') {
    if (!this.isAllowedIP(callerIP)) {
      this._log('generate', 'BLOCKED', `non-private IP: ${callerIP}`);
      throw new Error('key generation denied: non-private IP');
    }

    const wallet = Wallet.createRandom();
    this._encrypt(wallet.privateKey);
    this._log('generate', 'OK', `address: ${wallet.address}, ip: ${callerIP}`);

    return { address: wallet.address };
  }

  /**
   * Rotate the encrypted key. Decrypts old, re-encrypts with new device key.
   * Useful after machine-id changes (new device, re-image, etc).
   *
   * @param {string} newPrivateKey — new wallet private key
   * @param {string} [callerIP='127.0.0.1']
   */
  rotateKey(newPrivateKey, callerIP = '127.0.0.1') {
    if (!this.isAllowedIP(callerIP)) {
      this._log('rotate', 'BLOCKED', `non-private IP: ${callerIP}`);
      throw new Error('key rotation denied: non-private IP');
    }

    this._encrypt(newPrivateKey);
    this._log('rotate', 'OK', `ip: ${callerIP}`);
    return true;
  }

  /**
   * Append to access log.
   */
  _log(action, result, detail = '') {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      action,
      result,
      detail
    }) + '\n';
    try { appendFileSync(this.logPath, line); } catch {}
  }
}

/**
 * Load wallet key through the guard.
 * Falls back to SKILLCRYPT_WALLET_KEY env var for backwards compat,
 * but encrypts it on first use (migration).
 *
 * @param {string} dataDir — data directory
 * @returns {{ key: string, guard: KeyGuard }}
 */
export function loadKeyGuarded(dataDir) {
  const guard = new KeyGuard(dataDir);

  // if env var is set and no encrypted key exists, migrate it
  const envKey = process.env.SKILLCRYPT_WALLET_KEY;
  if (envKey && !guard.hasKey()) {
    guard.storeKey(envKey);
  }

  const key = guard.readKey('127.0.0.1', 'cli-startup');
  if (!key) {
    throw new Error(
      'no wallet key found. run: skill-crypt init\n' +
      'or set SKILLCRYPT_WALLET_KEY environment variable'
    );
  }

  return { key, guard };
}
