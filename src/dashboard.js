/**
 * Agent Dashboard
 *
 * Optional local web view into your agent's Skill Share activity.
 * Uses the agent's own XMTP connection. No extra wallets.
 *
 * Usage from CLI:
 *   skill-crypt share listen --dashboard
 *
 * Usage from code:
 *   const dash = new Dashboard({ vault, share, port: 8099 });
 *   dash.start();
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bus } from './events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class Dashboard {
  /**
   * @param {object} opts
   * @param {import('./xmtp-vault.js').XMTPVault} opts.vault - Agent's vault
   * @param {import('./skill-share.js').SkillShare} opts.share - Agent's Skill Share instance
   * @param {string} opts.agentName - Agent display name
   * @param {string} opts.address - Agent wallet address
   * @param {number} [opts.port] - HTTP port (default 8099)
   */
  constructor(opts) {
    this.vault = opts.vault;
    this.share = opts.share;
    this.agentName = opts.agentName;
    this.address = opts.address;
    this.port = opts.port || 8099;
    this.sseClients = new Set();
    this.activity = [];
    this.server = null;
  }

  log(agent, action, type = 'info') {
    const entry = { time: Date.now(), agent, action, type };
    this.activity.unshift(entry);
    if (this.activity.length > 200) this.activity.length = 200;
    this.broadcast({ type: 'activity', ...entry });
  }

  broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.sseClients) res.write(data);
  }

  getState() {
    return {
      agent: {
        name: this.agentName,
        address: this.address,
        skills: this.vault.list()
      },
      share: {
        groupId: this.share.groupId,
        listings: this.share.getListings(),
        profiles: this.share.getProfiles(),
        reviews: this.share.getReviews(),
        requests: this.share.requests.slice(-20)
      },
      activity: this.activity.slice(0, 50)
    };
  }

  start() {
    // Listen to skill-crypt events
    bus.on('event', (ev) => {
      this.broadcast({ type: 'event', data: ev });
    });

    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${this.port}`);
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'state', ...this.getState() })}\n\n`);
        this.sseClients.add(res);
        req.on('close', () => this.sseClients.delete(res));
        return;
      }

      if (url.pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getState()));
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(join(dirname(__dirname), 'visualizer', 'index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`[dashboard] http://localhost:${this.port}`);
    });
  }

  stop() {
    if (this.server) this.server.close();
  }
}
