import test from 'node:test';
import assert from 'node:assert/strict';
import { WEEK_STRIP_DEFAULTS, sanitizeWeekStripSetting, weekStripOpenDate } from './week-strip-settings.js';
test('every required appearance and calendar setting has an independent persisted default', () => {
  for (const key of ['inactiveTabColor','activeTabColor','navigationColor','containerBorderColor','backgroundColor','contentTextColor','borderWidth','borderThickness','cornerRadius','fontSize','fontWeight','firstDayOfWeek','selectedDateBehavior','padding','spacing']) assert.ok(key in WEEK_STRIP_DEFAULTS, key);
});
test('invalid settings cannot overwrite valid saved settings', () => {
  assert.equal(sanitizeWeekStripSetting('activeTabColor', 'javascript:alert(1)'), undefined);
  assert.equal(sanitizeWeekStripSetting('firstDayOfWeek', 7), 6);
  assert.equal(sanitizeWeekStripSetting('selectedDateBehavior', 'today'), 'today');
  assert.equal(sanitizeWeekStripSetting('alignment', 'center'), undefined);
  assert.equal(sanitizeWeekStripSetting('padding', null), undefined);
});
test('opening a document respects today versus remembered selection', () => {
  assert.equal(weekStripOpenDate({selectedDateBehavior:'today',selectedDate:'2026-01-01'}, '2026-11-20'), '2026-11-20');
  assert.equal(weekStripOpenDate({selectedDateBehavior:'remember',selectedDate:'2026-01-01'}, '2026-11-20'), '2026-01-01');
});

test('appearance updates preserve selected date and all nested content without mutating other strips', async () => {
  const { updateWeekStripAppearanceJSON } = await import('./week-strip-settings.js');
  const makeStrip = id => ({ type: 'weekStrip', attrs: { id, selectedDate: '2026-11-20', activeTabColor: '#9276dc' }, content: [{ type: 'weekDayPanel', attrs: { id: `${id}-friday`, date: '2026-11-20' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Friday entry' }] }] }] });
  const first = makeStrip('first');
  const second = makeStrip('second');
  const updated = updateWeekStripAppearanceJSON(first, 'activeTabColor', '#ff00aa');
  assert.equal(updated.attrs.activeTabColor, '#ff00aa');
  assert.equal(updated.attrs.selectedDate, first.attrs.selectedDate);
  assert.deepEqual(updated.content, first.content);
  assert.equal(first.attrs.activeTabColor, '#9276dc');
  assert.equal(second.attrs.activeTabColor, '#9276dc');
  assert.equal(updateWeekStripAppearanceJSON(first, 'selectedDate', '2027-01-01'), null);
});
