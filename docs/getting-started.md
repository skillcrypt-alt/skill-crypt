# Getting Started

## Prerequisites

- An Ethereum wallet with a private key
- The wallet registered on the XMTP network (happens automatically on first connect)
- [OpenClaw](https://github.com/openclaw/openclaw) running

## What You Need to Know

Skill-crypt replaces your plaintext skills directory with an encrypted vault backed by XMTP. Instead of skills living as readable files on your machine, they live as encrypted blobs that only your wallet key can open. When your agent needs a skill, it pulls it from the vault into memory, uses it, and the plaintext is gone when the task is done.

Sharing skills with other agents works the same way. Both agents have wallets on XMTP. The skill travels through XMTP's end-to-end encrypted channel. The receiving agent re-encrypts with their own key. No plaintext ever hits disk on either side.

## Wallet Setup

Your Ethereum wallet is your identity, your encryption key, and your XMTP address all in one. If you already have a wallet, use it. If not:

```bash
cast wallet new
```

Your wallet needs to be on mainnet. XMTP production network uses mainnet wallet addresses for identity. The wallet does not need ETH in it (XMTP messaging is free), but it does need to be a real mainnet EOA.

## Install

> "Install skill-crypt from https://github.com/skillcrypt/skill-crypt"

Set the wallet key:

```bash
export SKILLCRYPT_WALLET_KEY=0xYourPrivateKey
```

## Register on XMTP

The first time skill-crypt connects, it registers your wallet on the XMTP network and creates your encrypted inbox. This is automatic. After registration, your inbox persists on the network and you can send and receive skill transfers from any machine using the same wallet.

## Migrate Skills Off Disk

Take your existing skills and move them into the encrypted vault:

> "Encrypt all my plaintext skills and remove the originals."

After migration, your skills directory is empty. Your skills live in the vault as `.enc` files that are unreadable without your wallet key. The manifest (a JSON index of skill names, tags, and sizes) remains readable so your agent can list and search without decrypting everything.

## Daily Use

You do not interact with skill-crypt directly. Your agent handles everything.

**Need a skill for a task?** Just describe the task. If the agent has the right skill in its vault, it decrypts and loads it automatically.

**Want to send a skill to another agent?** Give the wallet address. The agent handles the XMTP transfer.

**Want to see what is in your vault?** Ask. The agent reads the manifest and tells you.

## How Transfers Work

1. You tell your agent to share a skill with `0xReceiverAddress`
2. Your agent decrypts the skill from vault into memory
3. Your agent sends it to the receiver over XMTP (MLS end-to-end encrypted)
4. The receiver's agent gets the message, decrypts via XMTP
5. The receiver's agent re-encrypts with their own wallet-derived key
6. The skill is now in the receiver's vault, locked to their wallet

The skill was never a plaintext file on either machine. It existed in cleartext only inside each agent's process memory during the transfer.

## Further Reading

- [PROTOCOL.md](../PROTOCOL.md) for the full protocol specification
- [SKILL.md](../SKILL.md) for the agent skill reference
