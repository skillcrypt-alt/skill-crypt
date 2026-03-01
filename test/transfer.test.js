import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalog,
  buildTransfer,
  buildRequest,
  buildCatalogRequest,
  buildAck,
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

  it('builds a transfer message with content and hash', () => {
    const transfer = buildTransfer({
      skillId: 'abc-123',
      name: 'web-scraper',
      content: '# Web Scraper\n\nScrape websites.',
      contentHash: 'sha256:deadbeef'
    });
    assert.strictEqual(transfer.type, MSG_TYPES.SKILL_TRANSFER);
    assert.strictEqual(transfer.content, '# Web Scraper\n\nScrape websites.');
    assert.strictEqual(transfer.contentHash, 'sha256:deadbeef');
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
