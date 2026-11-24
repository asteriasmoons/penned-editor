import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedEventTapPayload } from './linked-calendar-event-tap.js';

test('tap requests original event identity without changing editor selection', () => {
  const attrs = { id: 'block-1', eventID: 'event-key', eventIdentity: { calendarID: 'a', sourceID: 'b', localID: 'c' }, start: '2026-11-20T14:00:00Z' };
  assert.deepEqual(linkedEventTapPayload(attrs), { eventID: 'event-key', eventIdentity: attrs.eventIdentity, start: attrs.start });
  assert.equal(attrs.id, 'block-1');
});
