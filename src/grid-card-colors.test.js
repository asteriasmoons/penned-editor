import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_CARD_DEFAULTS, gridCardSettings, gridCardDOMAttributes } from './grid-card.js';

test('existing Grid Cards keep automatic readable title and text colors', () => {
  const card = gridCardSettings({ backgroundColor: '#f5f5f5' });
  assert.equal(card.titleColor, null);
  assert.equal(card.textColor, null);
  const rendered = gridCardDOMAttributes(card);
  assert.match(rendered.style, /--penned-grid-title-ink:#000000/);
  assert.match(rendered.style, /--penned-grid-ink:#000000/);
});

test('title and body text colors persist independently and affect the rendered card', () => {
  const card = gridCardSettings({ titleColor: '#ff0088', textColor: '#00ffcc', backgroundColor: '#191919' });
  assert.equal(card.titleColor, '#ff0088');
  assert.equal(card.textColor, '#00ffcc');
  const rendered = gridCardDOMAttributes(card);
  assert.equal(rendered['data-grid-title-color'], '#ff0088');
  assert.equal(rendered['data-grid-text-color'], '#00ffcc');
  assert.match(rendered.style, /--penned-grid-title-ink:#ff0088/);
  assert.match(rendered.style, /--penned-grid-ink:#00ffcc/);
  assert.equal(GRID_CARD_DEFAULTS.titleColor, null);
  assert.equal(GRID_CARD_DEFAULTS.textColor, null);
});

test('invalid custom text colors never override existing readability', () => {
  const card = gridCardSettings({ titleColor: 'red;}', textColor: '#zzzzzz', backgroundColor: '#000000' });
  assert.equal(card.titleColor, null);
  assert.equal(card.textColor, null);
  assert.match(gridCardDOMAttributes(card).style, /--penned-grid-title-ink:#ffffff/);
});
