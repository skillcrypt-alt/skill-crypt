/**
 * XMTP Transfer Protocol
 *
 * Defines the message types and handlers for agent-to-agent skill transfer
 * over XMTP encrypted messaging. Includes Skill Share discovery messages
 * for broadcasting and finding skills in shared groups.
 *
 * Payment is optional. If a skill has a price and the seller sets payTo,
 * an invoice is sent before the skill. Otherwise the skill is free and
 * the payment code is never loaded.
 */


import { encryptForTransfer, decryptTransfer } from './crypto.js';

export const MSG_TYPES = {
  // Direct transfer protocol
  CATALOG_REQUEST: 'skillcrypt:catalog-request',
  CATALOG: 'skillcrypt:catalog',
  SKILL_REQUEST: 'skillcrypt:skill-request',
  SKILL_TRANSFER: 'skillcrypt:skill-transfer',
  TRANSFER_KEY: 'skillcrypt:transfer-key',
  ACK: 'skillcrypt:ack',

  // Skill Share (group discovery)
  LISTING: 'skillcrypt:listing',
  LISTING_REQUEST: 'skillcrypt:listing-request',
  PROFILE: 'skillcrypt:profile',
  REVIEW: 'skillcrypt:review',

  // Payments (optional — only used when skills have a price)
  INVOICE: 'skillcrypt:invoice',
  PAYMENT: 'skillcrypt:payment',
  PAYMENT_VERIFIED: 'skillcrypt:payment-verified',
  PAYMENT_FAILED: 'skillcrypt:payment-failed',
};

// --- Direct transfer builders ---

export function buildCatalog(skills) {
  return {
    type: MSG_TYPES.CATALOG,
    skills: skills.map(s => ({
      skillId: s.skillId,
      name: s.name,
      version: s.version,
      description: s.description,
      tags: s.tags,
      size: s.size
    })),
    timestamp: new Date().toISOString()
  };
}

export function buildTransfer(opts) {
  const { payload, ephemeralKey } = encryptForTransfer(opts.content);
  const transferId = opts.contentHash + ':' + Date.now();

  return {
    transfer: {
      type: MSG_TYPES.SKILL_TRANSFER,
      skillId: opts.skillId,
      name: opts.name,
      version: opts.version || '1.0.0',
      description: opts.description || '',
      tags: opts.tags || [],
      payload,
      contentHash: opts.contentHash,
      transferId,
      timestamp: new Date().toISOString()
    },
    keyMsg: {
      type: MSG_TYPES.TRANSFER_KEY,
      transferId,
      ephemeralKey,
      timestamp: new Date().toISOString()
    }
  };
}

export function buildRequest(skillId) {
  return { type: MSG_TYPES.SKILL_REQUEST, skillId, timestamp: new Date().toISOString() };
}

export function buildCatalogRequest() {
  return { type: MSG_TYPES.CATALOG_REQUEST, timestamp: new Date().toISOString() };
}

export function buildAck(skillId, success = true) {
  return { type: MSG_TYPES.ACK, skillId, success, timestamp: new Date().toISOString() };
}

// --- Skill Share builders ---

export function buildListing(opts) {
  const listing = {
    type: MSG_TYPES.LISTING,
    name: opts.name,
    description: opts.description || '',
    tags: opts.tags || [],
    version: opts.version || '1.0.0',
    size: opts.size || 0,
    address: opts.address,
    skillId: opts.skillId || null,
    timestamp: new Date().toISOString()
  };
  if (opts.price) listing.price = String(opts.price).replace(/^\$/, '');
  return listing;
}

export function buildListingRequest(opts) {
  return {
    type: MSG_TYPES.LISTING_REQUEST,
    query: opts.query,
    tags: opts.tags || [],
    address: opts.address,
    timestamp: new Date().toISOString()
  };
}

export function buildProfile(opts) {
  return {
    type: MSG_TYPES.PROFILE,
    name: opts.name,
    address: opts.address,
    description: opts.description || '',
    offers: opts.offers || [],
    seeks: opts.seeks || [],
    skillCount: opts.skillCount || 0,
    timestamp: new Date().toISOString()
  };
}

export function buildReview(opts) {
  if (opts.rating < 1 || opts.rating > 5) throw new Error('rating must be between 1 and 5');
  return {
    type: MSG_TYPES.REVIEW,
    skillName: opts.skillName,
    provider: opts.provider,
    reviewer: opts.reviewer,
    rating: opts.rating,
    comment: opts.comment || '',
    timestamp: new Date().toISOString()
  };
}

export function parseMessage(text) {
  try {
    const msg = JSON.parse(text);
    if (msg.type && msg.type.startsWith('skillcrypt:')) return msg;
  } catch {}
  return null;
}

// --- Helper: send encrypted skill ---

async function sendSkill(vault, skillId, entry, sendFn) {
  const content = await vault.load(skillId);
  const { transfer, keyMsg } = buildTransfer({
    skillId, name: entry.name, content, contentHash: entry.contentHash,
    version: entry.version, description: entry.description, tags: entry.tags
  });
  await sendFn(JSON.stringify(transfer));
  await sendFn(JSON.stringify(keyMsg));
}

/**
 * Handle an incoming skillcrypt message.
 *
 * context.payTo — seller's wallet address. Enables paid skills.
 *                 If not set, all skills are free regardless of price field.
 */
export async function handleMessage(msg, vault, sendFn, context = {}) {

  switch (msg.type) {
    case MSG_TYPES.CATALOG_REQUEST: {
      await sendFn(JSON.stringify(buildCatalog(vault.list())));
      break;
    }

    case MSG_TYPES.SKILL_REQUEST: {
      let skillId = msg.skillId;
      let entry = vault.manifest.skills[skillId];
      if (!entry) {
        const byName = Object.entries(vault.manifest.skills)
          .find(([, e]) => e.name === msg.skillId);
        if (byName) { skillId = byName[0]; entry = byName[1]; }
      }
      if (!entry) {
        await sendFn(JSON.stringify(buildAck(msg.skillId, false)));
        return;
      }

      // Has a price AND seller set payTo? Send invoice.
      // No price or no payTo? Free — send skill immediately.
      if (entry.price && context.payTo) {
        const { buildSkillInvoice } = await import('./payment.js');
        const invoice = buildSkillInvoice(context.payTo, entry.price, skillId, entry.name);
        if (!context._pendingInvoices) context._pendingInvoices = new Map();
        context._pendingInvoices.set(invoice.nonce, { invoice, skillId, entry });
        await sendFn(JSON.stringify(invoice));
      } else {
        await sendSkill(vault, skillId, entry, sendFn);
      }
      break;
    }

    case MSG_TYPES.INVOICE: {
      if (context.onInvoice) context.onInvoice(msg);
      break;
    }

    case MSG_TYPES.PAYMENT: {
      if (!context._pendingInvoices) break;
      const pending = context._pendingInvoices.get(msg.invoiceNonce);
      if (!pending) break;

      const { verifySkillPayment } = await import('./payment.js');
      const result = await verifySkillPayment(msg.txHash, pending.invoice.payTo, pending.invoice.amount);

      if (!result.verified) {
        await sendFn(JSON.stringify({
          type: MSG_TYPES.PAYMENT_FAILED, nonce: msg.invoiceNonce,
          reason: result.error, timestamp: new Date().toISOString(),
        }));
        break;
      }

      await sendFn(JSON.stringify({
        type: MSG_TYPES.PAYMENT_VERIFIED, nonce: msg.invoiceNonce,
        txHash: msg.txHash, blockNumber: result.blockNumber,
        timestamp: new Date().toISOString(),
      }));
      await sendSkill(vault, pending.skillId, pending.entry, sendFn);
      context._pendingInvoices.delete(msg.invoiceNonce);
      break;
    }

    case MSG_TYPES.PAYMENT_VERIFIED: {
      if (context.onPaymentVerified) context.onPaymentVerified(msg);
      break;
    }

    case MSG_TYPES.PAYMENT_FAILED: {
      if (context.onPaymentFailed) context.onPaymentFailed(msg);
      break;
    }

    case MSG_TYPES.SKILL_TRANSFER: {
      if (!context._pendingTransfers) context._pendingTransfers = new Map();
      context._pendingTransfers.set(msg.transferId, msg);
      break;
    }

    case MSG_TYPES.TRANSFER_KEY: {
      if (!context._pendingTransfers) break;
      const pending = context._pendingTransfers.get(msg.transferId);
      if (!pending) break;
      context._pendingTransfers.delete(msg.transferId);
      const content = decryptTransfer(pending.payload, msg.ephemeralKey);
      await vault.store(pending.name, content, {
        version: pending.version, description: pending.description, tags: pending.tags
      });
      await sendFn(JSON.stringify(buildAck(pending.skillId, true)));
      break;
    }

    case MSG_TYPES.LISTING:
      if (context.onListing) context.onListing(msg);
      break;
    case MSG_TYPES.LISTING_REQUEST:
      if (context.onListingRequest) context.onListingRequest(msg);
      break;
    case MSG_TYPES.PROFILE:
      if (context.onProfile) context.onProfile(msg);
      break;
    case MSG_TYPES.REVIEW:
      if (context.onReview) context.onReview(msg);
      break;
    case MSG_TYPES.CATALOG:
      break;
    case MSG_TYPES.ACK:
      break;
  }
}
