import test from 'node:test';
import assert from 'node:assert/strict';
import { insertionPanelDepth } from './week-strip-insertion.js';

test('the selected date panel is the insertion container for all block kinds', () => {
  const nodes = ['doc', 'weekStrip', 'weekDayPanel', 'paragraph'];
  const cursor = { depth: 3, node: depth => ({ type: { name: nodes[depth] } }) };
  assert.equal(insertionPanelDepth(cursor), 3);
});

test('nested containers keep the innermost active date panel', () => {
  const nodes = ['doc', 'tabs', 'tabPanel', 'weekStrip', 'weekDayPanel', 'paragraph'];
  const cursor = { depth: 5, node: depth => ({ type: { name: nodes[depth] } }) };
  assert.equal(insertionPanelDepth(cursor), 5);
});

test('existing tabs still insert inside their active tab, normal document at root', () => {
  const tab = { depth: 3, node: depth => ({ type: { name: ['doc', 'tabs', 'tabPanel', 'paragraph'][depth] } }) };
  const root = { depth: 1, node: depth => ({ type: { name: ['doc', 'paragraph'][depth] } }) };
  assert.equal(insertionPanelDepth(tab), 3);
  assert.equal(insertionPanelDepth(root), 1);
});

test('Week Strip insertion remains inside an Infocard body, not outside the card', () => {
  const nodes = ['doc', 'informationCard', 'informationCardBody', 'paragraph'];
  const cursor = { depth: 3, node: depth => ({ type: { name: nodes[depth] } }) };
  assert.equal(insertionPanelDepth(cursor), 3);
});

test('Week Strip insertion targets the innermost editable container', () => {
  const nodes = ['doc', 'weekStrip', 'weekDayPanel', 'informationCard', 'informationCardBody', 'paragraph'];
  const cursor = { depth: 5, node: depth => ({ type: { name: nodes[depth] } }) };
  assert.equal(insertionPanelDepth(cursor), 5);
});
