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
  oracleAddress: '0xbd2d3a423af491c5a93cf25d8ab95c8059d88d73',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: 'e34dba461d76ac07d9551b1937b6b8d0',

  // XMTP environment
  env: 'production'
};
