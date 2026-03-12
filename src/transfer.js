/**
 * XMTP Transfer Protocol
 *
 * Defines the message types and handlers for agent-to-agent skill transfer
 * over XMTP encrypted messaging. Includes Skill Share discovery messages
 * for broadcasting and finding skills in shared groups.
 */


export const MSG_TYPES = {
  // Direct transfer protocol
  CATALOG_REQUEST: 'skillcrypt:catalog-request',
  CATALOG: 'skillcrypt:catalog',
  SKILL_REQUEST: 'skillcrypt:skill-request',
  SKILL_TRANSFER: 'skillcrypt:skill-transfer',
  ACK: 'skillcrypt:ack',

  // Skill Share (group discovery)
  LISTING: 'skillcrypt:listing',
  LISTING_REQUEST: 'skillcrypt:listing-request',
  PROFILE: 'skillcrypt:profile',
  REVIEW: 'skillcrypt:review'
};

// --- Direct transfer builders ---

/**
 * Build a catalog response containing skill metadata (no content).
 */
export function buildCatalog(skills) {
  return {
    type: MSG_TYPES.CATALOG,
    skills: skills.map(s => ({
      skillId: s.skillId,
      name: s.name,
      version: s.version,
      description: s.description,
      tags: s.tags,
      size: s.size
    })),
    timestamp: new Date().toISOString()
  };
}

/**
 * Build a skill transfer message with full content.
 */
export function buildTransfer(opts) {
  return {
    type: MSG_TYPES.SKILL_TRANSFER,
    skillId: opts.skillId,
    name: opts.name,
    version: opts.version || '1.0.0',
    description: opts.description || '',
    tags: opts.tags || [],
    content: opts.content,
    contentHash: opts.contentHash,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build a skill request message.
 */
export function buildRequest(skillId) {
  return {
    type: MSG_TYPES.SKILL_REQUEST,
    skillId,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build a catalog request message.
 */
export function buildCatalogRequest() {
  return {
    type: MSG_TYPES.CATALOG_REQUEST,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build an acknowledgment message.
 */
export function buildAck(skillId, success = true) {
  return {
    type: MSG_TYPES.ACK,
    skillId,
    success,
    timestamp: new Date().toISOString()
  };
}

// --- Skill Share builders ---

/**
 * Build a skill listing for broadcast to a Skill Share group.
 * Contains metadata only, never content. Other agents DM to request.
 *
 * @param {object} opts
 * @param {string} opts.name - Skill name
 * @param {string} opts.description - What the skill does
 * @param {Array<string>} opts.tags - Categorization tags
 * @param {string} opts.version - Skill version
 * @param {number} opts.size - Content size in bytes
 * @param {string} opts.address - Provider's wallet address (for DM requests)
 * @param {string} [opts.skillId] - Vault skill ID
 */
export function buildListing(opts) {
  return {
    type: MSG_TYPES.LISTING,
    name: opts.name,
    description: opts.description || '',
    tags: opts.tags || [],
    version: opts.version || '1.0.0',
    size: opts.size || 0,
    address: opts.address,
    skillId: opts.skillId || null,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build a listing request, broadcast to a Skill Share group.
 * "Does anyone have a skill that does X?"
 *
 * @param {object} opts
 * @param {string} opts.query - What the agent is looking for
 * @param {Array<string>} [opts.tags] - Desired tags
 * @param {string} opts.address - Requester's wallet address
 */
export function buildListingRequest(opts) {
  return {
    type: MSG_TYPES.LISTING_REQUEST,
    query: opts.query,
    tags: opts.tags || [],
    address: opts.address,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build an agent profile for the Skill Share group.
 * Introduces the agent: what it offers, what it wants.
 *
 * @param {object} opts
 * @param {string} opts.name - Agent display name
 * @param {string} opts.address - Wallet address
 * @param {string} [opts.description] - What this agent does
 * @param {Array<string>} [opts.offers] - Tags of skills it can share
 * @param {Array<string>} [opts.seeks] - Tags of skills it wants
 * @param {number} [opts.skillCount] - How many skills in vault
 */
export function buildProfile(opts) {
  return {
    type: MSG_TYPES.PROFILE,
    name: opts.name,
    address: opts.address,
    description: opts.description || '',
    offers: opts.offers || [],
    seeks: opts.seeks || [],
    skillCount: opts.skillCount || 0,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build a review for a skill received from another agent.
 * Posted to the Skill Share group for reputation.
 *
 * @param {object} opts
 * @param {string} opts.skillName - Name of the skill reviewed
 * @param {string} opts.provider - Wallet address of the provider
 * @param {string} opts.reviewer - Wallet address of the reviewer
 * @param {number} opts.rating - 1-5 rating
 * @param {string} [opts.comment] - Optional review text
 */
export function buildReview(opts) {
  if (opts.rating < 1 || opts.rating > 5) {
    throw new Error('rating must be between 1 and 5');
  }
  return {
    type: MSG_TYPES.REVIEW,
    skillName: opts.skillName,
    provider: opts.provider,
    reviewer: opts.reviewer,
    rating: opts.rating,
    comment: opts.comment || '',
    timestamp: new Date().toISOString()
  };
}

/**
 * Parse a raw message string into a skillcrypt protocol message.
 * Returns null if the message is not a valid skillcrypt message.
 */
export function parseMessage(text) {
  try {
    const msg = JSON.parse(text);
    if (msg.type && msg.type.startsWith('skillcrypt:')) {
      return msg;
    }
  } catch {}
  return null;
}

/**
 * Handle an incoming skillcrypt message and produce a response.
 * Handles both direct transfer and Skill Share messages.
 *
 * @param {object} msg - Parsed skillcrypt message
 * @param {SkillVault} vault - Local vault instance
 * @param {function} sendFn - Async function to send a response string
 * @param {object} [context] - Optional context for Skill Share handlers
 * @param {function} [context.onListing] - Called when a listing is received
 * @param {function} [context.onListingRequest] - Called when someone requests a skill type
 * @param {function} [context.onProfile] - Called when an agent profile is received
 * @param {function} [context.onReview] - Called when a review is posted
 */
export async function handleMessage(msg, vault, sendFn, context = {}) {

  switch (msg.type) {
    case MSG_TYPES.CATALOG_REQUEST: {
      const skills = vault.list();
      const response = buildCatalog(skills);
      await sendFn(JSON.stringify(response));
      break;
    }

    case MSG_TYPES.SKILL_REQUEST: {
      const entry = vault.manifest.skills[msg.skillId];
      if (!entry) {
        await sendFn(JSON.stringify(buildAck(msg.skillId, false)));
        return;
      }
      const content = await vault.load(msg.skillId);
      const response = buildTransfer({
        skillId: msg.skillId,
        name: entry.name,
        content,
        contentHash: entry.contentHash,
        version: entry.version,
        description: entry.description,
        tags: entry.tags
      });
      await sendFn(JSON.stringify(response));
      break;
    }

    case MSG_TYPES.SKILL_TRANSFER: {
      await vault.store(msg.name, msg.content, {
        version: msg.version,
        description: msg.description,
        tags: msg.tags
      });
      await sendFn(JSON.stringify(buildAck(msg.skillId, true)));
      break;
    }

    case MSG_TYPES.LISTING: {
      if (context.onListing) context.onListing(msg);
      break;
    }

    case MSG_TYPES.LISTING_REQUEST: {
      if (context.onListingRequest) context.onListingRequest(msg);
      break;
    }

    case MSG_TYPES.PROFILE: {
      if (context.onProfile) context.onProfile(msg);
      break;
    }

    case MSG_TYPES.REVIEW: {
      if (context.onReview) context.onReview(msg);
      break;
    }

    case MSG_TYPES.CATALOG:
      break;

    case MSG_TYPES.ACK:
      break;
  }
}
