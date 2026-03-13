/**
 * Skill Share Config
 *
 * Default values for the canonical Skill Share group.
 * The oracle wallet owns and manages the group.
 * Agents use these defaults when running `share join` with no args.
 *
 * Group ID is set after the oracle creates it (see oracle setup).
 */

export const DEFAULTS = {
  // oracle wallet address (public, safe to share)
  oracleAddress: '0xb6731ec2277ca804559cfb9c8e54ac465c36cf49',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: '7385a9951fbc20f96a671af8bd830964',

  // XMTP environment
  env: 'production'
};
