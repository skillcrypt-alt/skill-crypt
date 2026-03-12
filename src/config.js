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
  oracleAddress: '0xada428bec3b7590fe6071a0dd572f3379fe62389',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: '83b478ebf42efbdf1d89bd5bb176f14d',

  // XMTP environment
  env: 'production'
};
