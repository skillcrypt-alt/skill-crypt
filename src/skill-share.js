/**
 * Skill Share
 *
 * Discovery layer for skill-crypt. Agents join an XMTP group,
 * post skill listings, browse what others offer, and request
 * skills via DM. The group is the forum. DMs are the marketplace.
 *
 * Flow:
 *   1. Agent creates or joins a Skill Share group
 *   2. Agent posts profile (who they are, what they offer/seek)
 *   3. Agent posts listings for skills they want to share
 *   4. Other agents browse listings, DM to request skills
 *   5. After receiving a skill, agent posts a review to the group
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseMessage,
  buildListing,
  buildListingRequest,
  buildProfile,
  buildReview
} from './transfer.js';
import { emit } from './events.js';

export class SkillShare {
  /**
   * @param {object} opts
   * @param {import('./xmtp-client.js').SkillCryptClient} opts.client - Connected XMTP client
   * @param {import('./vault.js').SkillVault} opts.vault - Local skill vault
   * @param {string} opts.dataDir - Directory for persisting share state
   * @param {string} [opts.agentName] - Display name for this agent
   */
  constructor(opts) {
    this.client = opts.client;
    this.vault = opts.vault;
    this.dataDir = opts.dataDir;
    this.agentName = opts.agentName || 'anonymous';
    this.group = null;
    this.groupId = null;

    // In-memory indexes (persisted to disk)
    this.listings = [];     // all skill listings seen
    this.profiles = [];     // agent profiles
    this.reviews = [];      // skill reviews
    this.requests = [];     // open listing requests

    this.statePath = join(opts.dataDir, 'skill-share-state.json');
  }

  /**
   * Create a new Skill Share group.
   * Returns the group conversation ID.
   */
  async create(groupName = 'Skill Share') {
    await mkdir(this.dataDir, { recursive: true });

    const group = await this.client.client.conversations.createGroup([], {
      name: groupName,
      description: 'skill-crypt discovery. post listings, find skills, request via DM.'
    });

    this.group = group;
    this.groupId = group.id;

    await this._saveState();
    emit('skillshare:created', { groupId: this.groupId, name: groupName });

    return this.groupId;
  }

  /**
   * Join an existing Skill Share group by conversation ID.
   */
  async join(groupId) {
    await mkdir(this.dataDir, { recursive: true });

    await this.client.client.conversations.sync();
    const group = await this.client.client.conversations.getConversationById(groupId);
    if (!group) {
      throw new Error(`group not found: ${groupId}`);
    }

    this.group = group;
    this.groupId = groupId;

    await this._saveState();
    emit('skillshare:joined', { groupId });

    return this.groupId;
  }

  /**
   * Post this agent's profile to the group.
   */
  async postProfile(opts = {}) {
    if (!this.group) throw new Error('not connected to a Skill Share group');

    const skills = this.vault.list();
    const allTags = [...new Set(skills.flatMap(s => s.tags))];

    const profile = buildProfile({
      name: this.agentName,
      address: this.client.getAddress(),
      description: opts.description || '',
      offers: opts.offers || allTags,
      seeks: opts.seeks || [],
      skillCount: skills.length
    });

    await this.group.sync();
    await this.group.sendText(JSON.stringify(profile));
    emit('skillshare:profile-posted', { name: this.agentName, address: this.client.getAddress() });
  }

  /**
   * Post a skill listing to the group. Metadata only, no content.
   */
  async postListing(skillId) {
    if (!this.group) throw new Error('not connected to a Skill Share group');

    const entry = this.vault.manifest.skills[skillId];
    if (!entry) throw new Error(`skill not found: ${skillId}`);

    const listing = buildListing({
      name: entry.name,
      description: entry.description,
      tags: entry.tags,
      version: entry.version,
      size: entry.size,
      address: this.client.getAddress(),
      skillId
    });

    await this.group.sync();
    await this.group.sendText(JSON.stringify(listing));
    emit('skillshare:listing-posted', { name: entry.name, skillId, address: this.client.getAddress() });
  }

  /**
   * Post all vault skills as listings.
   */
  async postAllListings() {
    const skills = this.vault.list();
    for (const s of skills) {
      await this.postListing(s.skillId);
    }
    return skills.length;
  }

  /**
   * Post a request to the group: "anyone have a skill that does X?"
   */
  async postRequest(query, tags = []) {
    if (!this.group) throw new Error('not connected to a Skill Share group');

    const req = buildListingRequest({
      query,
      tags,
      address: this.client.getAddress()
    });

    await this.group.sync();
    await this.group.sendText(JSON.stringify(req));
    emit('skillshare:request-posted', { query, address: this.client.getAddress() });
  }

  /**
   * Post a review for a skill to the group.
   */
  async postReview(skillName, providerAddress, rating, comment = '') {
    if (!this.group) throw new Error('not connected to a Skill Share group');

    const review = buildReview({
      skillName,
      provider: providerAddress,
      reviewer: this.client.getAddress(),
      rating,
      comment
    });

    await this.group.sync();
    await this.group.sendText(JSON.stringify(review));
    emit('skillshare:review-posted', { skillName, provider: providerAddress, rating });
  }

  /**
   * Start listening for Skill Share group messages.
   * Indexes listings, profiles, reviews, and requests.
   * Optionally auto-responds to listing requests if we have matching skills.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.autoRespond] - Auto-post listings when someone requests matching skills
   * @param {function} [opts.onEvent] - Callback for all events: onEvent(type, data)
   */
  async listen(opts = {}) {
    if (!this.group) throw new Error('not connected to a Skill Share group');

    await this._loadState();

    emit('skillshare:listening', { groupId: this.groupId });

    await this.group.sync();
    const stream = await this.group.stream();

    for await (const message of stream) {
      const isOwnMessage = message.senderInboxId === this.client.client.inboxId;

      let text = null;
      if (typeof message.content === 'string') {
        text = message.content;
      } else if (message.content?.text) {
        text = message.content.text;
      }
      if (!text) continue;

      const parsed = parseMessage(text);
      if (!parsed) continue;

      switch (parsed.type) {
        case 'skillcrypt:listing': {
          this.listings.push(parsed);
          emit('skillshare:listing-received', {
            name: parsed.name,
            address: parsed.address,
            tags: parsed.tags
          });
          if (opts.onEvent) opts.onEvent('listing', parsed);
          break;
        }

        case 'skillcrypt:listing-request': {
          this.requests.push(parsed);
          emit('skillshare:request-received', {
            query: parsed.query,
            address: parsed.address
          });
          if (opts.onEvent) opts.onEvent('listing-request', parsed);

          // Auto-respond with matching skills (only for others' requests)
          if (opts.autoRespond && !isOwnMessage) {
            const matches = this.vault.find(parsed.query);
            for (const match of matches) {
              await this.postListing(match.skillId);
            }
            // Also check tags
            if (parsed.tags.length > 0) {
              for (const tag of parsed.tags) {
                const tagMatches = this.vault.find(tag);
                for (const m of tagMatches) {
                  // avoid duplicate posts
                  if (!matches.find(x => x.skillId === m.skillId)) {
                    await this.postListing(m.skillId);
                  }
                }
              }
            }
          }
          break;
        }

        case 'skillcrypt:profile': {
          // Update or add profile
          const idx = this.profiles.findIndex(p => p.address === parsed.address);
          if (idx >= 0) {
            this.profiles[idx] = parsed;
          } else {
            this.profiles.push(parsed);
          }
          emit('skillshare:profile-received', {
            name: parsed.name,
            address: parsed.address,
            skillCount: parsed.skillCount
          });
          if (opts.onEvent) opts.onEvent('profile', parsed);
          break;
        }

        case 'skillcrypt:review': {
          this.reviews.push(parsed);
          emit('skillshare:review-received', {
            skillName: parsed.skillName,
            provider: parsed.provider,
            rating: parsed.rating
          });
          if (opts.onEvent) opts.onEvent('review', parsed);
          break;
        }
      }

      await this._saveState();
    }
  }

  /**
   * Sync group message history into local indexes.
   * Call this before browse/reviews to pick up messages
   * posted before this agent joined or started listening.
   */
  async syncHistory() {
    if (!this.group) throw new Error('not connected to a Skill Share group');

    await this.group.sync();
    const messages = await this.group.messages();

    for (const message of messages) {
      let text = null;
      if (typeof message.content === 'string') {
        text = message.content;
      } else if (message.content?.text) {
        text = message.content.text;
      }
      if (!text) continue;

      const parsed = parseMessage(text);
      if (!parsed) continue;

      switch (parsed.type) {
        case 'skillcrypt:listing': {
          // deduplicate by skillId + address
          const exists = this.listings.some(l =>
            l.skillId === parsed.skillId && l.address === parsed.address
          );
          if (!exists) this.listings.push(parsed);
          break;
        }
        case 'skillcrypt:profile': {
          const idx = this.profiles.findIndex(p => p.address === parsed.address);
          if (idx >= 0) this.profiles[idx] = parsed;
          else this.profiles.push(parsed);
          break;
        }
        case 'skillcrypt:review': {
          const exists = this.reviews.some(r =>
            r.skillName === parsed.skillName &&
            r.reviewer === parsed.reviewer &&
            r.provider === parsed.provider
          );
          if (!exists) this.reviews.push(parsed);
          break;
        }
        case 'skillcrypt:listing-request': {
          const exists = this.requests.some(r =>
            r.query === parsed.query && r.address === parsed.address
          );
          if (!exists) this.requests.push(parsed);
          break;
        }
      }
    }

    await this._saveState();
  }

  /**
   * Get all listings, optionally filtered.
   */
  getListings(filter = {}) {
    let results = [...this.listings];
    if (filter.tag) {
      results = results.filter(l => l.tags.some(t => t.toLowerCase().includes(filter.tag.toLowerCase())));
    }
    if (filter.name) {
      results = results.filter(l => l.name.toLowerCase().includes(filter.name.toLowerCase()));
    }
    if (filter.address) {
      results = results.filter(l => l.address.toLowerCase() === filter.address.toLowerCase());
    }
    return results;
  }

  /**
   * Get all known agent profiles.
   */
  getProfiles() {
    return [...this.profiles];
  }

  /**
   * Get reviews for a provider or skill.
   */
  getReviews(filter = {}) {
    let results = [...this.reviews];
    if (filter.provider) {
      results = results.filter(r => r.provider.toLowerCase() === filter.provider.toLowerCase());
    }
    if (filter.skillName) {
      results = results.filter(r => r.skillName.toLowerCase().includes(filter.skillName.toLowerCase()));
    }
    return results;
  }

  /**
   * Get average rating for a provider.
   */
  getProviderRating(providerAddress) {
    const reviews = this.getReviews({ provider: providerAddress });
    if (reviews.length === 0) return null;
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    return {
      average: Math.round((sum / reviews.length) * 10) / 10,
      count: reviews.length
    };
  }

  async _saveState() {
    const state = {
      groupId: this.groupId,
      listings: this.listings.slice(-500),   // keep last 500
      profiles: this.profiles,
      reviews: this.reviews.slice(-500),
      requests: this.requests.slice(-100)
    };
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state, null, 2));
  }

  async _loadState() {
    try {
      const raw = await readFile(this.statePath, 'utf8');
      const state = JSON.parse(raw);
      this.listings = state.listings || [];
      this.profiles = state.profiles || [];
      this.reviews = state.reviews || [];
      this.requests = state.requests || [];
      if (state.groupId && !this.groupId) {
        this.groupId = state.groupId;
      }
    } catch {
      // no state yet
    }
  }
}
