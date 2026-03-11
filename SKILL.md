# Skill-Crypt: Encrypted Skill Manager

Manage your agent's skills as encrypted vault entries backed by XMTP instead of plaintext files on disk.

## When to Use This Skill

Use this when you need to:
- Encrypt a plaintext skill so it is no longer readable from the filesystem
- Load an encrypted skill from the vault into your context for a task
- Share a skill with another agent over XMTP
- Receive a skill transfer from another agent
- List, search, or remove skills from your encrypted vault
- Migrate all plaintext skills off disk into the vault

## How It Works

Your skills are encrypted with AES-256-GCM using a key derived from your wallet private key. They are stored as `.enc` files in the vault directory. A plaintext manifest tracks metadata (names, tags, sizes) but never skill content.

When you need a skill, you decrypt it to stdout and read it into your context. The plaintext exists only in your process memory. It is never written to a file.

When sharing with another agent, the skill is sent over XMTP end-to-end encryption. The receiving agent re-encrypts with their own wallet key.

## Commands

All commands require `SKILLCRYPT_WALLET_KEY` to be set in the environment.

**Encrypt a skill into the vault:**
```bash
node src/cli.js encrypt /path/to/SKILL.md
```

**Decrypt a skill into your context (stdout only, never redirect to file):**
```bash
node src/cli.js decrypt <skill-id>
```

**List all encrypted skills:**
```bash
node src/cli.js vault list
```

**Search skills by name, tag, or description:**
```bash
node src/cli.js vault find <query>
```

**Remove a skill from the vault:**
```bash
node src/cli.js vault remove <skill-id>
```

**Request a skill catalog from another agent (requires XMTP):**
```bash
node src/cli.js transfer catalog <wallet-address>
```

**Request a specific skill from another agent:**
```bash
node src/cli.js transfer request <wallet-address> <skill-id>
```

**Listen for incoming skill requests and transfers:**
```bash
node src/cli.js transfer listen
```

## Workflow: Loading a Skill for a Task

1. Check the vault for the skill you need: `vault list` or `vault find`
2. Decrypt it to stdout: `decrypt <skill-id>`
3. Read the output into your context window
4. Follow the skill's instructions to complete the task
5. The decrypted content exists only in your context. Do not save it.

## Workflow: Sharing a Skill

1. Decrypt the skill from your vault into memory
2. Send it via `transfer` to the recipient's wallet address
3. XMTP encrypts it end-to-end during transit
4. The receiving agent stores it encrypted with their own wallet key
5. Confirm receipt via the `skillcrypt:ack` message

## Security Rules

- Never write decrypted skill content to a file
- Never include skill content in logs, error messages, or chat responses
- Never share the wallet private key
- Never commit the vault directory or `.enc` files to version control
- When loading a skill, the plaintext lives only in your context window for the current task

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| SKILLCRYPT_WALLET_KEY | Yes | | Wallet private key (hex) |
| SKILLCRYPT_VAULT | No | ./data/vault | Vault storage directory |
| SKILLCRYPT_XMTP_ENV | No | production | XMTP network (production or dev) |
