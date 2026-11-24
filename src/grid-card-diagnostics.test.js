import test from 'node:test';
import assert from 'node:assert/strict';
import { gridCardSettingDifferences, gridCardSettingTypes } from './grid-card-diagnostics.js';

test('reveals precisely which Grid Card settings disagree without exposing values', () => {
  const original = { title: 'Private journal', titleColor: null, textColor: null, alignment: 'left' };
  const stored = { ...original, titleColor: '#ffffff', alignment: 'center' };
  assert.deepEqual(gridCardSettingDifferences(original, stored), ['alignment', 'titleColor']);
  assert.equal(JSON.stringify(gridCardSettingDifferences(original, stored)).includes('Private journal'), false);
  assert.equal(JSON.stringify(gridCardSettingDifferences(original, stored)).includes('#ffffff'), false);
});

test('distinguishes unset settings from explicit colors, without logging either color', () => {
  assert.deepEqual(gridCardSettingDifferences({ textColor: null }, { textColor: '#000000' }), ['textColor']);
  assert.deepEqual(gridCardSettingDifferences({ textColor: null }, { textColor: null }), []);
  assert.deepEqual(gridCardSettingTypes({ title: 'Sensitive', titleColor: null, textColor: '#ffffff' }),
    { title: 'string', titleColor: 'null', textColor: 'string' });
});
