/**
 * XMTP Transfer Protocol
 *
 * Defines the message types and handlers for agent-to-agent skill transfer
 * over XMTP encrypted messaging. Includes Skill Share discovery messages
 * for broadcasting and finding skills in shared groups.
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

/**
 * Build a catalog response containing skill metadata (no content).
 */
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

/**
 * Build a skill transfer message pair.
 *
 * Content is encrypted with a random ephemeral key. Returns two
 * messages that must be sent separately so the local XMTP DB
 * never contains both ciphertext and key in one row.
 *
 * Message 1: encrypted payload + metadata (no plaintext content)
 * Message 2: ephemeral key + transfer ID (sent right after)
 *
 * @returns {{ transfer: object, keyMsg: object }}
 */
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

/**
 * Build a skill request message.
 */
export function buildRequest(skillId) {
  return {
    type: MSG_TYPES.SKILL_REQUEST,
    skillId,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build a catalog request message.
 */
export function buildCatalogRequest() {
  return {
    type: MSG_TYPES.CATALOG_REQUEST,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build an acknowledgment message.
 */
export function buildAck(skillId, success = true) {
  return {
    type: MSG_TYPES.ACK,
    skillId,
    success,
    timestamp: new Date().toISOString()
  };
}

// --- Skill Share builders ---

/**
 * Build a skill listing for broadcast to a Skill Share group.
 * Contains metadata only, never content. Other agents DM to request.
 */
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

/**
 * Build a listing request.
 */
export function buildListingRequest(opts) {
  return {
    type: MSG_TYPES.LISTING_REQUEST,
    query: opts.query,
    tags: opts.tags || [],
    address: opts.address,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build an agent profile for the Skill Share group.
 */
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

/**
 * Build a review for a skill.
 */
export function buildReview(opts) {
  if (opts.rating < 1 || opts.rating > 5) {
    throw new Error('rating must be between 1 and 5');
  }
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

/**
 * Parse a raw message string into a skillcrypt protocol message.
 * Returns null if not a valid skillcrypt message.
 */
export function parseMessage(text) {
  try {
    const msg = JSON.parse(text);
    if (msg.type && msg.type.startsWith('skillcrypt:')) {
      return msg;
    }
  } catch {}
  return null;
}

// --- Helper: send the encrypted skill (used in both free and paid paths) ---

async function sendSkill(vault, skillId, entry, sendFn) {
  const content = await vault.load(skillId);
  const { transfer, keyMsg } = buildTransfer({
    skillId,
    name: entry.name,
    content,
    contentHash: entry.contentHash,
    version: entry.version,
    description: entry.description,
    tags: entry.tags
  });
  await sendFn(JSON.stringify(transfer));
  await sendFn(JSON.stringify(keyMsg));
}

/**
 * Handle an incoming skillcrypt message.
 *
 * context.payTo — set this to the seller's wallet address to enable paid skills.
 *                  if not set, all skills are free regardless of price field.
 */
export async function handleMessage(msg, vault, sendFn, context = {}) {

  switch (msg.type) {
    case MSG_TYPES.CATALOG_REQUEST: {
      const skills = vault.list();
      await sendFn(JSON.stringify(buildCatalog(skills)));
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

      // Paid skill? Send invoice first. Otherwise send skill immediately.
      if (entry.price && context.payTo) {
        const { buildInvoice } = await import('./payment.js');
        const invoice = buildInvoice(context.payTo, entry.price, skillId, entry.name);

        if (!context._pendingInvoices) context._pendingInvoices = new Map();
        context._pendingInvoices.set(invoice.nonce, { invoice, skillId, entry });

        await sendFn(JSON.stringify(invoice));
      } else {
        await sendSkill(vault, skillId, entry, sendFn);
      }
      break;
    }

    case MSG_TYPES.INVOICE: {
      // Buyer side: received an invoice. App/agent decides whether to pay.
      if (context.onInvoice) context.onInvoice(msg);
      break;
    }

    case MSG_TYPES.PAYMENT: {
      // Seller side: buyer sent a txHash. Verify on-chain, then send skill.
      if (!context._pendingInvoices) break;
      const pending = context._pendingInvoices.get(msg.invoiceNonce);
      if (!pending) break;

      const { verifyPayment } = await import('./payment.js');
      const result = await verifyPayment(msg.txHash, pending.invoice.payTo, pending.invoice.amount);

      if (!result.ok) {
        await sendFn(JSON.stringify({
          type: MSG_TYPES.PAYMENT_FAILED,
          nonce: msg.invoiceNonce,
          reason: result.error,
          timestamp: new Date().toISOString(),
        }));
        break;
      }

      // Verified — confirm and send the skill
      await sendFn(JSON.stringify({
        type: MSG_TYPES.PAYMENT_VERIFIED,
        nonce: msg.invoiceNonce,
        txHash: msg.txHash,
        blockNumber: result.blockNumber,
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
        version: pending.version,
        description: pending.description,
        tags: pending.tags
      });
      await sendFn(JSON.stringify(buildAck(pending.skillId, true)));
      break;
    }

    case MSG_TYPES.LISTING: {
      if (context.onListing) context.onListing(msg);
      break;
    }

    case MSG_TYPES.LISTING_REQUEST: {
      if (context.onListingRequest) context.onListingRequest(msg);
      break;
    }

    case MSG_TYPES.PROFILE: {
      if (context.onProfile) context.onProfile(msg);
      break;
    }

    case MSG_TYPES.REVIEW: {
      if (context.onReview) context.onReview(msg);
      break;
    }

    case MSG_TYPES.CATALOG:
      break;

    case MSG_TYPES.ACK:
      break;
  }
}
