import test from 'node:test';
import assert from 'node:assert/strict';
import { weekDateKeys, ensureWeekPanels, validDateKey, shiftWeekDateKey, formatWeekRange } from './week-strip-model.js';

test('week boundaries cross years and retain the configured first weekday', () => {
  assert.deepEqual(weekDateKeys('2026-12-31', 0), ['2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
});
test('revisiting a week preserves authored content and does not duplicate panels', () => {
  const make = date => ({ attrs: { date }, content: [{ text: date }] });
  const first = ensureWeekPanels({ content: [] }, '2026-11-20', 0, make);
  first.content[5].content = [{ text: 'My Friday notes' }];
  const later = ensureWeekPanels(first, '2026-12-04', 0, make);
  const revisited = ensureWeekPanels(later, '2026-11-20', 0, make);
  assert.equal(revisited.content.length, 14);
  assert.equal(revisited.content.find(p => p.attrs.date === '2026-11-20').content[0].text, 'My Friday notes');
});
test('invalid dates are rejected', () => {
  assert.equal(validDateKey('2026-02-30'), false);
  assert.equal(validDateKey('2026-11-20'), true);
});

test('week navigation retains the selected weekday across month and year boundaries', () => {
  assert.equal(shiftWeekDateKey('2026-12-31', 1), '2027-01-07');
  assert.equal(shiftWeekDateKey('2027-01-07', -1), '2026-12-31');
  assert.equal(shiftWeekDateKey('2028-02-24', 1), '2028-03-02');
});

test('navigation updates the complete seven-day strip from Nov 15–21 to Nov 22–28', () => {
  const initial = weekDateKeys('2026-11-15', 0);
  const next = weekDateKeys(shiftWeekDateKey('2026-11-15', 1), 0);
  const previous = weekDateKeys(shiftWeekDateKey('2026-11-22', -1), 0);
  assert.equal(initial[0], '2026-11-15');
  assert.equal(initial[6], '2026-11-21');
  assert.equal(next[0], '2026-11-22');
  assert.equal(next[6], '2026-11-28');
  assert.deepEqual(previous, initial);
});

test('range label adapts to month and year boundaries', () => {
  assert.equal(formatWeekRange('2026-11-29', '2026-12-05', 'en-US'), 'Nov 29 - Dec 5');
  assert.equal(formatWeekRange('2026-12-28', '2027-01-03', 'en-US'), 'Dec 28, 2026 - Jan 3, 2027');
  assert.equal(formatWeekRange('2026-11-15', '2026-11-21', 'en-US'), 'Nov 15 - Nov 21');
});

test('configured first weekday changes the seven-day sequence at year boundaries', () => {
  assert.deepEqual(weekDateKeys('2026-12-31', 1), ['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
  assert.deepEqual(weekDateKeys('2026-12-31', 0), ['2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
});
