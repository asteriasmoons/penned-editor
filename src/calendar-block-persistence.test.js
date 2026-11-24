import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema, DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model';
import { JSDOM } from 'jsdom';
import { WeekStrip, WeekDayPanel } from './week-strip.js';
import { LinkedCalendarEvent } from './linked-calendar-event.js';
import { WEEK_STRIP_DEFAULTS } from './week-strip-settings.js';

const fromExtension = extension => {
  const attributes = extension.config.addAttributes();
  return {
    group: extension.config.group,
    content: extension.config.content,
    atom: extension.config.atom,
    attrs: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, { default: value.default }])),
    parseDOM: extension.config.parseHTML().map(rule => ({
      tag: rule.tag,
      getAttrs: element => Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, value.parseHTML?.(element) ?? value.default])),
    })),
    toDOM: node => extension.config.renderHTML({ node, HTMLAttributes: {} }),
  };
};
const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
  weekStrip: fromExtension(WeekStrip),
  weekDayPanel: fromExtension(WeekDayPanel),
  linkedCalendarEvent: fromExtension(LinkedCalendarEvent),
} });

const identity = { calendarID: 'work', sourceID: 'icloud', localID: 'recurring', externalID: 'remote', occurrenceDate: '2026-11-20T20:00:00Z', floatingOccurrenceKey: null };
const json = { type: 'doc', content: [
  { type: 'weekStrip', attrs: { ...WEEK_STRIP_DEFAULTS, id: 'strip-1', selectedDate: '2026-11-20', firstDayOfWeek: 1, selectedDateBehavior: 'remember', cornerRadius: 24, padding: 20, activeTabColor: '#123456' }, content: [
    { type: 'weekDayPanel', attrs: { id: 'panel-1', date: '2026-11-20' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Friday journal' }] }] },
    { type: 'weekDayPanel', attrs: { id: 'panel-2', date: '2026-11-27' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Next Friday' }] }] },
  ] },
  { type: 'linkedCalendarEvent', attrs: { id: 'link-1', eventID: 'event-hash', eventIdentity: identity, title: 'Design Review', calendarTitle: 'Work', start: '2026-11-20T20:00:00Z', end: '2026-11-20T21:00:00Z', isAllDay: false, timeZoneID: 'America/Chicago', available: false } },
] };

test('canonical document JSON survives schema save and reopen with all calendar block data', () => {
  const document = schema.nodeFromJSON(json);
  assert.deepEqual(schema.nodeFromJSON(JSON.parse(JSON.stringify(document.toJSON()))).toJSON(), document.toJSON());
});

test('HTML export and import preserves Week Strip content and linked event identity and display metadata', () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const document = schema.nodeFromJSON(json);
  const dom = DOMSerializer.fromSchema(schema).serializeFragment(document.content, { document: window.document });
  const wrapper = window.document.createElement('main');
  wrapper.append(dom);
  const imported = PMDOMParser.fromSchema(schema).parse(wrapper);
  assert.deepEqual(imported.toJSON(), document.toJSON());
});

test('reopened Week Strip retains navigation, date panels, settings, and nested event reference', () => {
  const initial = structuredClone(json);
  initial.content[0].content[1].content = [{ type: 'linkedCalendarEvent', attrs: structuredClone(json.content[1].attrs) }];
  const before = schema.nodeFromJSON({ type: 'doc', content: [initial.content[0]] });
  const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(before.toJSON())));
  const strip = reopened.firstChild;
  assert.equal(strip.attrs.id, 'strip-1');
  assert.equal(strip.attrs.selectedDate, '2026-11-20');
  assert.equal(strip.attrs.firstDayOfWeek, 1);
  assert.equal(strip.attrs.selectedDateBehavior, 'remember');
  assert.equal(strip.attrs.cornerRadius, 24);
  assert.equal(strip.attrs.padding, 20);
  assert.equal(strip.attrs.activeTabColor, '#123456');
  assert.equal(strip.child(0).textContent, 'Friday journal');
  assert.equal(strip.child(1).attrs.date, '2026-11-27');
  assert.deepEqual(strip.child(1).firstChild.attrs.eventIdentity, identity);
});
