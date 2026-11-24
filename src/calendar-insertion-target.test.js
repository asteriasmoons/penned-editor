import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { ensureCalendarInsertionSelection } from './calendar-insertion-target.js';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*', attrs: { id: { default: null } } },
  weekStrip: { group: 'block', content: 'weekDayPanel+', attrs: { id: { default: null }, selectedDate: { default: null } } },
  weekDayPanel: { content: 'block+', attrs: { id: { default: null }, date: { default: null } } },
  pageReference: { group: 'block', atom: true, attrs: { id: { default: null } } },
  linkedCalendarEvent: { group: 'block', atom: true, attrs: { id: { default: null } } },
} });
const paragraph = (id, text = '') => schema.node('paragraph', { id }, text ? schema.text(text) : undefined);
const panel = (date, child) => schema.node('weekDayPanel', { id: `panel-${date}`, date }, [child]);
const calendar = (active = '2026-11-20') => schema.node('weekStrip', { id: 'calendar-id', selectedDate: active }, [
  panel('2026-11-15', schema.node('pageReference', { id: 'card' })),
  panel('2026-11-16', schema.node('linkedCalendarEvent', { id: 'event' })),
  panel('2026-11-20', paragraph('friday')),
]);
const stateFor = (doc, pos) => EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
const dateAtSelection = ($from) => {
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.name === 'weekDayPanel') return $from.node(depth).attrs.date;
  }
  return null;
};

test('all native Add Block kinds use Friday, not stale Nov 15, when Friday is the active Calendar date', () => {
  const doc = schema.node('doc', null, [calendar()]);
  const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 2) });
  const tr = state.tr;
  const result = ensureCalendarInsertionSelection(tr);
  assert.equal(result?.date, '2026-11-20');
  assert.equal(dateAtSelection(tr.selection.$from), '2026-11-20');
  assert.equal(tr.selection instanceof TextSelection, true);
  assert.deepEqual(tr.doc.firstChild.child(0).toJSON(), doc.firstChild.child(0).toJSON());
  assert.deepEqual(tr.doc.firstChild.child(1).toJSON(), doc.firstChild.child(1).toJSON());
});

test('when a selected date contains only an event, create a safe trailing caret instead of replacing the event', () => {
  const doc = schema.node('doc', null, [calendar('2026-11-16')]);
  const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 2) });
  const tr = state.tr;
  const result = ensureCalendarInsertionSelection(tr);
  assert.equal(result?.date, '2026-11-16');
  const eventPanel = tr.doc.firstChild.child(1);
  assert.equal(eventPanel.childCount, 2);
  assert.equal(eventPanel.child(0).type.name, 'linkedCalendarEvent');
  assert.equal(eventPanel.child(1).type.name, 'paragraph');
  assert.equal(dateAtSelection(tr.selection.$from), '2026-11-16');
});

test('tapping another date explicitly parks insertion in that date, even when old selection belonged to another', () => {
  const doc = schema.node('doc', null, [calendar()]);
  const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 2) });
  const tr = state.tr;
  const result = ensureCalendarInsertionSelection(tr, { stripPos: 0, date: '2026-11-20', force: true });
  assert.equal(result.date, '2026-11-20');
  assert.equal(dateAtSelection(tr.selection.$from), '2026-11-20');
});

test('insertion into normal document paragraphs outside Calendar remains unchanged', () => {
  const doc = schema.node('doc', null, [paragraph('outside'), calendar()]);
  const state = stateFor(doc, 1);
  const tr = state.tr;
  assert.equal(ensureCalendarInsertionSelection(tr), null);
  assert.equal(tr.selection.from, 1);
  assert.equal(tr.doc.eq(doc), true);
});

test('an actual caret inside the active date stays untouched rather than jumping to a different block', () => {
  const doc = schema.node('doc', null, [calendar()]);
  // Find Friday's paragraph text position.
  let pos = null;
  doc.descendants((node, at) => { if(node.type.name === 'paragraph' && node.attrs.id === 'friday') pos = at + 1; });
  const state = stateFor(doc, pos);
  const tr = state.tr;
  assert.equal(ensureCalendarInsertionSelection(tr), null);
  assert.equal(tr.selection.from, pos);
});

test('selecting the Calendar block itself inserts inside its active date, not outside', () => {
  const doc = schema.node('doc', null, [calendar()]);
  const tr = EditorState.create({ doc, selection: NodeSelection.create(doc, 0) }).tr;
  const result = ensureCalendarInsertionSelection(tr);
  assert.equal(result.date, '2026-11-20');
  assert.equal(dateAtSelection(tr.selection.$from), '2026-11-20');
});

test('an already-active date is still recognized for direct Divider insertion', async () => {
  const { selectionInsideCalendar } = await import('./calendar-insertion-target.js');
  const doc = schema.node('doc', null, [calendar()]);
  let pos;
  doc.descendants((node, at) => { if(node.type.name === 'paragraph' && node.attrs.id === 'friday') pos = at + 1; });
  const state = stateFor(doc, pos);
  assert.equal(selectionInsideCalendar(state.selection), true);
  assert.equal(selectionInsideCalendar(stateFor(schema.node('doc', null, [paragraph('plain')]), 1).selection), false);
});

test('paragraph insertion after an atomic event appends inside that same date and keeps caret there', async () => {
  const { appendParagraphToCalendarDate } = await import('./calendar-insertion-target.js');
  const doc = schema.node('doc', null, [paragraph('outside', 'Morning Routine'), calendar('2026-11-16')]);
  const state = stateFor(doc, 3); // old caret in the Infocard/paragraph above Calendar
  const tr = state.tr;
  const result = appendParagraphToCalendarDate(tr, { stripID: 'calendar-id', date: '2026-11-16' });
  assert.equal(result?.date, '2026-11-16');
  const after = tr.doc.child(1).child(1);
  assert.equal(after.childCount, 2);
  assert.equal(after.child(0).type.name, 'linkedCalendarEvent');
  assert.equal(after.child(1).type.name, 'paragraph');
  assert.equal(dateAtSelection(tr.selection.$from), '2026-11-16');
  assert.equal(tr.doc.firstChild.textContent, 'Morning Routine');
});

test('paragraph insertion reuses an empty trailing paragraph in the active day', async () => {
  const { appendParagraphToCalendarDate } = await import('./calendar-insertion-target.js');
  const doc = schema.node('doc', null, [calendar()]);
  const tr = EditorState.create({doc, selection: NodeSelection.create(doc, 2)}).tr;
  appendParagraphToCalendarDate(tr, { stripID: 'calendar-id', date: '2026-11-20' });
  const child = tr.doc.firstChild.child(2);
  assert.equal(child.childCount, 1);
  assert.equal(child.child(0).attrs.id, 'friday');
  assert.equal(child.child(0).type.name, 'paragraph');
  assert.equal(dateAtSelection(tr.selection.$from), '2026-11-20');
});
