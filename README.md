# skill-crypt

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-30%20passing-brightgreen.svg)](#tests)
[![XMTP](https://img.shields.io/badge/transport-XMTP%20MLS-purple.svg)](https://xmtp.org)
[![Encryption](https://img.shields.io/badge/encryption-AES--256--GCM-orange.svg)](#security-model)

Encrypted agent skills that live on XMTP, not on your filesystem.

## The Idea

Agent skills today are markdown files in a directory. They sit on disk in plaintext. Anyone who can access the machine can read them, copy them, or steal them.

Skill-crypt moves skills off the machine entirely. Your skills live inside your XMTP inbox, encrypted with your Ethereum wallet key. When your agent needs a skill, it pulls it from XMTP into memory, uses it, and never writes it to disk. When you want to share a skill with another agent, it travels through XMTP end-to-end encryption and gets re-encrypted with the receiver's wallet key on arrival.

Your wallet is your skill vault. XMTP is your skill directory.

## How It Works

```
Traditional agent skills:

  ~/.openclaw/workspace/skills/
    web-scraper/SKILL.md      <- plaintext on disk
    email-handler/SKILL.md    <- plaintext on disk
    calendar/SKILL.md         <- plaintext on disk

With skill-crypt:

  XMTP Inbox (E2E encrypted, wallet-locked)
    ├── web-scraper.enc       <- only your wallet can read this
    ├── email-handler.enc     <- only your wallet can read this
    └── calendar.enc          <- only your wallet can read this

  Disk: nothing. Zero plaintext skill files.
```

When your agent needs a skill, it connects to XMTP with its wallet key, pulls the encrypted skill, decrypts it into its context window, and executes. The skill exists in memory for the duration of the task and then it is gone.

## Getting Started

Everything happens through conversation with your OpenClaw agent. You do not need to touch a terminal, write code, or manage config files.

### 1. Install skill-crypt

> "Install skill-crypt from https://github.com/skillcrypt/skill-crypt"

Your agent clones the repo into its skills directory and installs dependencies. The SKILL.md tells your agent how to use everything from here.

### 2. Set up a wallet

> "Generate me an Ethereum wallet for skill-crypt."

Your agent generates a wallet, saves the private key securely, and configures skill-crypt to use it. This wallet becomes your agent's identity on XMTP, its encryption key for skills, and its address for receiving skill transfers from other agents.

If your agent already has a wallet:

> "Use my existing wallet for skill-crypt."

### 3. Register on XMTP

> "Register my wallet on XMTP so I can send and receive encrypted skills."

Your agent connects to the XMTP production network with your wallet, creating your encrypted inbox. This is a one-time step. After registration, your inbox persists on the network and works from any machine with the same wallet key.

### 4. Move your skills off disk

> "Encrypt all my plaintext skills into the vault and remove the originals."

Your agent reads each skill from the skills directory, encrypts it with your wallet-derived key, stores the encrypted version, and deletes the plaintext. Your skills directory goes from readable markdown files to nothing.

Or do it one at a time:

> "Encrypt my web-scraper skill and delete the plaintext."

### 5. Use skills normally

You do not need to think about encryption. Just ask for what you need:

> "Scrape example.com for pricing data."

Your agent checks its vault, finds the relevant skill, decrypts it into memory, follows the instructions, and completes the task. The skill was never a file on disk during any of this.

### 6. Share skills with other agents

> "Share my data-analysis skill with 0xAgentBAddress."

Your agent decrypts the skill in memory, sends it over XMTP to the other agent's wallet, and the receiving agent re-encrypts it with their own key. The skill traveled between two agents without ever being a plaintext file on either machine.

### 7. Rotate your wallet key

> "Generate a new wallet and rotate my skill-crypt vault to use it."

Your agent creates a new wallet, re-encrypts every skill in the vault with the new key, and updates the config. The old key is immediately useless. Use this on a schedule or any time a key might be compromised.

### 8. Receive skills

> "Check if anyone has sent me skills."

> "Get the skill catalog from 0xAgentAAddress."

> "Request the code-review skill from 0xAgentAAddress."

Incoming skills arrive over XMTP, get re-encrypted with your wallet key, and land in your vault ready to use.

## The Transfer Protocol

Agents communicate using five message types over XMTP:

| Message | Purpose |
|---------|---------|
| `skillcrypt:catalog-request` | "What skills do you have?" |
| `skillcrypt:catalog` | Skill metadata response (names, tags, sizes, no content) |
| `skillcrypt:skill-request` | "Send me this specific skill." |
| `skillcrypt:skill-transfer` | Full skill content (encrypted by XMTP in transit) |
| `skillcrypt:ack` | "Got it, stored in my vault." |

No servers, no coordinators, no registries. Two wallets talking over encrypted messaging.

See [PROTOCOL.md](PROTOCOL.md) for the complete specification.

## Security Model

| Layer | What it protects | How |
|-------|-----------------|-----|
| At rest | Skills on disk | AES-256-GCM, key derived from wallet via HKDF-SHA256 |
| In transit | Skills between agents | XMTP MLS end-to-end encryption |
| In memory | Runtime exposure | Decrypted only into process memory, never to filesystem |
| Access control | Who can read skills | Wallet private key is the only key |
| Integrity | Tampering | SHA-256 content hash verified on decrypt |
| Authentication | Modified ciphertext | GCM auth tag rejects any changes |

## Architecture

```
src/
  crypto.js        AES-256-GCM encryption, HKDF key derivation from wallet
  vault.js         Encrypted skill storage with manifest indexing
  transfer.js      XMTP protocol: catalog, request, transfer, ack
  xmtp-client.js   XMTP Node SDK wrapper for wallet-based E2E messaging
  cli.js           Internal CLI (used by the agent, not the user)
  index.js         Public API for programmatic use

test/
  crypto.test.js   Key derivation, encrypt/decrypt, tamper detection
  vault.test.js    Store, load, search, remove, cross-wallet rejection
  transfer.test.js Protocol message building and parsing
```

## Tests

```bash
npm test
```

29 tests covering encryption, vault operations, and the transfer protocol.

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) or any agent framework that supports skill installation
- Node.js 20+

## License

MIT
