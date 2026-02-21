# skill-crypt

Encrypted skill storage and agent-to-agent skill transfer over XMTP.

## The Problem

AI agents run on skills: structured instruction sets that tell them how to perform tasks. Today, these skills sit as plaintext files on disk. Anyone with access to the machine can read them, copy them, or steal them. When agents need to share skills, there is no standard encrypted channel for doing so.

This matters because skills are intellectual property. An agent that can generate legal contracts, analyze medical images, or write exploit-proof smart contracts has value in those capabilities. Leaving them as readable text files is the equivalent of leaving your source code in a public directory.

## The Solution

Skill-crypt solves this with two layers:

**Encryption at rest.** Skills are encrypted with AES-256-GCM using a key derived from the agent's wallet private key. On disk, skills exist only as encrypted blobs. No wallet key, no skill.

**Encrypted transfer.** When one agent needs to share a skill with another, the transfer happens over XMTP, which provides end-to-end encryption using the MLS protocol. The skill is decrypted from the sender's vault, transmitted through XMTP's encrypted channel, and re-encrypted with the receiver's wallet key on arrival.

At no point does a plaintext skill file exist on disk. The only place a skill is ever in cleartext is inside the agent's process memory during execution.

## Status

Research phase. Validating XMTP message persistence and wallet-derived key management.
