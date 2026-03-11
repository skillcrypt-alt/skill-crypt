# Getting Started with Skill-Crypt

This guide covers setting up skill-crypt as an OpenClaw skill, encrypting your first skill, and sharing it with another agent.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- Node.js 20 or later
- An Ethereum wallet (any EOA with a private key)

## Install

Clone skill-crypt into your OpenClaw workspace skills directory:

```bash
cd ~/.openclaw/workspace/skills
git clone https://github.com/skillcrypt/skill-crypt.git
cd skill-crypt
npm install
```

OpenClaw automatically discovers skills in the workspace. Once cloned, your agent can read the SKILL.md and use skill-crypt through natural language.

## Configure Your Wallet Key

Skill-crypt derives its encryption key from your agent's wallet private key. Set it in your environment:

```bash
export SKILLCRYPT_WALLET_KEY=0xYourPrivateKeyHere
```

If your agent already has a wallet for XMTP or on-chain operations, use the same key. One identity for everything.

For persistent configuration, add the export to your shell profile or OpenClaw's environment configuration. Do not commit this value to version control.

## Encrypt Your First Skill

Say you have a plaintext skill at `~/.openclaw/workspace/skills/web-scraper/SKILL.md` that you want to protect. Tell your agent:

> "Encrypt the web-scraper skill."

Or use the CLI directly:

```bash
SKILLCRYPT_WALLET_KEY=$KEY node src/cli.js encrypt ~/.openclaw/workspace/skills/web-scraper/SKILL.md
```

Output:
```
stored: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  name: skill
  hash: sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
  size: 2048 bytes
```

The skill is now encrypted in the vault. The original plaintext file can be removed.

## List Your Vault

Ask your agent: "What skills do I have encrypted?"

Or via CLI:

```bash
node src/cli.js vault list
```

```
1 skill(s) in vault:

  a1b2c3d4-e5f6-7890-abcd-ef1234567890
    name: skill v1.0.0
    tags: none
    size: 2048 bytes
    stored: 2026-03-09T15:30:00.000Z
```

## Load and Use a Skill

When your agent needs to use an encrypted skill for a task, tell it:

> "Load the web-scraper skill, I need you to scrape example.com."

Behind the scenes, the agent decrypts the skill to stdout, reads the content into its context window, and follows the instructions. The decrypted skill never touches the filesystem. It exists only in the agent's working memory for the duration of the task.

CLI equivalent:

```bash
node src/cli.js decrypt a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

## Share a Skill with Another Agent

Both agents need wallets registered on XMTP. If your agent already uses XMTP for messaging, it is ready.

### Sending

Tell your agent:

> "Share my email-handler skill with 0xReceiverAddress."

The agent decrypts the skill from your vault into memory, sends it over XMTP (end-to-end encrypted), and the receiving agent stores it encrypted with their own key.

### Receiving

Tell your agent:

> "Listen for incoming skill transfers."

Or to actively request from another agent:

> "Get the skill catalog from 0xSenderAddress."
> "Request the web-scraper skill from 0xSenderAddress."

Received skills are automatically encrypted with your wallet key and added to your vault.

### CLI equivalent

```bash
# sender listens
node src/cli.js transfer listen

# receiver requests
node src/cli.js transfer catalog 0xSenderAddress
node src/cli.js transfer request 0xSenderAddress <skill-id>
```

## How It Works

1. Your wallet private key is run through HKDF-SHA256 to derive a 256-bit AES key
2. Skills are encrypted with AES-256-GCM (random IV, authenticated)
3. Encrypted skills are stored as `.enc` files with a plaintext manifest for indexing
4. Transfers use XMTP's MLS-based E2E encryption for the network layer
5. On receipt, the receiving agent re-encrypts with their own derived key

The wallet is the single point of trust. Same wallet on a different machine gives access to your skills. Different wallet, no access.

## Next Steps

- Read [PROTOCOL.md](../PROTOCOL.md) for the full protocol specification
- Read [SKILL.md](../SKILL.md) for the OpenClaw agent integration reference
- Run `node src/cli.js help` for all available CLI commands
