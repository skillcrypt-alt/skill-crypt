# Getting Started

## Install

Tell your OpenClaw agent:

> "Install skill-crypt from https://github.com/skillcrypt/skill-crypt into my skills."

Your agent clones the repository into its workspace skills directory and runs `npm install`. The skill is immediately available.

## Wallet Setup

Skill-crypt encrypts everything with a key derived from an Ethereum wallet. If your agent already has one, point skill-crypt at it:

> "Use my existing wallet key for skill-crypt."

If you need a new wallet:

> "Generate a wallet for skill-crypt."

The private key is stored in `SKILLCRYPT_WALLET_KEY`. Your agent manages this. You do not need to touch any config files.

## Encrypting Skills

Pick any skill you want to protect:

> "Encrypt my calendar-sync skill."

The agent reads the plaintext SKILL.md, encrypts it with your wallet-derived key, stores the encrypted version in the vault, and optionally removes the original. On disk, the skill is now an unreadable `.enc` blob.

## Using Encrypted Skills

When you need a skill for a task, just ask:

> "Load the calendar-sync skill and check my schedule for tomorrow."

The agent decrypts the skill into its context window, follows the instructions, and completes the task. The decrypted content exists only in the agent's working memory. It is never written to a file.

## Managing the Vault

> "What skills do I have encrypted?"

Lists all skills in the vault with their names, tags, and sizes. No content is shown.

> "Search my vault for anything related to email."

Searches by name, tag, and description.

> "Remove the old web-scraper skill from my vault."

Deletes the encrypted file and removes the manifest entry.

## Sharing Skills

Both agents need wallets registered on XMTP. If your agent uses XMTP for anything else, it is already set up.

### Sending a skill

> "Share my data-analysis skill with 0xAgentBAddress."

The agent decrypts the skill in memory, sends it over XMTP (end-to-end encrypted), and the receiving agent stores it encrypted with their own wallet key. The plaintext is never exposed on either machine's disk.

### Receiving skills

> "Listen for incoming skill transfers."

Or request from a specific agent:

> "Get the skill catalog from 0xAgentAAddress."

> "Request the image-analysis skill from 0xAgentAAddress."

Received skills are encrypted with your wallet key and added to your vault automatically.

## How the Encryption Works

1. Your wallet private key goes through HKDF-SHA256 to produce a 256-bit AES key
2. Each skill is encrypted with AES-256-GCM using a random IV
3. Encrypted skills are stored as `.enc` files in the vault directory
4. A plaintext manifest tracks metadata (names, tags, sizes) but never content
5. Transfers use XMTP's MLS protocol for end-to-end encryption between wallets
6. On receipt, the receiving agent re-encrypts with their own derived key

The wallet is the single point of trust. Same wallet on a new machine, same access to your skills. Different wallet, no access.

## Further Reading

- [PROTOCOL.md](../PROTOCOL.md) for the full protocol specification
- [SKILL.md](../SKILL.md) for the agent skill reference
