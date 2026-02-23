# Skill-Crypt Protocol Specification

## Overview

Skill-crypt defines a protocol for encrypted skill storage and transfer between AI agents. It uses wallet-derived encryption for local storage and XMTP for secure agent-to-agent communication.

## Threat Model

**Disk access.** An attacker gains read access to the agent's filesystem. Without the wallet private key, encrypted skill files are unreadable.

**Network interception.** An attacker monitors traffic between agents. XMTP's MLS-based end-to-end encryption prevents message content from being read in transit.

**Machine theft.** The agent's hardware is physically compromised. Skills remain encrypted at rest. The wallet key is the single point of access control.

## Encryption

### Key Derivation

The encryption key is derived from the agent's wallet private key using HKDF-SHA256:

```
wallet_private_key
  -> HKDF-SHA256(ikm=privkey, salt="skillcrypt-v1", info="skill-encryption")
  -> 256-bit AES key
```

This means:
- Same wallet always produces the same encryption key
- Different wallets produce different keys
- The wallet private key never touches disk in any new form
- Key derivation is deterministic and portable across machines

### Encryption Algorithm

AES-256-GCM (authenticated encryption with associated data). Each encryption operation uses a random 16-byte IV, producing a 16-byte authentication tag. The output format is:

```
[IV: 16 bytes][Auth Tag: 16 bytes][Ciphertext: variable]
```

GCM mode provides both confidentiality and integrity. If any byte of the encrypted file is modified, decryption will fail.

## Skill Message Format

Skills are transmitted between agents as JSON messages with the following structure:

```json
{
  "type": "skillcrypt:skill-transfer",
  "skillId": "uuid-v4",
  "name": "skill-name",
  "version": "1.0.0",
  "description": "What this skill does",
  "tags": ["category", "subcategory"],
  "author": "0xWalletAddress",
  "createdAt": "2026-02-23T00:00:00Z",
  "contentHash": "sha256:abcdef...",
  "content": "# SKILL.md contents..."
}
```

The `contentHash` field allows the receiver to verify integrity after decryption.

## Transfer Protocol

The transfer protocol uses five message types over XMTP:

```
Agent A (sender)                    Agent B (receiver)
     |                                    |
     |  <-- skillcrypt:catalog-request -- |  "what skills do you offer?"
     |                                    |
     |  -- skillcrypt:catalog ----------> |  metadata only, no content
     |                                    |
     |  <-- skillcrypt:skill-request ---- |  "send me skill X"
     |                                    |
     |  -- skillcrypt:skill-transfer ---> |  full skill, encrypted by XMTP
     |                                    |
     |  <-- skillcrypt:ack -------------- |  "received and stored"
     |                                    |
```

### Message Types

**catalog-request.** No payload. Asks the receiving agent to list available skills.

**catalog.** Contains an array of skill metadata objects (id, name, version, description, tags, size). Does not include skill content.

**skill-request.** Contains the `skillId` of the desired skill.

**skill-transfer.** Contains the full skill payload including content. XMTP encrypts this end-to-end during transit. On receipt, the agent re-encrypts with its own wallet key before storing.

**ack.** Confirms receipt. Contains `skillId` and a `success` boolean.

## Vault Storage

Each agent maintains a local vault: a directory of encrypted `.enc` files plus a `manifest.json` that maps skill IDs to filenames and metadata.

The manifest is not encrypted (it contains no skill content), which allows the agent to list and search skills without decrypting everything. Skill content is encrypted individually per file.

```
data/vault/
  manifest.json         <- skill index (plaintext metadata)
  a1b2c3d4.enc         <- encrypted skill content
  e5f6g7h8.enc         <- encrypted skill content
```

## Revocation

Once a skill has been transferred to another agent, it cannot be technically revoked. The receiver has already decrypted and re-encrypted the content with their own key.

Revocation is handled through:
- **TTL fields.** The sender sets an expiration timestamp. The receiver's agent is expected to honor it.
- **Trust relationships.** Agents only share skills with known, trusted counterparts.
- **Future: on-chain registry.** A smart contract could track skill licenses, enabling verifiable revocation.

## XMTP Considerations

**Message persistence.** XMTP stores messages in a local SQLite database on each installation. The network relays messages but does not guarantee permanent storage. Agents should treat their local vault as the authoritative copy, not their XMTP message history.

**Installation limits.** XMTP allows up to 10 installations per wallet. Agents must reuse database files rather than creating new installations.

**Rate limits.** XMTP enforces 3,000 write operations and 20,000 read operations per 5-minute rolling window per client. This is more than sufficient for skill operations.

**Message size.** Typical SKILL.md files range from 2KB to 20KB, well within XMTP's text message capacity. For skills exceeding message limits, the remote attachment content type can be used.
