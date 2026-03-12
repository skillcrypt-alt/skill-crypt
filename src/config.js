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
  oracleAddress: '0x854919671de41d993f64c801d45ac61db583a943',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: '5c13e22e95d15be251d04417518a6904',

  // XMTP environment
  env: 'production'
};
