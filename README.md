# skill-crypt

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-29%20passing-brightgreen.svg)](#tests)
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

When two agents want to exchange skills, the transfer is fully encrypted in transit via XMTP's MLS protocol. The receiving agent re-encrypts the skill with its own wallet key. Neither agent ever has a plaintext skill file on disk.

## Getting Started

### 1. You need an Ethereum wallet

Your agent needs an Ethereum wallet deployed on mainnet. This wallet serves three purposes:

- **Identity.** Your wallet address is how other agents find you on XMTP.
- **Encryption.** Your private key derives the AES-256 key that locks your skills.
- **Messaging.** XMTP uses your wallet for end-to-end encrypted communication.

If your agent already has a wallet, use it. If not, generate one:

```bash
# using ethers.js, cast, or any wallet tool
cast wallet new
```

Save the private key securely. This is the only key you need for everything.

### 2. Register your wallet on XMTP

Your wallet needs to be registered on the XMTP network before you can store or transfer skills. The first time you connect, XMTP creates your inbox:

```javascript
import { SkillCryptClient } from 'skill-crypt';

const client = new SkillCryptClient({
  privateKey: '0xYourPrivateKey',
  env: 'production'  // mainnet XMTP network
});

await client.connect();
console.log('registered on XMTP as', client.getAddress());
```

This only needs to happen once. After registration, your inbox persists on the XMTP network tied to your wallet address.

### 3. Install the skill

Tell your OpenClaw agent:

> "Install skill-crypt from https://github.com/skillcrypt/skill-crypt"

Or clone it manually:

```bash
cd ~/.openclaw/workspace/skills
git clone https://github.com/skillcrypt/skill-crypt.git
cd skill-crypt && npm install
```

Set your wallet key in the environment:

```bash
export SKILLCRYPT_WALLET_KEY=0xYourPrivateKey
```

### 4. Move your skills off disk and into XMTP

Take your existing plaintext skills and encrypt them into your XMTP-backed vault:

> "Encrypt all my skills into skill-crypt so they're off disk."

Or one at a time:

> "Encrypt my web-scraper skill and remove the plaintext."

The agent reads each skill, encrypts it with your wallet-derived key, stores it in the vault, and deletes the original file. Your skills directory goes from full of readable markdown to empty.

### 5. Use skills from your vault instead of the filesystem

When your agent needs a skill, it no longer reads from the skills directory. It pulls from the encrypted vault:

> "I need you to scrape example.com for pricing data."

The agent knows it has a web-scraper skill in the vault. It decrypts the skill into its context window, follows the instructions, and completes the task. The decrypted content never touches the filesystem.

### 6. Share skills with other agents

This is where XMTP shines. You and another agent are both on the XMTP network with registered wallets. Sharing a skill is a direct encrypted message between wallets.

> "Share my data-analysis skill with 0xAgentBAddress."

What happens:
1. Your agent decrypts the skill from your vault into memory
2. Sends it to 0xAgentBAddress over XMTP (MLS end-to-end encrypted)
3. Agent B receives the message, decrypts it with XMTP
4. Agent B re-encrypts the skill with their own wallet key
5. Agent B stores it in their vault

The skill traveled between two agents without ever existing as a plaintext file on either machine.

### 7. Receive skills from other agents

> "Check if anyone has sent me skills."

Or request from a specific agent:

> "Get the skill catalog from 0xAgentAAddress."

> "Request the code-review skill from 0xAgentAAddress."

Received skills arrive over XMTP and get stored in your vault encrypted with your key. You can list, search, and use them like any skill you encrypted yourself.

## The Transfer Protocol

Agents communicate using five message types over XMTP:

| Message | Purpose |
|---------|---------|
| `skillcrypt:catalog-request` | "What skills do you have?" |
| `skillcrypt:catalog` | Skill metadata response (names, tags, sizes, no content) |
| `skillcrypt:skill-request` | "Send me this specific skill." |
| `skillcrypt:skill-transfer` | Full skill content (encrypted by XMTP in transit) |
| `skillcrypt:ack` | "Got it, stored in my vault." |

This is a simple request-response protocol. No servers, no coordinators, no registries. Just two wallets talking over encrypted messaging.

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
  cli.js           CLI interface (used by the agent internally)
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

- Node.js 20+
- An Ethereum wallet (EOA with private key, registered on XMTP)
- [OpenClaw](https://github.com/openclaw/openclaw) or any agent framework

## License

MIT
