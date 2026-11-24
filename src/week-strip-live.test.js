import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { WeekStrip, WeekDayPanel } from './week-strip.js';
import { weekStripJSON } from './week-strip.js';

test('real TipTap Calendar restores card and event contents after date switches and after style update', async () => {
  const {window}=new JSDOM('<!doctype html><div id="editor"></div>',{pretendToBeVisual:true});
  for(const key of ['window','document','HTMLElement','Element','Node','MutationObserver','DOMParser']) globalThis[key]=window[key];
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.getComputedStyle=window.getComputedStyle.bind(window);
  globalThis.crypto ||= window.crypto;
  const events=[];
  const json=weekStripJSON({selectedDate:new Date(2026,10,20)});
  const today=json.content.find(panel=>panel.attrs.date==='2026-11-20');
  today.content=[{type:'paragraph', content:[{type:'text', text:'Morning Routine'}]}, {type:'paragraph',content:[{type:'text',text:'Moon Event'}]}];
  const editor=new Editor({element:window.document.querySelector('#editor'),extensions:[StarterKit,WeekStrip.configure({post:(kind,payload)=>events.push({kind,payload})}),WeekDayPanel],content:{type:'doc',content:[json]}});
  await new Promise(resolve=>setTimeout(resolve,5));
  const strip=window.document.querySelector('.penned-week-strip');
  const day=date=>window.document.querySelector(`.penned-week-strip-day[data-date="${date}"]`);
  assert.match(strip.textContent,/Morning Routine/);
  day('2026-11-19').click();
  await new Promise(resolve=>setTimeout(resolve,5));
  day('2026-11-20').click();
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(editor.getJSON().content[0].content.find(item=>item.attrs.date==='2026-11-20').content.length,2);
  const panel=window.document.querySelector('.penned-week-day-panel[data-week-date="2026-11-20"]');
  assert.match(panel.textContent,/Morning Routine/);
  assert.equal(panel.hasAttribute('data-active'),true);
  assert.equal(events.some(e=>e.kind==='calendarDiagnostic'),true);
  editor.destroy();
});

test('real TipTap date taps route all block insertions to visible day instead of preserved hidden card/event days', async () => {
  const { window } = new JSDOM('<!doctype html><div id="editor"></div>', { pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMParser']) globalThis[key] = window[key];
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  const { Node: TipTapNode } = await import('@tiptap/core');
  const makeAtom = name => TipTapNode.create({
    name, group: 'block', atom: true,
    addAttributes() { return { id: { default: null } }; },
    parseHTML() { return [{ tag: `div[data-${name}]` }]; },
    renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, [`data-${name}`]: '' }]; },
  });
  const json = weekStripJSON({ selectedDate: new Date(2026, 10, 20) });
  json.content.find(p => p.attrs.date === '2026-11-15').content = [{ type: 'pageReference', attrs: { id: 'old-card' } }];
  json.content.find(p => p.attrs.date === '2026-11-16').content = [{ type: 'linkedCalendarEvent', attrs: { id: 'old-event' } }];
  const editor = new Editor({
    element: window.document.querySelector('#editor'),
    extensions: [StarterKit, WeekStrip, WeekDayPanel, makeAtom('pageReference'), makeAtom('linkedCalendarEvent')],
    content: { type: 'doc', content: [json] },
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  const getPanel = date => editor.getJSON().content[0].content.find(panel => panel.attrs.date === date);
  const clickDate = date => window.document.querySelector(`.penned-week-strip-day[data-date="${date}"]`).click();
  // Initial editor selection is in a different day. Clicking Friday must
  // explicitly redirect it before all native Add Block kinds run.
  clickDate('2026-11-20');
  assert.equal(editor.state.selection.$from.node(2).attrs.date, '2026-11-20');
  assert.equal(editor.commands.insertContent({ type: 'pageReference', attrs: { id: 'new-card' } }), true);
  clickDate('2026-11-21');
  clickDate('2026-11-20');
  assert.equal(editor.state.selection.$from.node(2).attrs.date, '2026-11-20');
  assert.equal(editor.commands.insertContent({ type: 'linkedCalendarEvent', attrs: { id: 'new-event' } }), true);
  assert.ok(getPanel('2026-11-20').content.some(block => block.attrs?.id === 'new-card'));
  assert.ok(getPanel('2026-11-20').content.some(block => block.attrs?.id === 'new-event'));
  assert.equal(getPanel('2026-11-15').content[0].attrs.id, 'old-card');
  assert.equal(getPanel('2026-11-16').content[0].attrs.id, 'old-event');
  editor.destroy();
});

test('empty space after Calendar event focuses a trailing paragraph rather than text above Calendar', async () => {
  const { window } = new JSDOM('<!doctype html><div id="editor"></div>', { pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMParser']) globalThis[key] = window[key];
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  const { Node: TipTapNode } = await import('@tiptap/core');
  const makeAtom = name => TipTapNode.create({
    name, group: 'block', atom: true,
    addAttributes() { return { id: { default: null } }; },
    parseHTML() { return [{ tag: `div[data-${name}]` }]; },
    renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, [`data-${name}`]: '' }]; },
  });
  const json = weekStripJSON({ selectedDate: new Date(2026, 10, 20) });
  json.content.find(panel => panel.attrs.date === '2026-11-20').content = [
    { type: 'pageReference', attrs: { id: 'morning-card' } },
    { type: 'linkedCalendarEvent', attrs: { id: 'moon-event' } },
  ];
  const editor = new Editor({
    element: window.document.querySelector('#editor'),
    extensions: [StarterKit, WeekStrip, WeekDayPanel, makeAtom('pageReference'), makeAtom('linkedCalendarEvent')],
    content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Morning Routine above Calendar' }] }, json,
    ] },
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  const panel = window.document.querySelector('.penned-week-day-panel[data-week-date="2026-11-20"]');
  panel.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  const active = editor.getJSON().content[1].content.find(child => child.attrs.date === '2026-11-20');
  assert.equal(active.content.at(-1).type, 'paragraph');
  assert.equal(active.content[0].attrs.id, 'morning-card');
  assert.equal(active.content[1].attrs.id, 'moon-event');
  const $from = editor.state.selection.$from;
  assert.equal($from.parent.type.name, 'paragraph');
  assert.equal($from.node($from.depth - 1).attrs.date, '2026-11-20');
  assert.equal(editor.state.doc.firstChild.textContent, 'Morning Routine above Calendar');
  editor.destroy();
});

test('tapping empty Calendar background below content targets the same date, not surrounding document', async () => {
  const { window } = new JSDOM('<!doctype html><div id="editor"></div>', { pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMParser']) globalThis[key] = window[key];
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  const json = weekStripJSON({ selectedDate: new Date(2026, 10, 20) });
  const editor = new Editor({ element: window.document.querySelector('#editor'),
    extensions: [StarterKit, WeekStrip, WeekDayPanel],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Outside' }] }, json] },
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  const strip = window.document.querySelector('.penned-week-strip');
  strip.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  const $from = editor.state.selection.$from;
  assert.equal($from.parent.type.name, 'paragraph');
  assert.equal($from.node($from.depth - 1).attrs.date, '2026-11-20');
  assert.equal(editor.state.doc.firstChild.textContent, 'Outside');
  editor.destroy();
});
