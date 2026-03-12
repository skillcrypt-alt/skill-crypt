import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { SkillVault } from '../src/vault.js';
import { SkillShare } from '../src/skill-share.js';

const TEST_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_DIR = `/tmp/skillshare-test-${Date.now()}`;

describe('SkillShare state management', () => {
  let vault;
  let share;

  before(async () => {
    vault = new SkillVault(`${TEST_DIR}/vault`, TEST_KEY);
    await vault.init();

    await vault.store('web-scraper', '# Web Scraper\n\nScrape websites.', {
      description: 'Website scraping',
      tags: ['web', 'data'],
      version: '1.0.0'
    });
    await vault.store('email-handler', '# Email\n\nHandle emails.', {
      description: 'Email management',
      tags: ['email', 'productivity'],
      version: '2.0.0'
    });

    // SkillShare without a real XMTP client (testing state only)
    share = new SkillShare({
      client: { getAddress: () => '0xtest123', client: { inboxId: 'test' } },
      vault,
      dataDir: `${TEST_DIR}/share`,
      agentName: 'test-agent'
    });
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('initializes with empty state', () => {
    assert.deepStrictEqual(share.listings, []);
    assert.deepStrictEqual(share.profiles, []);
    assert.deepStrictEqual(share.reviews, []);
    assert.deepStrictEqual(share.requests, []);
  });

  it('persists and loads state', async () => {
    share.listings.push({
      type: 'skillcrypt:listing',
      name: 'web-scraper',
      address: '0xprovider',
      tags: ['web'],
      timestamp: new Date().toISOString()
    });
    share.profiles.push({
      type: 'skillcrypt:profile',
      name: 'bot-a',
      address: '0xbota',
      offers: ['web'],
      seeks: ['email']
    });
    share.reviews.push({
      type: 'skillcrypt:review',
      skillName: 'web-scraper',
      provider: '0xprovider',
      reviewer: '0xreviewer',
      rating: 4,
      comment: 'good'
    });
    share.groupId = 'test-group-id';

    await share._saveState();

    // Create a fresh instance and load
    const share2 = new SkillShare({
      client: share.client,
      vault,
      dataDir: `${TEST_DIR}/share`,
      agentName: 'test-agent'
    });
    await share2._loadState();

    assert.strictEqual(share2.listings.length, 1);
    assert.strictEqual(share2.listings[0].name, 'web-scraper');
    assert.strictEqual(share2.profiles.length, 1);
    assert.strictEqual(share2.profiles[0].name, 'bot-a');
    assert.strictEqual(share2.reviews.length, 1);
    assert.strictEqual(share2.groupId, 'test-group-id');
  });

  it('filters listings by tag', () => {
    share.listings = [
      { name: 'web-scraper', tags: ['web', 'data'], address: '0x1' },
      { name: 'email-handler', tags: ['email', 'productivity'], address: '0x2' },
      { name: 'calendar-sync', tags: ['calendar', 'productivity'], address: '0x3' }
    ];

    const web = share.getListings({ tag: 'web' });
    assert.strictEqual(web.length, 1);
    assert.strictEqual(web[0].name, 'web-scraper');

    const prod = share.getListings({ tag: 'productivity' });
    assert.strictEqual(prod.length, 2);
  });

  it('filters listings by name', () => {
    const results = share.getListings({ name: 'email' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'email-handler');
  });

  it('filters listings by address', () => {
    const results = share.getListings({ address: '0x2' });
    assert.strictEqual(results.length, 1);
  });

  it('filters reviews by provider', () => {
    share.reviews = [
      { skillName: 'a', provider: '0x1', reviewer: '0x2', rating: 5 },
      { skillName: 'b', provider: '0x1', reviewer: '0x3', rating: 3 },
      { skillName: 'c', provider: '0x9', reviewer: '0x2', rating: 4 }
    ];

    const r = share.getReviews({ provider: '0x1' });
    assert.strictEqual(r.length, 2);
  });

  it('calculates provider rating', () => {
    const rating = share.getProviderRating('0x1');
    assert.ok(rating);
    assert.strictEqual(rating.average, 4);
    assert.strictEqual(rating.count, 2);
  });

  it('returns null for provider with no reviews', () => {
    assert.strictEqual(share.getProviderRating('0xunknown'), null);
  });

  it('updates existing profile instead of duplicating', () => {
    share.profiles = [
      { name: 'bot-a', address: '0xbota', skillCount: 3 }
    ];

    // Simulate receiving an updated profile
    const idx = share.profiles.findIndex(p => p.address === '0xbota');
    share.profiles[idx] = { name: 'bot-a-v2', address: '0xbota', skillCount: 7 };

    assert.strictEqual(share.profiles.length, 1);
    assert.strictEqual(share.profiles[0].name, 'bot-a-v2');
    assert.strictEqual(share.profiles[0].skillCount, 7);
  });
});
