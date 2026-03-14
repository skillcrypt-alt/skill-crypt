/**
 * skill-crypt payment plugin
 *
 * This file is the ONLY place skill-crypt imports from xmtp-paywall.
 * It adapts xmtp-paywall's generic payment primitives to skill-crypt's
 * protocol message types and data shapes.
 *
 * To adapt xmtp-paywall for your own project:
 *   1. Copy this file
 *   2. Change the message type prefix ('skillcrypt:' → 'yourapp:')
 *   3. Wire it into your message handler the same way transfer.js does
 *   4. That's it — xmtp-paywall handles all the chain/XMTP plumbing
 *
 * If xmtp-paywall is not installed, all exports throw ERR_MODULE_NOT_FOUND
 * and skill-crypt degrades gracefully (free skills still work).
 */

import {
  createInvoice,
  isInvoiceValid,
  payInvoice,
  verifyPayment,
  SpendingGuard,
} from 'xmtp-paywall';

// --- Invoice ---

/**
 * Build a skill-crypt invoice for a paid skill.
 * Wraps xmtp-paywall's createInvoice and re-types it as skillcrypt:invoice
 * so it flows through the existing transfer protocol unchanged.
 *
 * @param {string} payTo - seller wallet address (receives USDC)
 * @param {string} price - price in USD (e.g. '0.25')
 * @param {string} skillId - vault skill ID
 * @param {string} skillName - human-readable name
 * @returns {object} invoice message ready to JSON.stringify and send
 */
export function buildSkillInvoice(payTo, price, skillId, skillName) {
  const invoice = createInvoice({
    payTo,
    price,
    resource: skillId,
    meta: { skillId, skillName },
  });
  // Re-type as skillcrypt message so transfer.js treats it as protocol traffic
  invoice.type = 'skillcrypt:invoice';
  return invoice;
}

// --- Payment ---

/**
 * Pay a skill invoice. Transfers USDC directly on Base — no facilitator.
 *
 * @param {ethers.Wallet} wallet - buyer's funded wallet
 * @param {object} invoice - from buildSkillInvoice (or received over XMTP)
 * @returns {Promise<string>} on-chain transaction hash
 */
export async function paySkillInvoice(wallet, invoice) {
  return payInvoice(wallet, invoice);
}

// --- Verification ---

/**
 * Verify a skill payment on-chain.
 * Reads Transfer events directly from Base RPC — trustless, no intermediary.
 *
 * @param {string} txHash - transaction hash from buyer
 * @param {string} payTo - expected recipient (seller address)
 * @param {string} amount - expected raw USDC amount (6 decimals)
 * @returns {Promise<{ verified: boolean, blockNumber?: number, error?: string }>}
 */
export async function verifySkillPayment(txHash, payTo, amount) {
  return verifyPayment(txHash, { payTo, amount });
}

// --- Balance & Swap ---

/**
 * Get wallet USDC + ETH balance on Base.
 *
 * @param {string} privateKey - wallet private key (hex)
 * @param {string} [rpcUrl] - Base RPC (defaults to mainnet.base.org)
 * @returns {Promise<{ address: string, usdc: string, eth: string }>}
 */
export async function getBalance(privateKey, rpcUrl) {
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpcUrl || 'https://mainnet.base.org');
  const wallet = new ethers.Wallet(privateKey, provider);
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider);
  const [usdcBal, ethBal] = await Promise.all([
    usdc.balanceOf(wallet.address),
    provider.getBalance(wallet.address),
  ]);
  return {
    address: wallet.address,
    usdc: ethers.formatUnits(usdcBal, 6),
    eth: ethers.formatEther(ethBal),
  };
}

/**
 * Swap ETH → USDC via Uniswap V3 on Base.
 *
 * @param {string} privateKey - wallet private key (hex)
 * @param {string} ethAmount - ETH to swap (e.g. '0.002')
 * @param {string} [rpcUrl] - Base RPC (defaults to mainnet.base.org)
 * @returns {Promise<{ hash?: string, usdcBalance: string }>}
 */
export async function swapToUsdc(privateKey, ethAmount, rpcUrl) {
  const { ethers } = await import('ethers');
  const { swapEthToUsdc } = await import('xmtp-paywall/swap');
  const provider = new ethers.JsonRpcProvider(rpcUrl || 'https://mainnet.base.org');
  const wallet = new ethers.Wallet(privateKey, provider);
  const result = await swapEthToUsdc(wallet, ethAmount);
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider);
  const bal = await usdc.balanceOf(wallet.address);
  return {
    hash: result?.hash,
    usdcBalance: ethers.formatUnits(bal, 6),
  };
}

export { isInvoiceValid, SpendingGuard };
