# Getting Started

Everything here happens through conversation with your agent. You talk, your agent does the work.

## Install

> "Install skill-crypt from https://github.com/skillcrypt/skill-crypt"

Your agent clones the repo, installs dependencies, and reads the SKILL.md. From this point on, your agent knows how to manage encrypted skills.

## Wallet

Your agent needs an Ethereum wallet. This wallet is the key to everything: encryption, XMTP identity, and skill transfers.

> "Generate me an Ethereum wallet for skill-crypt."

Your agent creates the wallet, stores the key securely, and wires it into skill-crypt. If your agent already has a wallet:

> "Use my existing wallet for skill-crypt."

## XMTP Registration

> "Register my wallet on XMTP."

Your agent connects to the XMTP production network and creates your encrypted inbox. This is a one-time setup. Your inbox persists on the XMTP network tied to your wallet address. Any machine with the same wallet key can access it.

## Encrypt Your Skills

> "Encrypt all my skills and get rid of the plaintext files."

Your agent goes through your skills directory, encrypts each one with your wallet-derived key, stores the encrypted versions in the vault, and removes the originals. No more readable skill files on disk.

One at a time works too:

> "Encrypt my calendar skill."

## Use Skills

You do not need to think about the encryption layer. Use your agent like you normally would:

> "What is on my calendar tomorrow?"

Your agent knows which skill it needs. It decrypts the skill from the vault into its context, uses it, and moves on. The decrypted content never becomes a file.

## Share Skills

> "Share my web-scraper skill with 0xTheirAddress."

Your agent decrypts the skill in memory, sends it through XMTP to the other wallet, and the receiving agent encrypts it with their own key. Both agents end up with the skill locked to their own wallets. The plaintext was never on disk for either one.

## Receive Skills

> "Has anyone sent me any skills?"

> "Get the skill catalog from 0xTheirAddress."

> "Request the image-analysis skill from 0xTheirAddress."

Skills arrive over XMTP, get encrypted with your key, and show up in your vault.

## What Your Agent Is Doing Behind the Scenes

When you say "encrypt my skills," your agent is running CLI commands internally:

```bash
node src/cli.js encrypt /path/to/SKILL.md    # encrypt a skill
node src/cli.js vault list                     # list the vault
node src/cli.js decrypt <skill-id>             # decrypt into context
node src/cli.js transfer catalog <address>     # request catalog over XMTP
node src/cli.js transfer request <address> <id> # request a skill over XMTP
node src/cli.js transfer listen                 # listen for incoming transfers
```

You never need to run these yourself. They exist so the agent has a reliable interface to work with.

## Further Reading

- [PROTOCOL.md](../PROTOCOL.md) for the full transfer protocol specification
- [SKILL.md](../SKILL.md) for the agent skill reference your agent reads
