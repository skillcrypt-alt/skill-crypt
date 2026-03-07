# Skill-Crypt: Encrypted Skill Manager

Manage encrypted skills for your agent. Store skills as encrypted files that only your wallet key can unlock. Share skills with other agents over XMTP end-to-end encrypted messaging.

## When to Use This Skill

Use this skill when you need to:
- Encrypt a skill file so it cannot be read from disk
- Decrypt and load a skill into your context for execution
- Share a skill with another agent securely
- Receive a skill from another agent
- List or search your encrypted skill vault

## Setup

The skill-crypt directory must be available on the agent's machine. Set the wallet key as an environment variable before running any commands.

```bash
export SKILLCRYPT_WALLET_KEY=<your-wallet-private-key>
```

The vault directory defaults to `./data/vault` relative to the skill-crypt installation. Override with `SKILLCRYPT_VAULT`.

## Encrypting a Skill

To encrypt a skill file and store it in your vault:

```bash
node src/cli.js encrypt /path/to/SKILL.md
```

This reads the plaintext file, encrypts it with your wallet-derived key, stores the encrypted version as a `.enc` file, and records metadata in the manifest. The original plaintext file can then be deleted.

## Decrypting a Skill

To load a skill into your context:

```bash
node src/cli.js decrypt <skill-id>
```

This outputs the decrypted skill to stdout. Read the output into your context window and follow the skill's instructions. Do not redirect the output to a file.

## Vault Operations

**List all encrypted skills:**
```bash
node src/cli.js vault list
```

**Search by name, tag, or description:**
```bash
node src/cli.js vault find <query>
```

**Remove a skill from the vault:**
```bash
node src/cli.js vault remove <skill-id>
```

## Sharing Skills with Other Agents

All transfers happen over XMTP. Both agents must have XMTP-registered wallets.

**Request another agent's skill catalog:**
```bash
node src/cli.js transfer catalog <their-wallet-address>
```

**Request a specific skill:**
```bash
node src/cli.js transfer request <their-wallet-address> <skill-id>
```

**Listen for incoming requests and transfers:**
```bash
node src/cli.js transfer listen
```

When you receive a skill transfer, it is automatically encrypted with your wallet key and stored in your vault.

## Loading a Received Skill

After receiving a skill via transfer, it appears in your vault. Load it the same way:

```bash
node src/cli.js decrypt <skill-id>
```

Read the decrypted output into your context and execute it.

## Security Rules

- Never write decrypted skill content to a file
- Never include skill content in logs or error messages
- Never share your wallet private key
- Never commit the vault directory or `.enc` files to version control
- Skills in transit are protected by XMTP E2E encryption (MLS protocol)
- Skills at rest are protected by AES-256-GCM with your wallet-derived key
- The only place a skill exists in plaintext is inside your process memory

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| SKILLCRYPT_WALLET_KEY | Yes | | Wallet private key (hex) |
| SKILLCRYPT_VAULT | No | ./data/vault | Vault storage directory |
| SKILLCRYPT_XMTP_ENV | No | production | XMTP network (production or dev) |
