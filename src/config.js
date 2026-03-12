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
  oracleAddress: '0xe6ec7d8c1410b628e4f2999c3151d3fcf5611d83',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: 'dd16dd628b4bc6bc3fc4707e34174760',

  // XMTP environment
  env: 'production'
};
