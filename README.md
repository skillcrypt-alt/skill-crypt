# skill-crypt

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-29%20passing-brightgreen.svg)](#tests)
[![XMTP](https://img.shields.io/badge/transport-XMTP%20MLS-purple.svg)](https://xmtp.org)
[![Encryption](https://img.shields.io/badge/encryption-AES--256--GCM-orange.svg)](#security-model)

Encrypted skill storage and agent-to-agent skill transfer over XMTP.

## Why This Exists

AI agents are built on skills: structured instruction sets that define what the agent can do and how it does it. These skills represent real capability and, for many agent operators, real intellectual property.

Today, skills are plaintext markdown files sitting on disk. Anyone with access to the machine can read them. When agents share capabilities with each other, there is no standard way to do it securely.

Skill-crypt fixes both problems.

**Encryption at rest.** Every skill in the vault is encrypted with AES-256-GCM using a key derived from the agent's wallet. On disk, skills are unreadable binary blobs. Without the wallet key, they are useless.

**Encrypted transfer.** Agent-to-agent skill sharing happens over XMTP, which provides end-to-end encryption via the MLS protocol. Skills are decrypted from the sender's vault, transmitted through XMTP's encrypted channel, and re-encrypted with the receiver's wallet key on arrival. The plaintext is never exposed outside of process memory.

**Wallet-based access control.** The agent's Ethereum wallet is the single key to everything. Same wallet on a new machine means full access to your skills. No wallet, no skills. No accounts, no passwords, no servers.

## Quick Start

Tell your OpenClaw agent:

> "Install skill-crypt from https://github.com/skillcrypt/skill-crypt into my skills."

That's it. Your agent clones the repo into its workspace, installs dependencies, and the skill is ready to use.

### Set up your wallet

Your agent needs an Ethereum wallet key to derive its encryption key. If your agent already has a wallet, tell it:

> "Use my existing wallet key for skill-crypt."

If not:

> "Generate a new wallet for skill-crypt encryption."

The wallet key goes into the `SKILLCRYPT_WALLET_KEY` environment variable. Your agent handles this.

### Encrypt a skill

> "Encrypt my web-scraper skill so nobody can read it from disk."

Your agent encrypts the skill, stores it in the vault, and can remove the original plaintext file.

### List your vault

> "What skills do I have encrypted?"

### Use an encrypted skill

> "Load the web-scraper skill, I need to scrape example.com."

The agent decrypts the skill into its context window, follows the instructions, and the plaintext never touches the filesystem.

### Share a skill with another agent

> "Share my email-handler skill with the agent at 0xTheirWalletAddress."

The skill is sent over XMTP end-to-end encryption. The receiving agent automatically re-encrypts it with their own wallet key.

### Receive skills

> "Check if any agents have sent me skills."

Incoming transfers arrive over XMTP and get stored in your vault, encrypted with your key.

## How It Works

```
Sender                                    Receiver
  |                                          |
  |  vault: decrypt skill into memory        |
  |                                          |
  |  --- XMTP E2E encrypted transfer --->   |
  |                                          |
  |                    vault: encrypt with   |
  |                    receiver's wallet key |
  |                                          |
  |  <-- XMTP E2E encrypted ack ----------  |
```

At no point does a plaintext skill file exist on either machine's filesystem. Skills are cleartext only inside the agent's running process.

## Architecture

```
src/
  crypto.js        AES-256-GCM encryption, HKDF key derivation
  vault.js         Encrypted local storage with manifest indexing
  transfer.js      XMTP protocol messages: catalog, request, transfer, ack
  xmtp-client.js   XMTP Node SDK wrapper for E2E encrypted messaging
  cli.js           Command-line interface (used by the agent internally)
  index.js         Public API

test/
  crypto.test.js   Key derivation, encrypt/decrypt, tamper detection
  vault.test.js    Store, load, search, remove, cross-key rejection
  transfer.test.js Protocol message building and parsing

docs/
  getting-started.md   Detailed setup and usage guide

PROTOCOL.md        Full protocol specification
SKILL.md           OpenClaw agent skill definition
```

## Security Model

| Layer | Protection | Implementation |
|-------|-----------|----------------|
| At rest | Skills encrypted on disk | AES-256-GCM, HKDF-SHA256 key from wallet |
| In transit | E2E encrypted transfers | XMTP MLS protocol |
| In memory | Plaintext only in process | Never written to filesystem |
| Access control | Wallet-based | No wallet key, no decryption |
| Integrity | Content hashing | SHA-256 hash verified on decrypt |
| Tamper detection | Authenticated encryption | GCM auth tag rejects modified ciphertext |

## Transfer Protocol

The transfer protocol defines five message types exchanged over XMTP:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `skillcrypt:catalog-request` | Receiver to Sender | Ask what skills are available |
| `skillcrypt:catalog` | Sender to Receiver | Respond with skill metadata (no content) |
| `skillcrypt:skill-request` | Receiver to Sender | Request a specific skill by ID |
| `skillcrypt:skill-transfer` | Sender to Receiver | Deliver the full skill content |
| `skillcrypt:ack` | Receiver to Sender | Confirm receipt and storage |

See [PROTOCOL.md](PROTOCOL.md) for the complete specification including message schemas, key derivation details, and XMTP considerations.

## Tests

```bash
npm test
```

29 tests covering encryption, vault operations, and the transfer protocol.

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) (or any agent framework that supports skill installation)
- Node.js 20+
- An Ethereum wallet

## License

MIT
