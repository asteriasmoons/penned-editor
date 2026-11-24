import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { syncWeekDayPanels } from './week-strip-visibility.js';

test('Calendar navigates dates like Tabs: keeps both editable panel DOM trees mounted and changes only active state', () => {
  const { window } = new JSDOM('<div id="panels"><div class="penned-week-day-panel" data-week-date="2026-11-19"><p>Earlier</p></div><div class="penned-week-day-panel" data-week-date="2026-11-20"><div data-card="morning">Morning Routine</div><div data-event="moon">Moon Event</div></div></div>');
  const root = window.document.querySelector('#panels');
  const earlier = root.children[0], today = root.children[1];
  assert.deepEqual(syncWeekDayPanels(root, '2026-11-20'), { mounted: 2, matched: true });
  assert.equal(today.hasAttribute('data-active'), true);
  syncWeekDayPanels(root, '2026-11-19');
  assert.equal(earlier.hasAttribute('data-active'), true);
  assert.equal(today.hasAttribute('data-active'), false);
  assert.equal(today.hidden, false);
  assert.equal(today.style.display, '');
  assert.deepEqual(syncWeekDayPanels(root, '2026-11-20'), { mounted: 2, matched: true });
  assert.strictEqual(root.children[1], today);
  assert.equal(today.querySelector('[data-card]').textContent, 'Morning Routine');
  assert.equal(today.querySelector('[data-event]').textContent, 'Moon Event');
});

test('Calendar reports a missing active date while preserving existing child panels', () => {
  const { window } = new JSDOM('<div id="panels"><div class="penned-week-day-panel" data-week-date="2026-11-20">Saved</div></div>');
  const root = window.document.querySelector('#panels');
  assert.deepEqual(syncWeekDayPanels(root, '2026-11-27'), { mounted: 1, matched: false });
  assert.equal(root.firstChild.textContent, 'Saved');
});
