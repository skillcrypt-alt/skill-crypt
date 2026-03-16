# Security

## Reporting Vulnerabilities

If you find a security issue, **do not open a public issue.**

Email: skillcryptalt@gmail.com

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment

You'll get a response within 48 hours. We'll work with you on a fix before any public disclosure.

## Scope

Security-relevant areas of this project:

- **Encryption** (`src/crypto.js`) -- AES-256-GCM, HKDF key derivation
- **Vault storage** (`src/xmtp-vault.js`) -- skill content should never be written to disk
- **Transfer protocol** (`src/transfer.js`) -- two-message split, ephemeral keys
- **Key guard** (`src/key-guard.js`) -- wallet encryption at rest
- **Oracle** (`src/oracle.js`) -- membership validation

## Design Principles

- Skills never exist as plaintext on disk
- Wallet private keys are encrypted at rest with device-bound keys
- Transfer payloads and decryption keys are always sent as separate messages
- No outbound HTTP calls except to XMTP and Base RPC
- No telemetry, no analytics, no tracking
