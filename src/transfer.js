/**
 * XMTP Transfer Protocol
 *
 * Defines the message types and handlers for agent-to-agent skill transfer
 * over XMTP encrypted messaging. The transport layer (XMTP E2E encryption)
 * is handled by the client module. This module handles message creation,
 * parsing, and protocol logic.
 */


export const MSG_TYPES = {
  CATALOG_REQUEST: 'skillcrypt:catalog-request',
  CATALOG: 'skillcrypt:catalog',
  SKILL_REQUEST: 'skillcrypt:skill-request',
  SKILL_TRANSFER: 'skillcrypt:skill-transfer',
  ACK: 'skillcrypt:ack'
};

/**
 * Build a catalog response containing skill metadata (no content).
 *
 * @param {Array} skills - Skill metadata from vault.list()
 * @returns {object} Catalog message payload
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
 *
 * The content field contains the plaintext skill. XMTP handles E2E encryption
 * during transit. The receiver re-encrypts with their own key on arrival.
 *
 * @param {object} opts
 * @param {string} opts.skillId
 * @param {string} opts.name
 * @param {string} opts.content - Plaintext skill body
 * @param {string} opts.contentHash - SHA-256 integrity hash
 * @param {string} [opts.version]
 * @param {string} [opts.description]
 * @param {Array<string>} [opts.tags]
 * @returns {object} Transfer message payload
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
 *
 * @param {string} skillId - ID of the skill to request
 * @returns {object}
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
 *
 * @returns {object}
 */
export function buildCatalogRequest() {
  return {
    type: MSG_TYPES.CATALOG_REQUEST,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build an acknowledgment message.
 *
 * @param {string} skillId
 * @param {boolean} [success=true]
 * @returns {object}
 */
export function buildAck(skillId, success = true) {
  return {
    type: MSG_TYPES.ACK,
    skillId,
    success,
    timestamp: new Date().toISOString()
  };
}

/**
 * Parse a raw message string into a skillcrypt protocol message.
 * Returns null if the message is not a valid skillcrypt message.
 *
 * @param {string} text - Raw message text
 * @returns {object|null}
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
 *
 * This is the core protocol handler. It processes incoming messages,
 * interacts with the local vault, and calls sendFn with the response.
 *
 * @param {object} msg - Parsed skillcrypt message
 * @param {SkillVault} vault - Local vault instance
 * @param {function} sendFn - Async function to send a response string
 */
export async function handleMessage(msg, vault, sendFn) {

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
      const skillId = await vault.store(msg.name, msg.content, {
        version: msg.version,
        description: msg.description,
        tags: msg.tags
      });
      await sendFn(JSON.stringify(buildAck(msg.skillId, true)));
      break;
    }

    case MSG_TYPES.CATALOG:
      break;

    case MSG_TYPES.ACK:
      break;
  }
}
