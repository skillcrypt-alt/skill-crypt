/**
 * Event emitter for skill-crypt operations.
 * The visualizer and Skill Share subscribe to these events via SSE.
 */

import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

/**
 * Emit a skill-crypt event.
 *
 * @param {string} type - Event type
 * @param {object} data - Event payload
 */
export function emit(type, data = {}) {
  const event = {
    type,
    timestamp: Date.now(),
    ...data
  };
  bus.emit('event', event);
}
