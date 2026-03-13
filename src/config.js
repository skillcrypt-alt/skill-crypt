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
  oracleAddress: '0x719d7ac8565760f85aad89527ef97f2799281653',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: 'a83c5490f107e4960ec56b6f8119c07f',

  // XMTP environment
  env: 'production'
};
