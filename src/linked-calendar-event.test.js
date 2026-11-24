import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedCalendarEventJSON, updateLinkedCalendarEventJSON } from './linked-calendar-event-model.js';

const identity = { calendarID: 'calendar-a', sourceID: 'source-b', localID: 'event-c', externalID: null, occurrenceDate: null, floatingOccurrenceKey: null };

test('linked block stores original calendar identity without creating calendar data', () => {
  const block = linkedCalendarEventJSON({ id: 'block-1', eventID: 'hash-1', identity, title: 'Meeting', start: '2026-11-20T12:00:00Z' });
  assert.equal(block.type, 'linkedCalendarEvent');
  assert.equal(block.attrs.eventID, 'hash-1');
  assert.deepEqual(block.attrs.eventIdentity, identity);
  assert.equal(block.attrs.id, 'block-1');
  assert.equal(block.content, undefined);
});

test('calendar changes update the cached display while retaining the original event identity and block ID', () => {
  const original = linkedCalendarEventJSON({ id: 'block-1', eventID: 'hash-1', identity, title: 'Meeting', start: '2026-11-20T12:00:00Z' });
  const updated = updateLinkedCalendarEventJSON(original, { title: 'Rescheduled', start: '2026-11-21T15:00:00Z' });
  assert.equal(updated.attrs.title, 'Rescheduled');
  assert.equal(updated.attrs.start, '2026-11-21T15:00:00Z');
  assert.deepEqual(updated.attrs.eventIdentity, identity);
  assert.equal(updated.attrs.id, original.attrs.id);
  assert.equal(original.attrs.title, 'Meeting');
});

test('invalid event identity is rejected', () => {
  assert.throws(() => linkedCalendarEventJSON({ id: 'x', eventID: 'hash', identity: { calendarID: 'only-one-field' } }));
});

test('event appearance separates title, long date, and compact time range', async () => {
  const { linkedEventDisplay } = await import('./linked-calendar-event-display.js');
  const result = linkedEventDisplay({ title: 'Design Discussion', calendarTitle: 'Work', start: '2026-11-20T14:00:00-06:00', end: '2026-11-20T15:00:00-06:00', isAllDay: false }, 'en-US', 'America/Chicago');
  assert.deepEqual(result, { title: 'Design Discussion', calendarTitle: 'Work', date: 'Friday, November 20, 2026', time: '2:00 PM – 3:00 PM' });
});

test('all-day events show no invented time range', async () => {
  const { linkedEventDisplay } = await import('./linked-calendar-event-display.js');
  const result = linkedEventDisplay({ title: 'Holiday', start: '2026-11-20T00:00:00-06:00', isAllDay: true }, 'en-US', 'America/Chicago');
  assert.equal(result.time, 'All Day');
});


test('calendar name remains part of the linked reference when its source calendar changes', () => {
  const original = linkedCalendarEventJSON({ id: 'block-2', eventID: 'hash-2', identity, title: 'Discussion', calendarTitle: 'Personal', start: '2026-11-20T12:00:00Z' });
  assert.equal(original.attrs.calendarTitle, 'Personal');
  const updated = updateLinkedCalendarEventJSON(original, { calendarTitle: 'Work' });
  assert.equal(updated.attrs.calendarTitle, 'Work');
  assert.equal(updated.attrs.eventID, 'hash-2');
});

test('unavailable linked events preserve original event identity and reference', () => {
  const original = linkedCalendarEventJSON({ id: 'block-3', eventID: 'hash-3', identity, title: 'Old meeting', start: '2026-11-20T12:00:00Z' });
  const unavailable = updateLinkedCalendarEventJSON(original, { available: false });
  assert.equal(unavailable.attrs.available, false);
  assert.equal(unavailable.attrs.eventID, original.attrs.eventID);
  assert.deepEqual(unavailable.attrs.eventIdentity, original.attrs.eventIdentity);
});

test('duplicated linked blocks keep original event reference without creating calendar data', () => {
  const original = linkedCalendarEventJSON({ id: 'block-a', eventID: 'hash-1', identity, title: 'Meeting', start: '2026-11-20T12:00:00Z' });
  const duplicate = { ...original, attrs: { ...original.attrs, id: 'block-b' } };
  assert.notEqual(duplicate.attrs.id, original.attrs.id);
  assert.equal(duplicate.attrs.eventID, original.attrs.eventID);
  assert.deepEqual(duplicate.attrs.eventIdentity, original.attrs.eventIdentity);
});
