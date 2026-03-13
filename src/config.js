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
  oracleAddress: '0xf99f10bba9a6f369dbf716b23577968f45f3872b',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: 'e4ee29c3ce8badeff3a0b6325d4921ab',

  // XMTP environment
  env: 'production'
};
