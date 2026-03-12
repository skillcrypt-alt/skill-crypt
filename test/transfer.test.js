import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalog,
  buildTransfer,
  buildRequest,
  buildCatalogRequest,
  buildAck,
  buildListing,
  buildListingRequest,
  buildProfile,
  buildReview,
  parseMessage,
  MSG_TYPES
} from '../src/transfer.js';

describe('transfer protocol', () => {
  it('builds a catalog with metadata and no content', () => {
    const catalog = buildCatalog([
      { skillId: '1', name: 'email-handler', version: '1.0.0', description: 'Handle emails', tags: ['email'], size: 200 }
    ]);
    assert.strictEqual(catalog.type, MSG_TYPES.CATALOG);
    assert.strictEqual(catalog.skills.length, 1);
    assert.strictEqual(catalog.skills[0].name, 'email-handler');
    assert.ok(!('content' in catalog.skills[0]));
  });

  it('builds a two-part transfer with encrypted payload and key', () => {
    const { transfer, keyMsg } = buildTransfer({
      skillId: 'abc-123',
      name: 'web-scraper',
      content: '# Web Scraper\n\nScrape websites.',
      contentHash: 'sha256:deadbeef'
    });
    assert.strictEqual(transfer.type, MSG_TYPES.SKILL_TRANSFER);
    assert.strictEqual(transfer.contentHash, 'sha256:deadbeef');
    assert.strictEqual(transfer.name, 'web-scraper');
    assert.ok(transfer.payload, 'transfer should have encrypted payload');
    assert.ok(!transfer.content, 'transfer should not have plaintext content');
    assert.strictEqual(keyMsg.type, MSG_TYPES.TRANSFER_KEY);
    assert.ok(keyMsg.ephemeralKey, 'key message should have ephemeral key');
    assert.strictEqual(transfer.transferId, keyMsg.transferId);
  });

  it('builds a skill request', () => {
    const req = buildRequest('abc-123');
    assert.strictEqual(req.type, MSG_TYPES.SKILL_REQUEST);
    assert.strictEqual(req.skillId, 'abc-123');
  });

  it('builds a catalog request', () => {
    const req = buildCatalogRequest();
    assert.strictEqual(req.type, MSG_TYPES.CATALOG_REQUEST);
  });

  it('builds ack messages', () => {
    const ack = buildAck('abc-123', true);
    assert.strictEqual(ack.type, MSG_TYPES.ACK);
    assert.strictEqual(ack.success, true);

    const nack = buildAck('abc-123', false);
    assert.strictEqual(nack.success, false);
  });

  it('parses valid skillcrypt messages', () => {
    const msg = parseMessage(JSON.stringify({ type: 'skillcrypt:catalog-request' }));
    assert.ok(msg);
    assert.strictEqual(msg.type, MSG_TYPES.CATALOG_REQUEST);
  });

  it('returns null for non-skillcrypt JSON', () => {
    assert.strictEqual(parseMessage('{"type":"something-else"}'), null);
  });

  it('returns null for invalid JSON', () => {
    assert.strictEqual(parseMessage('not json'), null);
  });

  it('returns null for plain text messages', () => {
    assert.strictEqual(parseMessage('hello world'), null);
  });
});

describe('skill share protocol', () => {
  it('builds a listing with metadata and address', () => {
    const listing = buildListing({
      name: 'web-scraper',
      description: 'Scrape websites',
      tags: ['web', 'data'],
      version: '1.0.0',
      size: 500,
      address: '0xabc123',
      skillId: 'uuid-1'
    });
    assert.strictEqual(listing.type, MSG_TYPES.LISTING);
    assert.strictEqual(listing.name, 'web-scraper');
    assert.strictEqual(listing.address, '0xabc123');
    assert.ok(!('content' in listing));
    assert.ok(listing.timestamp);
  });

  it('builds a listing request with query and tags', () => {
    const req = buildListingRequest({
      query: 'need a skill for scraping websites',
      tags: ['web'],
      address: '0xdef456'
    });
    assert.strictEqual(req.type, MSG_TYPES.LISTING_REQUEST);
    assert.strictEqual(req.query, 'need a skill for scraping websites');
    assert.deepStrictEqual(req.tags, ['web']);
    assert.strictEqual(req.address, '0xdef456');
  });

  it('builds an agent profile', () => {
    const profile = buildProfile({
      name: 'scraper-bot',
      address: '0xabc123',
      description: 'I scrape things',
      offers: ['web', 'data'],
      seeks: ['email', 'calendar'],
      skillCount: 5
    });
    assert.strictEqual(profile.type, MSG_TYPES.PROFILE);
    assert.strictEqual(profile.name, 'scraper-bot');
    assert.strictEqual(profile.skillCount, 5);
    assert.deepStrictEqual(profile.offers, ['web', 'data']);
    assert.deepStrictEqual(profile.seeks, ['email', 'calendar']);
  });

  it('builds a review with rating and comment', () => {
    const review = buildReview({
      skillName: 'web-scraper',
      provider: '0xabc123',
      reviewer: '0xdef456',
      rating: 4,
      comment: 'worked well, fast extraction'
    });
    assert.strictEqual(review.type, MSG_TYPES.REVIEW);
    assert.strictEqual(review.rating, 4);
    assert.strictEqual(review.comment, 'worked well, fast extraction');
    assert.strictEqual(review.provider, '0xabc123');
  });

  it('rejects invalid ratings', () => {
    assert.throws(() => buildReview({
      skillName: 'x', provider: '0x1', reviewer: '0x2', rating: 0
    }));
    assert.throws(() => buildReview({
      skillName: 'x', provider: '0x1', reviewer: '0x2', rating: 6
    }));
  });

  it('parses skill share messages', () => {
    const listing = parseMessage(JSON.stringify({
      type: 'skillcrypt:listing',
      name: 'test',
      address: '0x1'
    }));
    assert.ok(listing);
    assert.strictEqual(listing.type, MSG_TYPES.LISTING);

    const profile = parseMessage(JSON.stringify({
      type: 'skillcrypt:profile',
      name: 'bot',
      address: '0x2'
    }));
    assert.ok(profile);
    assert.strictEqual(profile.type, MSG_TYPES.PROFILE);
  });

  it('defaults to empty arrays and strings for optional fields', () => {
    const listing = buildListing({ name: 'minimal', address: '0x1' });
    assert.deepStrictEqual(listing.tags, []);
    assert.strictEqual(listing.description, '');
    assert.strictEqual(listing.version, '1.0.0');

    const profile = buildProfile({ name: 'bot', address: '0x1' });
    assert.deepStrictEqual(profile.offers, []);
    assert.deepStrictEqual(profile.seeks, []);
    assert.strictEqual(profile.skillCount, 0);
  });
});
