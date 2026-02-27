import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, encrypt, decrypt, hashContent } from '../src/crypto.js';

const TEST_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('crypto', () => {
  it('derives a consistent 32-byte key from the same private key', () => {
    const key1 = deriveKey(TEST_KEY);
    const key2 = deriveKey(TEST_KEY);
    assert.deepStrictEqual(key1, key2);
    assert.strictEqual(key1.length, 32);
  });

  it('derives different keys from different private keys', () => {
    const key1 = deriveKey(TEST_KEY);
    const key2 = deriveKey('0x' + '1'.repeat(64));
    assert.notDeepStrictEqual(key1, key2);
  });

  it('handles 0x prefix on private key', () => {
    const key1 = deriveKey(TEST_KEY);
    const key2 = deriveKey('0x' + TEST_KEY);
    assert.deepStrictEqual(key1, key2);
  });

  it('round-trips skill content through encrypt and decrypt', () => {
    const key = deriveKey(TEST_KEY);
    const skill = '# Weather Skill\n\nFetch current weather for any city.\n\n## Steps\n1. Parse location\n2. Query API\n3. Format response';
    const encrypted = encrypt(skill, key);
    const decrypted = decrypt(encrypted, key);
    assert.strictEqual(decrypted, skill);
  });

  it('produces different ciphertext each time due to random IV', () => {
    const key = deriveKey(TEST_KEY);
    const skill = 'same content, different ciphertext';
    const enc1 = encrypt(skill, key);
    const enc2 = encrypt(skill, key);
    assert.notDeepStrictEqual(enc1, enc2);
  });

  it('rejects decryption with the wrong key', () => {
    const key1 = deriveKey(TEST_KEY);
    const key2 = deriveKey('0x' + '2'.repeat(64));
    const encrypted = encrypt('secret skill instructions', key1);
    assert.throws(() => decrypt(encrypted, key2));
  });

  it('detects tampered ciphertext', () => {
    const key = deriveKey(TEST_KEY);
    const encrypted = encrypt('tamper test', key);
    encrypted[encrypted.length - 1] ^= 0xff;
    assert.throws(() => decrypt(encrypted, key));
  });

  it('produces deterministic content hashes', () => {
    const h1 = hashContent('hello world');
    const h2 = hashContent('hello world');
    assert.strictEqual(h1, h2);
    assert.ok(h1.startsWith('sha256:'));
  });

  it('produces different hashes for different content', () => {
    const h1 = hashContent('skill A');
    const h2 = hashContent('skill B');
    assert.notStrictEqual(h1, h2);
  });
});
