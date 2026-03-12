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
  oracleAddress: '0x21e4d0cc9ab517425c161f8f55bace7ba4f68d75',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: '285fe49992b2990fee7c02ba10c0a27a',

  // XMTP environment
  env: 'production'
};
