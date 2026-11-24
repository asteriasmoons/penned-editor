import { DOMSerializer } from "@tiptap/pm/model";
import { linkedEventInteractionEvent } from "./calendar-block-editor-mode.js";
import { linkedEventTapPayload } from "./linked-calendar-event-tap.js";
import { linkedEventDisplay } from "./linked-calendar-event-display.js";
import { Node, mergeAttributes } from '@tiptap/core';

// Reference-only document block: the event is owned by the calendar, never
// created or copied when this block is inserted.
export const LinkedCalendarEvent = Node.create({
  name: 'linkedCalendarEvent', group: 'block', atom: true, selectable: true,
  addAttributes() {
    const stringAttribute = (key, attribute) => ({
      default: '',
      parseHTML: element => element.getAttribute(attribute) ?? '',
    });
    return {
      id: { default: null, parseHTML: element => element.getAttribute('data-vellix-block-id') },
      eventID: stringAttribute('eventID', 'data-event-id'),
      eventIdentity: { default: null, parseHTML: element => {
        try { return JSON.parse(element.getAttribute('data-event-identity') || 'null'); } catch { return null; }
      } },
      title: stringAttribute('title', 'data-event-title'),
      calendarTitle: stringAttribute('calendarTitle', 'data-event-calendar-title'),
      start: stringAttribute('start', 'data-event-start'),
      end: stringAttribute('end', 'data-event-end'),
      isAllDay: { default: false, parseHTML: element => element.getAttribute('data-event-all-day') === 'true' },
      timeZoneID: { default: null, parseHTML: element => element.getAttribute('data-event-time-zone') },
      available: { default: true, parseHTML: element => element.getAttribute('data-event-available') !== 'false' },
    };
  },
  parseHTML() { return [{ tag: 'div[data-linked-calendar-event]' }]; },
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('div');
      const update = next => {
        if (next.type.name !== 'linkedCalendarEvent') return false;
        node = next;
        const markup = DOMSerializer.fromSchema(editor.schema).serializeNode(next);
        dom.replaceChildren(...Array.from(markup.childNodes));
        for (const attr of Array.from(dom.attributes)) dom.removeAttribute(attr.name);
        for (const attr of Array.from(markup.attributes)) dom.setAttribute(attr.name, attr.value);
        return true;
      };
      dom.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const payload = linkedEventTapPayload(node.attrs);
        if (payload) window.webkit?.messageHandlers?.tiptap?.postMessage({ kind: 'linkedCalendarEventTap', payload });
      });
      update(node);
      return { dom, update, stopEvent: event => linkedEventInteractionEvent(event.type) };
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-linked-calendar-event': '', class: 'penned-linked-calendar-event', 'data-event-id': node.attrs.eventID,
      'data-event-identity': node.attrs.eventIdentity ? JSON.stringify(node.attrs.eventIdentity) : '',
      'data-vellix-block-id': node.attrs.id,
      'data-event-available': node.attrs.available === false ? 'false' : 'true',
      'data-event-title': node.attrs.title,
      'data-event-calendar-title': node.attrs.calendarTitle,
      'data-event-start': node.attrs.start,
      'data-event-end': node.attrs.end,
      'data-event-all-day': node.attrs.isAllDay === true ? 'true' : 'false',
      'data-event-time-zone': node.attrs.timeZoneID,
    }),
      ['span', { class: 'penned-linked-event-accent', 'aria-hidden': 'true' }],
      ['span', { class: 'penned-linked-event-details' },
        ['span', { class: 'penned-linked-event-title' }, node.attrs.available === false ? 'Event Unavailable' : linkedEventDisplay(node.attrs).title],
        ...(node.attrs.available === false ? [] : [['span', { class: 'penned-linked-event-calendar' }, linkedEventDisplay(node.attrs).calendarTitle]]),
        ...(node.attrs.available === false ? [['span', { class: 'penned-linked-event-date' }, 'The original calendar event is no longer accessible.']] : [['span', { class: 'penned-linked-event-date' }, linkedEventDisplay(node.attrs).date]]),
        ...(node.attrs.available === false ? [] : [['span', { class: 'penned-linked-event-time' }, linkedEventDisplay(node.attrs).time]]),
      ],
    ];
  },
});
