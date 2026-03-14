/**
 * Skill-Crypt Payment Plugin
 *
 * Wraps xmtp-paywall around skill-crypt's existing message flow.
 * If a skill has a price, the paywall handles invoicing + verification.
 * If no price, the skill is free and this file is never loaded.
 *
 * This is the ONLY file that imports from xmtp-paywall.
 * transfer.js dynamic-imports this when it sees a priced skill.
 */

import { createInvoice, isInvoiceValid, payInvoice, verifyPayment, SpendingGuard } from 'xmtp-paywall';

/**
 * Build an invoice for a paid skill.
 *
 * @param {string} payTo - seller wallet address
 * @param {string} price - USD amount ('0.05')
 * @param {string} skillId - vault skill ID
 * @param {string} skillName - human-readable name
 * @returns {object} invoice with type 'skillcrypt:invoice'
 */
export function buildSkillInvoice(payTo, price, skillId, skillName) {
  const invoice = createInvoice({
    payTo,
    price,
    resource: skillId,
    meta: { skillId, skillName },
  });
  // Re-type as skillcrypt message so it flows through the existing protocol
  invoice.type = 'skillcrypt:invoice';
  return invoice;
}

/**
 * Pay a skill invoice. Calls xmtp-paywall's payInvoice under the hood.
 *
 * @param {ethers.Wallet} wallet - funded wallet
 * @param {object} invoice - from buildSkillInvoice
 * @returns {Promise<string>} tx hash
 */
export async function paySkillInvoice(wallet, invoice) {
  return payInvoice(wallet, invoice);
}

/**
 * Verify a skill payment on-chain.
 *
 * @param {string} txHash
 * @param {string} payTo - expected recipient
 * @param {string} amount - raw USDC amount
 * @returns {Promise<{ verified: boolean, error?: string, blockNumber?: number }>}
 */
export async function verifySkillPayment(txHash, payTo, amount) {
  return verifyPayment(txHash, { payTo, amount });
}

export { isInvoiceValid, SpendingGuard };

/**
 * Get wallet balance (USDC + ETH on Base).
 *
 * @param {string} privateKey - wallet private key
 * @param {string} [rpcUrl] - Base RPC URL
 * @returns {Promise<{ address: string, usdc: string, eth: string }>}
 */
export async function getBalance(privateKey, rpcUrl) {
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(rpcUrl || 'https://mainnet.base.org');
  const wallet = new ethers.Wallet(privateKey, provider);
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], provider);
  const usdcBal = await usdc.balanceOf(wallet.address);
  const ethBal = await provider.getBalance(wallet.address);
  return {
    address: wallet.address,
    usdc: ethers.formatUnits(usdcBal, 6),
    eth: ethers.formatEther(ethBal),
  };
}

/**
 * Swap ETH → USDC via Uniswap V3 on Base.
 *
 * @param {string} privateKey - wallet private key
 * @param {string} ethAmount - amount of ETH to swap (e.g. '0.003')
 * @param {string} [rpcUrl] - Base RPC URL
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
