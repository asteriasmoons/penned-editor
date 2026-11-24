import test from "node:test";
import assert from "node:assert/strict";
import { freshClipboardBlockIDs } from "./block-clipboard-ids.js";

test("freshens every nested block ID and remaps internal active tab references without changing styles", () => {
  const original = [
    {
      type: "tabs",
      attrs: {
        id: "tabs-id",
        activeTab: "panel-b",
        backgroundColor: "#ff00cc",
      },
      content: [
        {
          type: "tabPanel",
          attrs: { id: "panel-a" },
          content: [
            {
              type: "paragraph",
              attrs: { id: "text-a" },
              content: [
                { type: "text", text: "Hello", marks: [{ type: "bold" }] },
              ],
            },
          ],
        },
        {
          type: "tabPanel",
          attrs: { id: "panel-b" },
          content: [
            {
              type: "informationCard",
              attrs: { id: "card-id", borderColor: "#00ffff", hideTitle: true },
              content: [],
            },
          ],
        },
      ],
    },
  ];
  let next = 0;
  const copied = freshClipboardBlockIDs(original, () => `new-${++next}`);
  assert.equal(copied[0].attrs.id, "new-1");
  assert.equal(copied[0].attrs.activeTab, copied[0].content[1].attrs.id);
  assert.equal(copied[0].content[1].content[0].attrs.id, "new-5");
  assert.equal(copied[0].content[1].content[0].attrs.borderColor, "#00ffff");
  assert.equal(copied[0].content[1].content[0].attrs.hideTitle, true);
  assert.deepEqual(
    copied[0].content[0].content[0].content,
    original[0].content[0].content[0].content,
  );
  assert.equal(original[0].attrs.id, "tabs-id");
});

test("copying a Week Strip deep-copies all visited dates, nested blocks, appearance and calendar settings", () => {
  const source = [
    {
      type: "weekStrip",
      attrs: {
        id: "strip-original",
        selectedDate: "2026-11-20",
        firstDayOfWeek: 1,
        selectedDateBehavior: "remember",
        activeTabColor: "#ff00ff",
        padding: 12,
      },
      content: [
        {
          type: "weekDayPanel",
          attrs: { id: "friday-original", date: "2026-11-20" },
          content: [
            {
              type: "paragraph",
              attrs: { id: "paragraph-original" },
              content: [
                {
                  type: "text",
                  text: "Original journal",
                  marks: [{ type: "bold" }],
                },
              ],
            },
            {
              type: "informationCard",
              attrs: { id: "card-original", borderColor: "#123456" },
              content: [
                {
                  type: "linkedCalendarEvent",
                  attrs: {
                    id: "link-original",
                    eventID: "original-event",
                    eventIdentity: {
                      calendarID: "work",
                      sourceID: "icloud",
                      localID: "meeting",
                      occurrenceDate: null,
                    },
                    title: "Meeting",
                  },
                },
              ],
            },
          ],
        },
        {
          type: "weekDayPanel",
          attrs: { id: "next-friday-original", date: "2026-11-27" },
          content: [
            {
              type: "paragraph",
              attrs: { id: "later-original" },
              content: [{ type: "text", text: "Later entry" }],
            },
          ],
        },
      ],
    },
  ];
  let sequence = 0;
  const copied = freshClipboardBlockIDs(source, () => `new-${++sequence}`);
  const original = source[0];
  const duplicate = copied[0];
  assert.notEqual(duplicate.attrs.id, original.attrs.id);
  assert.equal(duplicate.attrs.selectedDate, original.attrs.selectedDate);
  assert.equal(duplicate.attrs.firstDayOfWeek, 1);
  assert.equal(duplicate.attrs.selectedDateBehavior, "remember");
  assert.equal(duplicate.attrs.activeTabColor, "#ff00ff");
  assert.equal(duplicate.attrs.padding, 12);
  assert.deepEqual(
    duplicate.content.map((panel) => panel.attrs.date),
    ["2026-11-20", "2026-11-27"],
  );
  assert.equal(duplicate.content[1].content[0].content[0].text, "Later entry");
  const originalIDs = new Set();
  const copyIDs = new Set();
  const collect = (node, ids) => {
    if (node.attrs?.id) ids.add(node.attrs.id);
    for (const child of node.content || []) collect(child, ids);
  };
  collect(original, originalIDs);
  collect(duplicate, copyIDs);
  assert.equal(copyIDs.size, originalIDs.size);
  for (const blockID of copyIDs) assert.equal(originalIDs.has(blockID), false);
  duplicate.content[0].content[0].content[0].text = "Edited copy";
  duplicate.content[0].content[0].content[0].marks[0].type = "italic";
  duplicate.content[0].content[1].attrs.borderColor = "#654321";
  duplicate.content[0].content[1].content[0].attrs.eventIdentity.localID =
    "mutated-copy";
  assert.equal(
    original.content[0].content[0].content[0].text,
    "Original journal",
  );
  assert.equal(original.content[0].content[0].content[0].marks[0].type, "bold");
  assert.equal(original.content[0].content[1].attrs.borderColor, "#123456");
  assert.equal(
    original.content[0].content[1].content[0].attrs.eventIdentity.localID,
    "meeting",
  );
});

test("duplicating an Existing Event makes a separate document block with the same original calendar reference", () => {
  const source = [
    {
      type: "linkedCalendarEvent",
      attrs: {
        id: "link-original",
        eventID: "event-hash",
        eventIdentity: {
          calendarID: "work",
          sourceID: "icloud",
          localID: "event-id",
          externalID: "external-id",
          occurrenceDate: "2026-11-20T14:00:00Z",
        },
        title: "Review",
        calendarTitle: "Work",
        start: "2026-11-20T14:00:00Z",
        end: "2026-11-20T15:00:00Z",
        timeZoneID: "America/Chicago",
      },
    },
  ];
  const duplicate = freshClipboardBlockIDs(source, () => "new-block")[0];
  assert.equal(duplicate.attrs.id, "new-block");
  assert.equal(duplicate.attrs.eventID, source[0].attrs.eventID);
  assert.deepEqual(
    duplicate.attrs.eventIdentity,
    source[0].attrs.eventIdentity,
  );
  assert.equal(duplicate.attrs.start, source[0].attrs.start);
  assert.equal(duplicate.attrs.end, source[0].attrs.end);
  duplicate.attrs.eventIdentity.calendarID = "other-calendar";
  assert.equal(source[0].attrs.eventIdentity.calendarID, "work");
  assert.equal(duplicate.content, undefined);
});

test("pasting configured reminders preserves shared reminder identity but freshens nested block IDs", () => {
  const original = [{
    type: "iconCallout", attrs: { id: "callout-a", icon: "sparkle" },
    content: [{
      type: "taskList", attrs: { id: "list-a" },
      content: [{
        type: "taskItem", attrs: {
          id: "item-a", checked: false,
          trackedTask: {
            id: "c48b6790-fc76-4bed-abf1-465934b96edc",
            occurrenceID: "b24111dd-1461-4ec7-a561-0cb0199edbf1",
            scheduledAt: 1795471200, reminderEnabled: true,
            recurrence: { frequency: "daily", hour: 9, minute: 0 },
            history: [{ id: "history-a", completedAt: 1795300000 }],
          },
        },
        content: [{ type: "paragraph", attrs: { id: "paragraph-a" },
                    content: [{ type: "text", text: "Chip's Medicine" }] }],
      }],
    }],
  }];
  let next = 0;
  const pasted = freshClipboardBlockIDs(original, () => "copy-" + ++next);
  const first = original[0].content[0].content[0];
  const second = pasted[0].content[0].content[0];
  assert.notEqual(pasted[0].attrs.id, original[0].attrs.id);
  assert.notEqual(second.attrs.id, first.attrs.id);
  assert.notEqual(second.content[0].attrs.id, first.content[0].attrs.id);
  assert.deepEqual(second.attrs.trackedTask, first.attrs.trackedTask);
  second.content[0].content[0].text = "Another display";
  assert.equal(first.content[0].content[0].text, "Chip's Medicine");
});
