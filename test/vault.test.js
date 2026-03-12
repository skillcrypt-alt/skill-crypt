import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { SkillVault } from '../src/vault.js';

const TEST_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_VAULT = '/tmp/skillcrypt-test-vault-' + Date.now();

describe('SkillVault', () => {
  let vault;

  before(async () => {
    vault = new SkillVault(TEST_VAULT, TEST_KEY);
    await vault.init();
  });

  after(async () => {
    await rm(TEST_VAULT, { recursive: true, force: true });
  });

  it('initializes with an empty vault', () => {
    assert.strictEqual(vault.list().length, 0);
  });

  it('stores a skill and returns a skill ID', async () => {
    const content = '# Email Skill\n\nSend and read emails.\n\n## Steps\n1. Connect to IMAP\n2. Parse messages';
    const id = await vault.store('email-handler', content, {
      description: 'Email management skill',
      tags: ['email', 'productivity'],
      version: '1.0.0'
    });
    assert.ok(id);
    assert.ok(typeof id === 'string');
  });

  it('loads and decrypts a stored skill', async () => {
    const skills = vault.list();
    const loaded = await vault.load(skills[0].skillId);
    assert.ok(loaded.includes('# Email Skill'));
    assert.ok(loaded.includes('Connect to IMAP'));
  });

  it('lists skills with metadata but not content', () => {
    const skills = vault.list();
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].name, 'email-handler');
    assert.deepStrictEqual(skills[0].tags, ['email', 'productivity']);
    assert.ok(!skills[0].content);
  });

  it('stores multiple skills', async () => {
    await vault.store('web-scraper', '# Web Scraper\n\nScrape websites.', {
      tags: ['web', 'data']
    });
    await vault.store('calendar-sync', '# Calendar\n\nSync calendar events.', {
      tags: ['calendar', 'productivity']
    });
    assert.strictEqual(vault.list().length, 3);
  });

  it('finds skills by name', () => {
    const results = vault.find('email');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'email-handler');
  });

  it('finds skills by tag', () => {
    const results = vault.find('productivity');
    assert.strictEqual(results.length, 2);
  });

  it('returns empty results for unknown queries', () => {
    const results = vault.find('nonexistent-skill');
    assert.strictEqual(results.length, 0);
  });

  it('removes a skill and cleans up', async () => {
    const skills = vault.list();
    const target = skills.find(s => s.name === 'web-scraper');
    await vault.remove(target.skillId);
    assert.strictEqual(vault.list().length, 2);
    assert.ok(!vault.list().find(s => s.name === 'web-scraper'));
  });

  it('throws when loading a nonexistent skill', async () => {
    await assert.rejects(() => vault.load('does-not-exist'));
  });

  it('rotates all skills to a new wallet key', async () => {
    const NEW_KEY = '0x' + 'ab'.repeat(32);
    const skillsBefore = vault.list();
    const count = skillsBefore.length;

    // Decrypt one skill before rotation to verify content
    const testSkill = skillsBefore[0];
    const contentBefore = await vault.load(testSkill.skillId);

    const result = await vault.rotateKey(NEW_KEY);
    assert.strictEqual(result.rotated, count);
    assert.strictEqual(result.failed.length, 0);

    // Can decrypt with new key
    const contentAfter = await vault.load(testSkill.skillId);
    assert.strictEqual(contentAfter, contentBefore);

    // Manifest has rotatedAt timestamps
    const meta = vault.manifest.skills[testSkill.skillId];
    assert.ok(meta.rotatedAt);

    // Old key cannot decrypt
    const oldVault = new SkillVault(TEST_VAULT, TEST_KEY);
    await oldVault.init();
    await assert.rejects(() => oldVault.load(testSkill.skillId));
  });

  it('cannot decrypt with a different wallet key', async () => {
    const otherVault = new SkillVault(TEST_VAULT, '0x' + 'f'.repeat(64));
    await otherVault.init();
    const skills = otherVault.list();
    // manifest is readable (plaintext) but decryption should fail
    await assert.rejects(() => otherVault.load(skills[0].skillId));
  });
});
