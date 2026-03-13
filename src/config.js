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
  oracleAddress: '0x10dcd3a4c3a85e59d00ae00939c8023bb1654743',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: '4f156b483706048be89ca0ae0a288074',

  // XMTP environment
  env: 'production'
};
