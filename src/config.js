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
  oracleAddress: '0xe6d701012d9425549cfc0a971e98e668bfa3ff91',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: '4e706683091924b15d2204fd315420fe',

  // XMTP environment
  env: 'production'
};
