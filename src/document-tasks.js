import { Fragment, Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";

export function independentTask(task) {
  return task ? { ...task, id: crypto.randomUUID(), occurrenceID: crypto.randomUUID(), history: [] } : null;
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
        const context = () => ({ blockId: nodeID(current), checked: current.attrs.checked === true, task: current.attrs.trackedTask,
          text: Array.from(current.content.content).filter(child => child.type.name !== "taskList").map(child => child.textContent).join(" ").trim() });
        const openHistory = event => {
          event.preventDefault(); event.stopPropagation();
          if (!selectionActive() && current.attrs.trackedTask) post("pageOpenRequest", { documentId: "vellix-task-page:" + current.attrs.trackedTask.id });
        };
        const open = event => {
          event.preventDefault(); event.stopPropagation();
          if (selectionActive() || !editor.isEditable) return;
          const selection = editor.state.selection.$from;
          let selected = false;
          for (let depth = selection.depth; depth > 0; depth--) if (selection.node(depth).attrs.id === current.attrs.id) selected = true;
          if (!selected) editor.commands.setTextSelection(getPos() + 2);
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
        metadata.addEventListener("mousedown", keepSelection); metadata.addEventListener("click", open);
        history.addEventListener("mousedown", keepSelection); history.addEventListener("click", openHistory);
        const release = () => { awaitingCompletion = null; };
        li.addEventListener("vellix-task-release", release);
        render();
        return { dom: li, contentDOM,
          update(node) { if (node.type.name !== "taskItem") return false; current = node; render(); return true; },
          stopEvent(event) { return !selectionActive() && [label, metadata, history].some(element => element === event.target || element.contains(event.target)); },
          ignoreMutation(mutation) {
            return [label, metadata, history].some(element => element === mutation.target || element.contains(mutation.target))
              || (mutation.type === "attributes" && (mutation.target === li || mutation.target === container));
          },
          destroy() {
            if (pendingTap) clearTimeout(pendingTap.timer);
            label.removeEventListener("mousedown", keepSelection); label.removeEventListener("click", toggle);
            metadata.removeEventListener("mousedown", keepSelection); metadata.removeEventListener("click", open);
            history.removeEventListener("mousedown", keepSelection); history.removeEventListener("click", openHistory);
            li.removeEventListener("vellix-task-release", release);
          },
        };
      };
    },
  }).configure({ nested: true });
}

export function createTaskIntegration({ Extension, Plugin, PluginKey, post, selectionActive, canonicalize }) {
  return Extension.create({
    name: "vellixTrackedTasks",
    addGlobalAttributes() {
      return [{ types: ["doc"], attributes: { taskHistoryProjection: { default: null, rendered: false } } }];
    },
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey("vellixTrackedTasks"),
        props: {
          transformPasted(slice) {
            const copy = fragment => Fragment.fromArray(Array.from({ length: fragment.childCount }, (_, i) => {
              const node = fragment.child(i);
              if (node.isText) return node;
              const attrs = node.attrs.trackedTask ? { ...node.attrs, id: crypto.randomUUID(), trackedTask: independentTask(node.attrs.trackedTask) } : node.attrs;
              return node.type.create(attrs, copy(node.content), node.marks);
            }));
            return new Slice(copy(slice.content), slice.openStart, slice.openEnd);
          },
        },
        appendTransaction(transactions, old, state) {
          if (!transactions.some(tr => tr.docChanged)) return null;
          const seenBlocks = new Set(), seenTasks = new Set(), tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "taskItem") return;
            const attrs = { ...node.attrs };
            const blockID = typeof attrs.id === "string" ? attrs.id.trim() : "";
            // Formatting and Enter create checklist nodes without IDs. Repair the live
            // document before publishing selection state or targeting task commands.
            if (!blockID || seenBlocks.has(blockID)) attrs.id = crypto.randomUUID();
            else attrs.id = blockID;
            const task = node.attrs.trackedTask;
            if (task && seenTasks.has(task.id)) {
              attrs.id = crypto.randomUUID();
              attrs.trackedTask = independentTask(task);
            }
            seenBlocks.add(attrs.id);
            if (attrs.trackedTask) seenTasks.add(attrs.trackedTask.id);
            if (attrs.id !== node.attrs.id || attrs.trackedTask !== task) tr.setNodeMarkup(pos, undefined, attrs);
          });
          return tr.docChanged ? tr : null;
        },
        view(view) {
          let previous = "";
          const update = (view, old) => {
            let current = null;
            if (!selectionActive()) {
              for (let depth = view.state.selection.$from.depth; depth > 0; depth--) {
                const node = view.state.selection.$from.node(depth);
                if (node.type.name === "taskItem") { current = { blockId: node.attrs.id, checked: !!node.attrs.checked, task: node.attrs.trackedTask }; break; }
              }
            }
            const key = JSON.stringify(current);
            if (key !== previous) { previous = key; post("taskState", current || {}); }
            if (old && !view.state.doc.eq(old.doc)) {
              let hasTasks = false;
              view.state.doc.descendants(node => { if (node.attrs.trackedTask) hasTasks = true; });
              old.doc.descendants(node => { if (node.attrs.trackedTask) hasTasks = true; });
              if (hasTasks) post("taskSnapshot", { document: canonicalize(view.state.doc.toJSON()) });
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
      post("taskSnapshot", { document: canonicalize(editor.getJSON()) });
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
  } else {
    if (!current || current.id !== args.taskID) return false;
    if (name === "taskComplete") {
      if (!args.external && current.occurrenceID !== args.expectedOccurrenceID) return false;
      attrs.trackedTask = args.task; attrs.checked = args.checked;
      attrs.crossed = false;
    } else {
      attrs.trackedTask = { ...current, ...args.configuration };
    }
  }
  editor.view.dispatch(closeHistory(editor.state.tr.setNodeMarkup(target.pos, undefined, attrs)));
  editor.view.dispatch(closeHistory(editor.state.tr));
  post("taskSnapshot", { document: canonicalize(editor.getJSON()) });
  return true;
}
