# xmtp-paywall plugin for skill-crypt

skill-crypt uses [xmtp-paywall](https://github.com/skillcrypt-alt/xmtp-paywall) as an optional payment plugin. The entire integration is one file: [`src/payment.js`](src/payment.js).

If you want to add USDC payments to your own XMTP project, the pattern is the same.

## How the plugin works

xmtp-paywall handles all the chain and XMTP plumbing:
- Wallet encryption at rest (device-bound AES-256-GCM)
- Invoice creation with nonce + expiry
- USDC transfer on Base (direct ERC-20, no facilitator)
- On-chain verification via Transfer event logs
- ETH → USDC swap via Uniswap V3
- SpendingGuard (per-tx + daily limits)

`payment.js` adapts those primitives to skill-crypt's protocol:
- Re-types invoices as `skillcrypt:invoice` so they flow through the existing message handler
- Wraps `payInvoice(wallet, invoice)` for the buyer side
- Wraps `verifyPayment(txHash, { payTo, amount })` for trustless seller-side verification
- Exposes `getBalance` and `swapToUsdc` so the CLI can offer `skill-crypt balance` and `skill-crypt swap`

## How to adapt it for your own project

1. Install xmtp-paywall as an optional dependency:
   ```bash
   npm install github:skillcrypt-alt/xmtp-paywall --save-optional
   ```

2. Copy `src/payment.js` into your project.

3. Change the message type prefix from `skillcrypt:` to your own namespace:
   ```js
   invoice.type = 'myapp:invoice';  // was 'skillcrypt:invoice'
   ```

4. In your message handler, call `buildSkillInvoice` when a resource has a price, and call `verifySkillPayment` when you receive a payment notification.

5. That's it. xmtp-paywall handles the rest.

## Integration surface

The full integration is 3 call sites in skill-crypt's codebase:

| File | What it does |
|------|-------------|
| `src/transfer.js` | calls `buildSkillInvoice` when a skill has a price; calls `verifySkillPayment` when payment arrives |
| `src/cli.js` | calls `paySkillInvoice` in the listener's onEvent handler (buyer auto-pays); calls `getBalance` / `swapToUsdc` for CLI commands |
| `src/payment.js` | the only file that imports from xmtp-paywall |

Free skills never load `payment.js`. If xmtp-paywall is not installed, free skills work exactly as before.

## Payment flow

```
buyer                                    seller
  |                                        |
  |-- transfer request (XMTP DM) -------> |
  |                                        | (checks price, loads payment.js)
  | <-- skillcrypt:invoice (XMTP DM) ----|
  |                                        |
  | (auto-pays USDC on Base)               |
  |-- skillcrypt:payment (txHash) -------> |
  |                                        | (verifySkillPayment: reads Transfer
  |                                        |  event from Base RPC, trustless)
  | <-- skillcrypt:payment-verified -------|
  | <-- SKILL_TRANSFER (encrypted) --------|
  | <-- TRANSFER_KEY (ephemeral key) ------|
  |                                        |
  | (decrypts, stores in vault)            |
```

No server. No facilitator. The only on-chain action is the USDC transfer itself.
