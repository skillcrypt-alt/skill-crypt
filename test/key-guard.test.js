import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KeyGuard, loadKeyGuarded } from '../src/key-guard.js';

describe('KeyGuard', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'keyguard-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('generates and stores a key', () => {
    const guard = new KeyGuard(dir);
    assert.ok(!guard.hasKey());
    const { address } = guard.generateAndStore();
    assert.ok(guard.hasKey());
    assert.ok(address.startsWith('0x'));
    assert.ok(existsSync(join(dir, '.wallet-key.enc')));
    assert.ok(existsSync(join(dir, '.key-salt')));
  });

  it('encrypts and decrypts round-trip', () => {
    const guard = new KeyGuard(dir);
    const testKey = '0x' + 'ab'.repeat(32);
    guard.storeKey(testKey);
    const recovered = guard.readKey('127.0.0.1', 'test');
    assert.equal(recovered, testKey);
  });

  it('blocks non-private IPs on read', () => {
    const guard = new KeyGuard(dir);
    guard.storeKey('0x' + 'cd'.repeat(32));
    assert.throws(
      () => guard.readKey('8.8.8.8', 'test'),
      /non-private IP/
    );
  });

  it('blocks non-private IPs on store', () => {
    const guard = new KeyGuard(dir);
    assert.throws(
      () => guard.storeKey('0x' + 'ef'.repeat(32), '1.2.3.4'),
      /non-private IP/
    );
  });

  it('blocks non-private IPs on generate', () => {
    const guard = new KeyGuard(dir);
    assert.throws(
      () => guard.generateAndStore('203.0.113.1'),
      /non-private IP/
    );
  });

  it('allows private IPs', () => {
    const guard = new KeyGuard(dir);
    const testKey = '0x' + 'aa'.repeat(32);

    // 10.x.x.x
    guard.storeKey(testKey, '10.0.0.5');
    assert.equal(guard.readKey('10.0.0.5'), testKey);

    // 192.168.x.x
    assert.equal(guard.readKey('192.168.1.100'), testKey);

    // 172.16-31.x.x
    assert.equal(guard.readKey('172.16.0.1'), testKey);

    // localhost
    assert.equal(guard.readKey('127.0.0.1'), testKey);

    // ::1 (IPv6 loopback)
    assert.equal(guard.readKey('::1'), testKey);
  });

  it('allows explicitly whitelisted IPs', () => {
    const guard = new KeyGuard(dir, ['8.8.8.8']);
    const testKey = '0x' + 'bb'.repeat(32);
    guard.storeKey(testKey, '8.8.8.8');
    assert.equal(guard.readKey('8.8.8.8'), testKey);
  });

  it('migrates plaintext key on construction', () => {
    // write a plaintext key file before creating the guard
    const testKey = '0x' + 'dd'.repeat(32);
    writeFileSync(join(dir, '.wallet-key'), testKey, { mode: 0o600 });

    const guard = new KeyGuard(dir);
    assert.ok(guard.hasKey());
    assert.ok(!existsSync(join(dir, '.wallet-key')), 'plaintext should be deleted');
    assert.equal(guard.readKey(), testKey);
  });

  it('writes access log', () => {
    const guard = new KeyGuard(dir);
    guard.storeKey('0x' + 'ee'.repeat(32));
    guard.readKey('127.0.0.1', 'test-reason');

    try { guard.readKey('8.8.8.8'); } catch {}

    const log = readFileSync(join(dir, 'key-access.log'), 'utf8');
    const lines = log.trim().split('\n').map(l => JSON.parse(l));
    assert.ok(lines.some(l => l.action === 'store' && l.result === 'OK'));
    assert.ok(lines.some(l => l.action === 'read' && l.result === 'OK'));
    assert.ok(lines.some(l => l.action === 'read' && l.result === 'BLOCKED'));
  });

  it('rotates key', () => {
    const guard = new KeyGuard(dir);
    const oldKey = '0x' + 'aa'.repeat(32);
    const newKey = '0x' + 'bb'.repeat(32);
    guard.storeKey(oldKey);
    assert.equal(guard.readKey(), oldKey);

    guard.rotateKey(newKey);
    assert.equal(guard.readKey(), newKey);
  });

  it('returns null when no key exists', () => {
    const guard = new KeyGuard(dir);
    assert.equal(guard.readKey(), null);
  });
});

describe('loadKeyGuarded', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'keyguard-load-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SKILLCRYPT_WALLET_KEY;
  });

  it('migrates env var and returns key', () => {
    const testKey = '0x' + 'ff'.repeat(32);
    process.env.SKILLCRYPT_WALLET_KEY = testKey;
    const { key, guard } = loadKeyGuarded(dir);
    assert.equal(key, testKey);
    assert.ok(guard.hasKey());
  });

  it('throws when no key available', () => {
    delete process.env.SKILLCRYPT_WALLET_KEY;
    assert.throws(
      () => loadKeyGuarded(dir),
      /no wallet key found/
    );
  });
});
