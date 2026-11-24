import { Fragment, Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { bindNonEditingTap } from "./editor-control-activation.js";
import { createNodeIndex, inlineTextEdit, updateNodeIndex } from "./incremental-nodes.js";

const reportedSnapshots = new WeakSet();
function taskSnapshot(doc, post, canonicalize) {
  if (reportedSnapshots.has(doc)) return;
  reportedSnapshots.add(doc);
  post("taskSnapshot", { document: canonicalize(doc.toJSON()) });
}

export function independentTask(task) {
  return task ? { ...task, id: crypto.randomUUID(), occurrenceID: crypto.randomUUID(), history: [] } : null;
}

export function taskMenuContext(node, blockId = node.attrs.id) {
  const text = node.content.content.filter(child => child.type.name !== "taskList")
    .map(child => child.textContent).join(" ").trim();
  return { blockId, checked: node.attrs.checked === true, task: node.attrs.trackedTask, text };
}

export function repeatLabel(rule) {
  if (!rule) return "";
  const names = { daily: "Daily", weekdays: "Every Weekday", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
  const units = { daily: "Days", weekdays: "Days", weekly: "Weeks", monthly: "Months", yearly: "Years" };
  return rule.interval > 1 ? `Every ${rule.interval} ${units[rule.frequency]}` : (names[rule.frequency] || "Repeat");
}

export function reminderLabel(task, now = new Date()) {
  if (!task?.reminderEnabled || !Number.isFinite(task.scheduledAt)) return "";
  const date = new Date(task.scheduledAt * 1000);
  const options = task.recurrence?.timeZoneID ? { timeZone: task.recurrence.timeZoneID } : {};
  const dayKey = value => new Intl.DateTimeFormat("en-CA", { ...options, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const day = dayKey(date) === dayKey(now) ? "Today" : dayKey(date) === dayKey(tomorrow) ? "Tomorrow"
    : new Intl.DateTimeFormat(undefined, { ...options, month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(date);
  return `${day}, ${new Intl.DateTimeFormat("en-US", { ...options, hour: "numeric", minute: "2-digit", hour12: true }).format(date)}`;
}

export function createChecklistItem(TaskItem, { post, selectionActive, reportHeight, nodeID, iconSource }) {
  return TaskItem.extend({
    addAttributes() {
      return { ...this.parent?.(),
        trackedTask: {
          default: null, keepOnSplit: false,
          parseHTML: element => { try { return JSON.parse(element.getAttribute("data-tracked-task")); } catch { return null; } },
          renderHTML: attrs => attrs.trackedTask ? { "data-tracked-task": JSON.stringify(attrs.trackedTask) } : {},
        },
        crossed: { default: false, keepOnSplit: false,
          parseHTML: element => element.getAttribute("data-crossed") === "true",
          renderHTML: attrs => ({ "data-crossed": attrs.crossed === true ? "true" : "false" }) },
      };
    },
    addNodeView() {
      return ({ editor, node, getPos, HTMLAttributes }) => {
        let current = node, lastTapAt = Number.NEGATIVE_INFINITY, awaitingCompletion = null, pendingTap = null;
        const li = document.createElement("li"), label = document.createElement("label"), checkbox = document.createElement("input");
        const visual = document.createElement("span"), container = document.createElement("div"), contentDOM = document.createElement("div");
        const metadata = document.createElement("button"), history = document.createElement("button");
        label.contentEditable = "false"; checkbox.type = "checkbox"; checkbox.tabIndex = -1;
        visual.setAttribute("aria-hidden", "true"); contentDOM.dataset.vellixTaskContent = "true";
        metadata.type = "button"; metadata.contentEditable = "false";
        metadata.className = "vellix-task-metadata";
        history.type = "button"; history.contentEditable = "false"; history.className = "vellix-task-history";
        const dot = document.createElement("i"); dot.setAttribute("aria-hidden", "true");
        history.append(dot, document.createTextNode("Completed Tasks"));
        history.setAttribute("aria-label", "Open task and completion history");
        label.append(checkbox, visual); container.append(contentDOM, history, metadata); li.append(label, container);
        const context = () => taskMenuContext(current, nodeID(current));
        const openHistory = event => {
          event.preventDefault(); event.stopPropagation();
          if (!selectionActive() && current.attrs.trackedTask) post("pageOpenRequest", { documentId: "vellix-task-page:" + current.attrs.trackedTask.id });
        };
        const open = event => {
          event.preventDefault(); event.stopPropagation();
          if (selectionActive() || !editor.isEditable || !li.isConnected || getPos() == null) return;
          post("taskMenuRequest", context());
        };
        const render = () => {
          for (const [key, value] of Object.entries(HTMLAttributes || {})) if (value != null) li.setAttribute(key, value);
          li.dataset.type = "taskItem"; li.dataset.vellixBlockId = nodeID(current);
          li.dataset.checked = current.attrs.checked ? "true" : "false";
          const skipped = current.attrs.trackedTask?.history?.some(item => item.id === current.attrs.trackedTask.occurrenceID && item.outcome === "skipped");
          li.dataset.crossed = current.attrs.crossed || skipped ? "true" : "false";
          li.dataset.trackedTask = current.attrs.trackedTask ? "true" : "false";
          checkbox.checked = current.attrs.checked === true; checkbox.indeterminate = current.attrs.crossed === true || skipped === true;
          checkbox.setAttribute("aria-checked", checkbox.indeterminate ? "mixed" : String(checkbox.checked));
          label.setAttribute("aria-label", checkbox.indeterminate ? "Clear rejected task" : checkbox.checked ? "Mark task incomplete" : "Mark task complete");
          metadata.replaceChildren();
          const task = current.attrs.trackedTask;
          history.hidden = !task;
          for (const [asset, text] of [["repeatfill", repeatLabel(task?.recurrence)], ["clockwavy", reminderLabel(task)]]) {
            if (!text) continue;
            const item = document.createElement("span"), icon = document.createElement("i");
            icon.style.maskImage = icon.style.webkitMaskImage = `url("${iconSource(asset)}")`;
            icon.setAttribute("aria-hidden", "true"); item.append(icon, document.createTextNode(text)); metadata.append(item);
          }
          metadata.hidden = !metadata.childNodes.length;
          metadata.setAttribute("aria-label", "Edit task schedule");
          if (awaitingCompletion !== task?.occurrenceID || current.attrs.checked) awaitingCompletion = null;
          if (pendingTap && (pendingTap.taskID !== task?.id || pendingTap.occurrenceID !== task?.occurrenceID)) {
            clearTimeout(pendingTap.timer); pendingTap = null;
          }
        };
        const setState = (checked, crossed = false) => {
          const position = getPos(); if (position == null) return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, checked: crossed ? false : checked, crossed }));
          reportHeight();
        };
        const toggle = event => {
          event.preventDefault(); event.stopPropagation();
          if (selectionActive() || !editor.isEditable) return;
          const task = current.attrs.trackedTask;
          if (task) {
            if (awaitingCompletion) return;
            if (pendingTap) {
              clearTimeout(pendingTap.timer); pendingTap = null;
              awaitingCompletion = task.occurrenceID;
              post("taskCompletionRequest", { ...context(), completed: true, skipped: true });
            } else {
              // Resolve a single vs. double tap before advancing the occurrence.
              pendingTap = { taskID: task.id, occurrenceID: task.occurrenceID, timer: setTimeout(() => {
                pendingTap = null;
                if (!editor.isEditable || selectionActive() || !li.isConnected || getPos() == null) return;
                awaitingCompletion = current.attrs.trackedTask?.occurrenceID;
                post("taskCompletionRequest", { ...context(), completed: !current.attrs.checked, skipped: false });
              }, 300) };
            }
            return;
          }
          const tap = performance.now(), doubleTap = tap - lastTapAt <= 300;
          lastTapAt = doubleTap ? Number.NEGATIVE_INFINITY : tap;
          if (doubleTap) setState(false, true);
          else if (current.attrs.crossed) setState(false);
          else setState(!current.attrs.checked);
        };
        const keepSelection = event => { if (!selectionActive()) event.preventDefault(); };
        label.addEventListener("mousedown", keepSelection); label.addEventListener("click", toggle);
        bindNonEditingTap(metadata, open, () => editor.isEditable && !selectionActive());
        history.addEventListener("mousedown", keepSelection); history.addEventListener("click", openHistory);
        const release = () => { awaitingCompletion = null; };
        li.addEventListener("vellix-task-release", release);
        render();
        return { dom: li, contentDOM,
          update(node) {
            if (node.type.name !== "taskItem") return false;
            const changed = node.attrs !== current.attrs && !node.sameMarkup(current);
            current = node;
            if (changed) render();
            return true;
          },
          stopEvent(event) { return !selectionActive() && [label, metadata, history].some(element => element === event.target || element.contains(event.target)); },
          ignoreMutation(mutation) {
            return [label, metadata, history].some(element => element === mutation.target || element.contains(mutation.target))
              || (mutation.type === "attributes" && (mutation.target === li || mutation.target === container));
          },
          destroy() {
            if (pendingTap) clearTimeout(pendingTap.timer);
            label.removeEventListener("mousedown", keepSelection); label.removeEventListener("click", toggle);
            history.removeEventListener("mousedown", keepSelection); history.removeEventListener("click", openHistory);
            li.removeEventListener("vellix-task-release", release);
          },
        };
      };
    },
  }).configure({ nested: true });
}

export function createTaskIntegration({ Extension, Plugin, PluginKey, post, selectionActive, canonicalize }) {
  const pluginKey = new PluginKey("vellixTrackedTasks");
  const isTask = node => node.type.name === "taskItem";
  const indexes = new WeakMap();
  const taskIndex = doc => {
    if (!indexes.has(doc)) indexes.set(doc, createNodeIndex(doc, isTask));
    return indexes.get(doc);
  };
  return Extension.create({
    name: "vellixTrackedTasks",
    addGlobalAttributes() {
      return [{ types: ["doc"], attributes: { taskHistoryProjection: { default: null, rendered: false } } }];
    },
    addProseMirrorPlugins() {
      return [new Plugin({
        key: pluginKey,
        state: {
          init: () => 0,
          apply(tr, revision) {
            if (!tr.docChanged || inlineTextEdit(tr)) return revision;
            indexes.set(tr.doc, updateNodeIndex(taskIndex(tr.before), tr, isTask));
            return revision + 1;
          },
        },
        props: {
          transformPasted(slice) {
            const copy = fragment => Fragment.fromArray(Array.from({ length: fragment.childCount }, (_, i) => {
              const node = fragment.child(i);
              if (node.isText) return node;
              const attrs = node.attrs;
              return node.type.create(attrs, copy(node.content), node.marks);
            }));
            return new Slice(copy(slice.content), slice.openStart, slice.openEnd);
          },
        },
        appendTransaction(transactions, old, state) {
          if (!transactions.some(tr => tr.docChanged && !inlineTextEdit(tr))) return null;
          const previousNodes = new Set(taskIndex(old.doc).records.map(record => record.node));
          const records = taskIndex(state.doc).records;
          const stable = records.filter(record => previousNodes.has(record.node));
          const seenBlocks = new Set(stable.map(record => record.node.attrs.id));
          const tr = state.tr;
          for (const { node, pos } of records) {
            if (previousNodes.has(node)) continue;
            const attrs = { ...node.attrs };
            const blockID = typeof attrs.id === "string" ? attrs.id.trim() : "";
            // Formatting and Enter create checklist nodes without IDs. Repair the live
            // document before publishing selection state or targeting task commands.
            if (!blockID || seenBlocks.has(blockID)) attrs.id = crypto.randomUUID();
            else attrs.id = blockID;
            seenBlocks.add(attrs.id);
            if (attrs.id !== node.attrs.id) tr.setNodeMarkup(pos, undefined, attrs);
          }
          return tr.docChanged ? tr : null;
        },
        view(view) {
          let previous = undefined;
          const update = (view, old) => {
            let current = null;
            if (!selectionActive()) {
              for (let depth = view.state.selection.$from.depth; depth > 0; depth--) {
                const node = view.state.selection.$from.node(depth);
                if (node.type.name === "taskItem") { current = { blockId: node.attrs.id, checked: !!node.attrs.checked, task: node.attrs.trackedTask }; break; }
              }
            }
            if (previous === undefined || previous?.blockId !== current?.blockId ||
                previous?.checked !== current?.checked || previous?.task !== current?.task) {
              previous = current;
              post("taskState", current || {});
            }
            if (old && pluginKey.getState(view.state) !== pluginKey.getState(old)) {
              const before = new Map(taskIndex(old.doc).records
                .filter(({ node }) => node.attrs.trackedTask).map(({ node }) => [node.attrs.id, node]));
              let taskChanged = false;
              for (const { node } of taskIndex(view.state.doc).records) {
                if (!node.attrs.trackedTask) continue;
                const previous = before.get(node.attrs.id);
                if (!previous || previous.attrs.checked !== node.attrs.checked || previous.attrs.crossed !== node.attrs.crossed ||
                    (previous.attrs.trackedTask !== node.attrs.trackedTask &&
                      JSON.stringify(previous.attrs.trackedTask) !== JSON.stringify(node.attrs.trackedTask))) taskChanged = true;
                before.delete(node.attrs.id);
              }
              // Ordinary typing uses the debounced content channel, even in a task document.
              if (taskChanged || before.size) taskSnapshot(view.state.doc, post, canonicalize);
            }
          };
          update(view);
          return { update };
        },
      })];
    },
  });
}

export function taskCommand(editor, name, args, post, canonicalize) {
  if (name === "taskHistoryRefresh") {
    const incoming = args.document, projection = incoming?.attrs?.taskHistoryProjection;
    const current = editor.state.doc.attrs.taskHistoryProjection;
    if (!projection || current?.taskID !== projection.taskID) return false;
    const before = new Set(current.occurrences || []), after = new Set(projection.occurrences || []);
    const removed = new Set([...before].filter(id => !after.has(id)));
    const added = new Set([...after].filter(id => !before.has(id)));
    const tr = editor.state.tr;
    const positions = [];
    tr.doc.descendants((node, pos) => {
      if (node.type.name === "taskItem" && removed.has(node.attrs.id)) { positions.push({ pos, size: node.nodeSize }); return false; }
    });
    for (const { pos, size } of positions.reverse()) tr.deleteRange(pos, pos + size);
    for (const node of incoming.content || []) {
      if (node.type !== "taskList") continue;
      const items = (node.content || []).filter(item => added.has(item.attrs?.id));
      if (items.length) tr.insert(tr.doc.content.size, editor.schema.nodeFromJSON({ ...node, content: items }));
    }
    if (current.sourceTitle !== projection.sourceTitle || before.size !== after.size || [...before].some(id => !after.has(id))) {
      tr.setDocAttribute("taskHistoryProjection", projection);
    }
    if (tr.docChanged) {
      editor.view.dispatch(tr.setMeta("addToHistory", false));
      taskSnapshot(editor.state.doc, post, canonicalize);
    }
    return true;
  }
  if (!["taskConvert", "taskConfigure", "taskComplete", "taskRelease"].includes(name)) return null;
  if (!editor.isEditable && !(name === "taskComplete" && args.external)) return false;
  let target;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === "taskItem" && node.attrs.id === args.blockId) target = { node, pos }; });
  if (!target) return false;
  const attrs = { ...target.node.attrs }, current = attrs.trackedTask;
  if (name === "taskRelease") {
    const element = Array.from(editor.view.dom.querySelectorAll('[data-type="taskItem"]')).find(item => item.dataset.vellixBlockId === attrs.id);
    element?.dispatchEvent(new Event("vellix-task-release"));
    return true;
  }
  if (name === "taskConvert") {
    attrs.trackedTask = args.enabled ? (current || args.task) : null;
    editor.view.dispatch(closeHistory(editor.state.tr.setNodeMarkup(target.pos, undefined, attrs)));
  } else {
    if (!current || current.id !== args.taskID) return false;
    if (name === "taskComplete" && !args.external && current.occurrenceID !== args.expectedOccurrenceID) return false;
    const updated = name === "taskComplete" ? args.task : { ...current, ...args.configuration };
    const shared = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "taskItem" || node.attrs.trackedTask?.id !== args.taskID) return;
      const nextChecked = name === "taskComplete" ? args.checked : node.attrs.checked;
      const nextCrossed = name === "taskComplete" ? false : node.attrs.crossed;
      if (JSON.stringify(node.attrs.trackedTask) === JSON.stringify(updated) &&
          node.attrs.checked === nextChecked && node.attrs.crossed === nextCrossed) return;
      shared.setNodeMarkup(pos, undefined, {
        ...node.attrs, trackedTask: updated, checked: nextChecked, crossed: nextCrossed,
      });
    });
    if (shared.docChanged) editor.view.dispatch(closeHistory(shared));
  }
  if (name === "taskConvert" || name === "taskConfigure" || name === "taskComplete") {
    editor.view.dispatch(closeHistory(editor.state.tr));
    taskSnapshot(editor.state.doc, post, canonicalize);
  }
  return true;
}
