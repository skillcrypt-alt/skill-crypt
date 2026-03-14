/**
 * Skill-Crypt Payment Adapter
 *
 * Thin wrapper around xmtp-paywall. Imports the generic payment
 * primitives and re-exports them with skill-crypt-specific helpers.
 *
 * Free skills never touch this file — transfer.js only imports it
 * when a skill actually has a price.
 */

export { createInvoice, payInvoice, verifyPayment, SpendingGuard } from 'xmtp-paywall';

import { createInvoice } from 'xmtp-paywall';

/**
 * Build an invoice for a paid skill.
 * Convenience wrapper that maps skill-crypt fields to xmtp-paywall's createInvoice.
 */
export function buildSkillInvoice(payTo, price, skillId, skillName) {
  return createInvoice({
    payTo,
    price,
    resource: skillId,
    meta: { skillId, skillName },
  });
}
