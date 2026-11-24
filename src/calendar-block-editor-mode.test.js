import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStripChromeEvent, weekStripSettingsAllowed } from './calendar-block-editor-mode.js';
import { linkedEventInteractionEvent } from './calendar-block-editor-mode.js';

test('week navigation and date taps remain interactive in editor-off mode', () => {
  for (const event of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart']) {
    assert.equal(weekStripChromeEvent(event), true);
  }
  assert.equal(weekStripChromeEvent('keydown'), false);
  assert.equal(weekStripChromeEvent('copy'), false);
});

test('week settings stay inaccessible when editor is off, while dates stay navigable', () => {
  assert.equal(weekStripSettingsAllowed(false), false);
  assert.equal(weekStripSettingsAllowed(true), true);
});

test('linked event chrome remains tappable without selecting or editing the document', () => {
  assert.equal(linkedEventInteractionEvent('pointerdown'), true);
  assert.equal(linkedEventInteractionEvent('click'), true);
  assert.equal(linkedEventInteractionEvent('touchstart'), true);
  assert.equal(linkedEventInteractionEvent('keydown'), false);
  assert.equal(linkedEventInteractionEvent('copy'), false);
});
