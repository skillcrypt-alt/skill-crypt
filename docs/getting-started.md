# Getting Started with Skill-Crypt

This guide walks through setting up skill-crypt on an OpenClaw agent, encrypting your first skill, and sharing it with another agent.

## Prerequisites

- Node.js 20 or later
- An Ethereum wallet (any EOA wallet with a private key)
- OpenClaw installed and running (for agent integration)
- Another agent's wallet address (for transfers)

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/skillcrypt/skill-crypt.git
cd skill-crypt
npm install
```

## Configure Your Wallet Key

Skill-crypt derives its encryption key from your agent's wallet private key. Set it as an environment variable:

```bash
export SKILLCRYPT_WALLET_KEY=0xYourPrivateKeyHere
```

For persistent configuration, add it to your agent's environment file. Do not commit this value to version control.

## Encrypt Your First Skill

Say you have a skill file at `~/skills/web-scraper/SKILL.md`. To encrypt it:

```bash
node src/cli.js encrypt ~/skills/web-scraper/SKILL.md
```

Output:
```
stored: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  name: skill
  hash: sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
  size: 2048 bytes
```

The skill is now encrypted in `./data/vault/` as a `.enc` file. The original plaintext can be deleted.

## List Your Vault

```bash
node src/cli.js vault list
```

Output:
```
1 skill(s) in vault:

  a1b2c3d4-e5f6-7890-abcd-ef1234567890
    name: skill v1.0.0
    tags: none
    size: 2048 bytes
    stored: 2026-03-09T15:30:00.000Z
```

## Decrypt and Use a Skill

When your agent needs to use an encrypted skill:

```bash
node src/cli.js decrypt a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

This prints the decrypted skill to stdout. In an OpenClaw context, the agent reads this output into its context window and follows the instructions. The decrypted content never touches the filesystem.

## Install as an OpenClaw Skill

To let your OpenClaw agent manage the vault through natural language:

```bash
cp -r . ~/.openclaw/workspace/skills/skill-crypt/
```

Your agent can now respond to requests like "encrypt my web scraper skill" or "list my encrypted skills" by reading the SKILL.md and executing the appropriate commands.

## Share a Skill with Another Agent

Both agents need XMTP-registered wallets (any wallet that has created an XMTP client).

### On the sending agent

Start listening for incoming requests:

```bash
node src/cli.js transfer listen
```

### On the receiving agent

Request the sender's catalog:

```bash
node src/cli.js transfer catalog 0xSenderWalletAddress
```

The sender's agent automatically responds with a list of available skills. Then request a specific skill:

```bash
node src/cli.js transfer request 0xSenderWalletAddress <skill-id>
```

The skill is transferred over XMTP (end-to-end encrypted), received by the requesting agent, and stored in their vault encrypted with their own wallet key.

## How It Works Under the Hood

1. Your wallet private key is run through HKDF-SHA256 to derive a 256-bit AES key
2. Skills are encrypted with AES-256-GCM (random IV, authenticated)
3. Encrypted skills are stored as `.enc` files with a plaintext manifest for indexing
4. Transfers use XMTP's MLS-based E2E encryption for the network layer
5. On receipt, the receiving agent re-encrypts with their own derived key

The wallet is the single point of trust. Same wallet on a different machine gives you access to re-encrypt and use your skills. Different wallet, no access.

## Next Steps

- Read [PROTOCOL.md](../PROTOCOL.md) for the full protocol specification
- Read [SKILL.md](../SKILL.md) for the OpenClaw agent integration reference
- Run `node src/cli.js help` for all available commands
