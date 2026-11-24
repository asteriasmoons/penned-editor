import test from 'node:test';
import assert from 'node:assert/strict';
import { navigateWeekStripJSON } from './week-strip.js';

const panel = (date, text) => ({ type: 'weekDayPanel', attrs: { id: `panel-${date}`, date }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

test('selecting Wednesday displays Wednesday while preserving Friday and other dates', () => {
  const wednesday = panel('2026-11-18', 'Wednesday content');
  const friday = panel('2026-11-20', 'Friday content');
  const original = { type: 'weekStrip', attrs: { id: 'strip-1', selectedDate: '2026-11-20', firstDayOfWeek: 0 }, content: [wednesday, friday] };
  const selected = navigateWeekStripJSON(original, '2026-11-18');
  assert.equal(selected.attrs.selectedDate, '2026-11-18');
  assert.equal(selected.content.find(p => p.attrs.date === selected.attrs.selectedDate).content[0].content[0].text, 'Wednesday content');
  assert.deepEqual(selected.content.find(p => p.attrs.date === '2026-11-20'), friday);
  assert.deepEqual(original.content, [wednesday, friday]);
  assert.equal(new Set(selected.content.map(p => p.attrs.date)).size, selected.content.length);
});

test('switching back to Friday restores its exact original content', () => {
  const original = { type: 'weekStrip', attrs: { id: 'strip-1', selectedDate: '2026-11-20', firstDayOfWeek: 0 }, content: [panel('2026-11-18', 'Wednesday content'), panel('2026-11-20', 'Friday content')] };
  const wednesday = navigateWeekStripJSON(original, '2026-11-18');
  const friday = navigateWeekStripJSON(wednesday, '2026-11-20');
  assert.equal(friday.content.find(p => p.attrs.date === friday.attrs.selectedDate).content[0].content[0].text, 'Friday content');
  assert.deepEqual(friday.content, wednesday.content);
});

test('content survives navigating multiple weeks in both directions and revisiting', () => {
  const original = { type: 'weekStrip', attrs: { id: 'strip-1', selectedDate: '2026-11-20', firstDayOfWeek: 0 }, content: [panel('2026-11-20', 'Original Friday notes')] };
  const next = navigateWeekStripJSON(original, '2026-12-11');
  const edited = { ...next, content: next.content.map(p => p.attrs.date === '2026-12-11' ? panel('2026-12-11', 'December notes') : p) };
  const backward = navigateWeekStripJSON(edited, '2026-10-02');
  const revisitedNovember = navigateWeekStripJSON(backward, '2026-11-20');
  const revisitedDecember = navigateWeekStripJSON(revisitedNovember, '2026-12-11');
  assert.equal(revisitedNovember.content.find(p => p.attrs.date === '2026-11-20').content[0].content[0].text, 'Original Friday notes');
  assert.equal(revisitedDecember.content.find(p => p.attrs.date === '2026-12-11').content[0].content[0].text, 'December notes');
  assert.equal(new Set(revisitedDecember.content.map(p => p.attrs.date)).size, revisitedDecember.content.length);
});

test('unvisited dates receive an empty editable paragraph and remain serializable', () => {
  const original = { type: 'weekStrip', attrs: { id: 'strip-1', selectedDate: '2026-11-20', firstDayOfWeek: 0 }, content: [panel('2026-11-20', 'Keep me')] };
  const selected = navigateWeekStripJSON(original, '2027-04-09');
  const fresh = selected.content.find(p => p.attrs.date === '2027-04-09');
  assert.equal(fresh.type, 'weekDayPanel');
  assert.equal(fresh.content.length, 1);
  assert.equal(fresh.content[0].type, 'paragraph');
  assert.equal(fresh.content[0].content?.length ?? 0, 0);
  assert.ok(fresh.attrs.id);
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), selected);
  assert.deepEqual(selected.content.find(p => p.attrs.date === '2026-11-20'), original.content[0]);
});

test('rich text, nested layout blocks, formatting marks, and block identities stay with their dates', () => {
  const friday = {
    type: 'weekDayPanel', attrs: { id: 'friday-panel', date: '2026-11-20' }, content: [
      { type: 'heading', attrs: { id: 'friday-heading', level: 2, textAlign: 'center' }, content: [
        { type: 'text', text: 'Styled heading', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#ff00aa' } }] },
      ] },
      { type: 'informationCard', attrs: { id: 'friday-infocard' }, content: [
        { type: 'informationCardBody', content: [
          { type: 'taskList', attrs: { id: 'friday-tasks' }, content: [
            { type: 'taskItem', attrs: { id: 'friday-task', checked: true }, content: [
              { type: 'paragraph', attrs: { id: 'friday-task-text' }, content: [{ type: 'text', text: 'Completed' }] },
            ] },
          ] },
        ] },
      ] },
    ],
  };
  const saturday = { type: 'weekDayPanel', attrs: { id: 'saturday-panel', date: '2026-11-21' }, content: [
    { type: 'paragraph', attrs: { id: 'saturday-paragraph' }, content: [{ type: 'text', text: 'Saturday' }] },
  ] };
  const original = { type: 'weekStrip', attrs: { id: 'strip-1', selectedDate: '2026-11-20', firstDayOfWeek: 0 }, content: [friday, saturday] };
  const later = navigateWeekStripJSON(original, '2027-03-13');
  const revisited = navigateWeekStripJSON(later, '2026-11-20');
  assert.deepEqual(revisited.content.find(p => p.attrs.date === '2026-11-20'), friday);
  assert.deepEqual(revisited.content.find(p => p.attrs.date === '2026-11-21'), saturday);
  assert.deepEqual(original.content, [friday, saturday]);
});
