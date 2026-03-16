# Contributing

Pull requests welcome. Here's how to get started.

## Setup

```bash
git clone https://github.com/skillcrypt-alt/skill-crypt.git
cd skill-crypt
npm install
npm test  # 46 tests should pass
```

## Guidelines

- Keep commits small and focused
- No em dashes, no AI-generated fluff in commit messages
- Run `npm test` before pushing
- If you're adding a feature, add tests for it
- If you're fixing a bug, add a test that would have caught it

## Architecture

See the [README](README.md#architecture) for the source layout. The main entry points:

- `src/cli.js` -- CLI commands
- `src/xmtp-vault.js` -- XMTP-based skill storage (zero disk)
- `src/transfer.js` -- two-message encrypted transfer protocol
- `src/skill-share.js` -- oracle-gated discovery layer
- `src/oracle.js` -- membership oracle

## Tests

```bash
# unit tests
npm test

# e2e (requires XMTP network access)
node test/e2e-vault-learn.mjs
node test/e2e-skillshare.mjs
```

## Security Issues

If you find a security vulnerability, do not open a public issue. See [SECURITY.md](SECURITY.md).
