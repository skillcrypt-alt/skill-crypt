/**
 * Skill-Crypt Payments
 *
 * Optional USDC paywall for skills. If a skill has a price, the seller
 * sends an invoice before the skill. If it doesn't, it's free.
 * That's it.
 *
 * Everything runs over XMTP. Payment is a direct USDC transfer on Base.
 * Verification reads the tx receipt from Base RPC. No facilitator, no
 * middleware, no external package.
 */

import { ethers } from 'ethers';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;
const BASE_RPC = process.env.SKILLCRYPT_RPC_URL || 'https://mainnet.base.org';
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

/**
 * Build an invoice for a paid skill.
 *
 * @param {string} payTo - seller wallet
 * @param {string} price - USD amount ('0.05')
 * @param {string} skillId - vault skill ID
 * @param {string} skillName - human name
 * @returns {object} invoice message
 */
export function buildInvoice(payTo, price, skillId, skillName) {
  const p = String(price).replace(/^\$/, '');
  const usd = parseFloat(p);
  if (isNaN(usd) || usd <= 0) throw new Error(`invalid price: ${price}`);

  return {
    type: 'skillcrypt:invoice',
    payTo,
    amount: ethers.parseUnits(p, USDC_DECIMALS).toString(),
    price: p,
    asset: USDC_ADDRESS,
    network: 'base',
    skillId,
    skillName,
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    expiresAt: Date.now() + 5 * 60 * 1000,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Pay an invoice — direct USDC.transfer() on Base.
 *
 * @param {ethers.Wallet} wallet - funded wallet
 * @param {object} invoice - from buildInvoice
 * @returns {Promise<string>} tx hash
 */
export async function payInvoice(wallet, invoice) {
  if (Date.now() > invoice.expiresAt) throw new Error('invoice expired');

  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);
  const amount = BigInt(invoice.amount);

  const balance = await usdc.balanceOf(wallet.address);
  if (balance < amount) {
    throw new Error(`insufficient USDC: have ${ethers.formatUnits(balance, USDC_DECIMALS)}, need ${invoice.price}`);
  }

  const tx = await usdc.transfer(invoice.payTo, amount);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Verify a USDC payment on-chain. Reads the tx receipt from Base RPC,
 * checks for a Transfer event matching the expected payTo + amount.
 *
 * @param {string} txHash
 * @param {string} payTo - expected recipient
 * @param {string} amount - expected raw USDC amount
 * @returns {Promise<{ ok: boolean, error?: string, blockNumber?: number }>}
 */
export async function verifyPayment(txHash, payTo, amount) {
  const provider = new ethers.JsonRpcProvider(BASE_RPC);

  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return { ok: false, error: 'tx not found' };
    if (receipt.status !== 1) return { ok: false, error: 'tx reverted' };

    const wantTo = payTo.toLowerCase();
    const wantAmount = BigInt(amount);

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;
      if (log.topics[0] !== TRANSFER_TOPIC) continue;
      const to = '0x' + log.topics[2].slice(26);
      const value = BigInt(log.data);
      if (to.toLowerCase() === wantTo && value >= wantAmount) {
        return { ok: true, blockNumber: receipt.blockNumber };
      }
    }

    return { ok: false, error: 'no matching USDC transfer in tx' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export { USDC_ADDRESS, USDC_DECIMALS, BASE_RPC };
