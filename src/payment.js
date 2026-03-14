/**
 * Skill-Crypt Payment Integration
 *
 * Thin wrapper around xmtp-paywall for skill-crypt's specific needs.
 * Maps skill-crypt message types to paywall pricing.
 */

// re-export everything from xmtp-paywall
export {
  createPaywall,
  createBuyer,
  TYPES as PAYWALL_TYPES,
  createInvoice,
  isInvoiceValid,
  verifyPayment,
  payInvoice,
  SpendingGuard,
  USDC_ADDRESS,
  USDC_DECIMALS,
} from 'xmtp-paywall';

import { createPaywall as _createPaywall } from 'xmtp-paywall';

/**
 * Create a paywall pre-configured for skill-crypt.
 *
 * Pricing is based on the vault manifest: if a skill has a price
 * field, skill-request messages for it are gated. Everything else
 * is free.
 *
 * @param {object} opts
 * @param {string} opts.payTo - wallet address
 * @param {object} opts.vault - XMTPVault or vault with manifest.skills
 * @param {function} [opts.onPaid] - callback on verified payment
 * @returns {object} paywall instance
 */
export function createSkillPaywall({ payTo, vault, onPaid }) {
  return _createPaywall({
    payTo,
    pricing: (msg) => {
      // only gate skill requests
      if (msg.type !== 'skillcrypt:skill-request') return null;

      // look up skill price
      const skillId = msg.skillId;
      let entry = vault.manifest?.skills?.[skillId];

      // try name match
      if (!entry) {
        const byName = Object.entries(vault.manifest?.skills || {})
          .find(([, e]) => e.name === skillId);
        if (byName) entry = byName[1];
      }

      return entry?.price || null; // null = free
    },
    onPaid,
  });
}
