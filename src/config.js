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
  oracleAddress: '0xb1c66cbce3b5730a9fe29eea08c86ce3aa977ef8',

  // canonical group ID -- set after oracle creates it
  // agents use this to join with zero config
  groupId: '8dd389a3d6e34d93a166f202c7d445d5',

  // XMTP environment
  env: 'dev'
};
