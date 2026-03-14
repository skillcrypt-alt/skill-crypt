/**
 * Skill-Crypt Payments
 *
 * Lightweight paywall for skill transfers. Sellers set a USDC price on
 * their listings. Buyers pay directly on Base, send the txHash over
 * XMTP DM, seller verifies the Transfer event on-chain, then sends
 * the encrypted skill.
 *
 * No facilitator, no HTTP, no middleman. Just XMTP + USDC + Base RPC.
 *
 * Flow:
 *   1. Seller posts listing with price (existing listing + price field)
 *   2. Buyer DMs seller with skill-request (existing)
 *   3. Seller DMs back an invoice (payTo, amount, nonce, expiry)
 *   4. Buyer transfers USDC on Base
 *   5. Buyer DMs txHash
 *   6. Seller verifies Transfer event via Base RPC
 *   7. Seller sends encrypted skill (existing transfer protocol)
 *
 * Dependencies: ethers (already in project). That's it.
 */

import { ethers } from 'ethers';

// ─── Constants ───

const BASE_RPC = process.env.SKILLCRYPT_RPC_URL || 'https://mainnet.base.org';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

// ─── Message Types ───

export const PAYMENT_TYPES = {
  INVOICE: 'skillcrypt:invoice',
  PAYMENT: 'skillcrypt:payment',
  PAYMENT_VERIFIED: 'skillcrypt:payment-verified',
  PAYMENT_FAILED: 'skillcrypt:payment-failed',
};

// ─── Invoice ───

/**
 * Build a payment invoice for a skill.
 * Nonce prevents replay. Expiry prevents stale payments.
 *
 * @param {object} opts
 * @param {string} opts.skillId - Skill being purchased
 * @param {string} opts.skillName - Human-readable name
 * @param {string} opts.price - USD price (e.g. '0.05' or '$0.05')
 * @param {string} opts.payTo - Seller's wallet address
 * @returns {object} Invoice message
 */
export function buildInvoice({ skillId, skillName, price, payTo }) {
  const priceStr = String(price).replace(/^\$/, '');
  const usdAmount = parseFloat(priceStr);
  if (isNaN(usdAmount) || usdAmount <= 0) {
    throw new Error(`invalid price: ${price}`);
  }

  const rawAmount = ethers.parseUnits(priceStr, USDC_DECIMALS).toString();
  const nonce = `${skillId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    type: PAYMENT_TYPES.INVOICE,
    skillId,
    skillName,
    payTo,
    amount: rawAmount,
    usdPrice: priceStr,
    asset: USDC_ADDRESS,
    network: 'base',
    chainId: 8453,
    nonce,
    expiresAt: Date.now() + 5 * 60 * 1000,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a payment message (buyer sends txHash after USDC transfer).
 */
export function buildPayment({ skillId, invoiceNonce, txHash, buyer }) {
  return {
    type: PAYMENT_TYPES.PAYMENT,
    skillId,
    invoiceNonce,
    txHash,
    buyer,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a payment-verified message (seller confirms on-chain).
 */
export function buildPaymentVerified({ skillId, invoiceNonce, txHash, blockNumber }) {
  return {
    type: PAYMENT_TYPES.PAYMENT_VERIFIED,
    skillId,
    invoiceNonce,
    txHash,
    blockNumber,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a payment-failed message.
 */
export function buildPaymentFailed({ skillId, invoiceNonce, reason }) {
  return {
    type: PAYMENT_TYPES.PAYMENT_FAILED,
    skillId,
    invoiceNonce,
    reason,
    timestamp: new Date().toISOString(),
  };
}

// ─── On-Chain Transfer ───

/**
 * Pay an invoice — direct USDC transfer on Base.
 *
 * @param {ethers.Wallet} wallet - Funded wallet with USDC + ETH for gas
 * @param {object} invoice - Invoice from buildInvoice()
 * @returns {Promise<string>} Transaction hash
 */
export async function payInvoice(wallet, invoice) {
  if (Date.now() > invoice.expiresAt) {
    throw new Error('invoice expired');
  }

  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);
  const amount = BigInt(invoice.amount);

  // check balance
  const balance = await usdc.balanceOf(wallet.address);
  if (balance < amount) {
    const have = ethers.formatUnits(balance, USDC_DECIMALS);
    throw new Error(`insufficient USDC: have ${have}, need ${invoice.usdPrice}`);
  }

  const tx = await usdc.transfer(invoice.payTo, amount);
  const receipt = await tx.wait();
  return receipt.hash;
}

// ─── On-Chain Verification ───

/**
 * Verify a USDC payment on-chain. Reads transaction receipt from Base RPC
 * and checks for a Transfer event matching the expected recipient + amount.
 *
 * Trustless — reads directly from the chain, no intermediary.
 *
 * @param {string} txHash - Transaction hash from buyer
 * @param {object} expected - { payTo, amount (raw USDC units), buyer? }
 * @param {object} [opts] - { rpcUrl }
 * @returns {Promise<{ verified: boolean, error?: string, blockNumber?: number }>}
 */
export async function verifyPayment(txHash, expected, opts = {}) {
  const provider = new ethers.JsonRpcProvider(opts.rpcUrl || BASE_RPC);

  try {
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return { verified: false, error: 'transaction not found (may be pending)' };
    }
    if (receipt.status !== 1) {
      return { verified: false, error: 'transaction reverted' };
    }

    const expectedTo = expected.payTo.toLowerCase();
    const expectedAmount = BigInt(expected.amount);

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;
      if (log.topics[0] !== TRANSFER_TOPIC) continue;

      const from = '0x' + log.topics[1].slice(26);
      const to = '0x' + log.topics[2].slice(26);
      const value = BigInt(log.data);

      if (to.toLowerCase() === expectedTo && value >= expectedAmount) {
        if (expected.buyer && from.toLowerCase() !== expected.buyer.toLowerCase()) {
          continue;
        }
        return {
          verified: true,
          from,
          to,
          amount: value.toString(),
          blockNumber: receipt.blockNumber,
          txHash,
        };
      }
    }

    return { verified: false, error: 'no matching USDC transfer found in transaction' };
  } catch (err) {
    return { verified: false, error: `verification error: ${err.message}` };
  }
}

// ─── Spending Guard ───

/**
 * Simple spending guard for buyers. Tracks daily spend + per-skill limits.
 * State lives in memory (caller can persist if needed).
 */
export class SpendingGuard {
  constructor(opts = {}) {
    this.maxPerSkill = parseFloat(opts.maxPerSkill || '1.00');
    this.maxDaily = parseFloat(opts.maxDaily || '10.00');
    this.purchases = []; // { timestamp, usdAmount, payTo, skillId }
  }

  check(invoice) {
    const usd = parseFloat(invoice.usdPrice);

    if (usd > this.maxPerSkill) {
      throw new Error(`$${usd} exceeds per-skill limit of $${this.maxPerSkill}`);
    }

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const dailySpend = this.purchases
      .filter(p => p.timestamp > dayAgo)
      .reduce((s, p) => s + p.usdAmount, 0);

    if (dailySpend + usd > this.maxDaily) {
      throw new Error(`daily spend would be $${(dailySpend + usd).toFixed(2)} (limit: $${this.maxDaily})`);
    }
  }

  record(invoice) {
    this.purchases.push({
      timestamp: Date.now(),
      usdAmount: parseFloat(invoice.usdPrice),
      payTo: invoice.payTo,
      skillId: invoice.skillId,
    });
    // prune > 48h
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    this.purchases = this.purchases.filter(p => p.timestamp > cutoff);
  }

  status() {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = this.purchases.filter(p => p.timestamp > dayAgo);
    const spent = recent.reduce((s, p) => s + p.usdAmount, 0);
    return { spent, remaining: this.maxDaily - spent, purchases: recent.length };
  }
}

export { USDC_ADDRESS, USDC_DECIMALS, BASE_RPC };
