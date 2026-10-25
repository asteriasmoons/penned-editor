import { closeHistory } from "@tiptap/pm/history";

const protectedTypes = new Set(["table", "tableRow", "tableCell", "tableHeader", "collection", "pageReference"]);

function canRemove(block) {
  if (protectedTypes.has(block.type)) return false;
  let protectedContent = false;
  block.node.descendants(node => {
    if (protectedTypes.has(node.type.name)) protectedContent = true;
    return !protectedContent;
  });
  return !protectedContent;
}

// A request belongs to one immutable document, never whatever occupies the
// same position after an edit or a page switch.
export function createBlockActions({ editor, blocks, elementForBlock, selectionActive, post, snapshot }) {
  const root = editor.view.dom;
  const document = root.ownerDocument;
  const window = document.defaultView;
  let gesture = null;
  let request = null;
  let suppressedClick = null;
  const pointers = new Set();
  const enabled = () => editor.isEditable && !selectionActive();
  // While a long-press is being resolved (and while the delete request is up),
  // stop iOS from turning the hold into a caret / selection loupe / callout, which
  // is what was dropping the block into edit mode instead of deleting it.
  const suppressText = () => {
    root.style.webkitUserSelect = "none";
    root.style.userSelect = "none";
    root.style.webkitTouchCallout = "none";
  };
  const restoreText = () => {
    root.style.webkitUserSelect = "";
    root.style.userSelect = "";
    root.style.webkitTouchCallout = "";
  };
  const cancelHold = () => {
    if (gesture) window.clearTimeout(gesture.timer);
    gesture = null;
  };
  const reset = () => { cancelHold(); request = null; restoreText(); };
  const eligibleSurface = target => enabled() && target instanceof window.Element && root.contains(target) &&
    !target.closest("table, .tableWrapper, .penned-collection, .vellix-page-reference, .penned-attachment, input, textarea, select, a");
  const blockAt = target => {
    if (!eligibleSurface(target)) return null;
    return blocks().filter(canRemove).sort((a, b) => b.path.length - a.path.length).find(block => {
      const element = elementForBlock(block);
      return element && (element === target || element.contains(target));
    }) || null;
  };
  const present = (block, doc) => {
    if (!enabled() || editor.state.doc !== doc || request) return false;
    cancelHold();
    const token = window.crypto.randomUUID();
    request = { token, block, doc };
    suppressedClick = { element: elementForBlock(block), until: Infinity };
    suppressText();
    editor.commands.blur();
    window.getSelection()?.removeAllRanges();
    post("haptic", { style: "light" });
    post("blockActionsRequest", { token });
    return true;
  };
  // Width of the invisible right-hand handle gutter on each block. The long-press
  // to delete arms ONLY here, never over the block's text, so it can't fight editing.
  const HANDLE_ZONE = 44;
  document.addEventListener("pointerdown", event => {
    pointers.add(event.pointerId);
    cancelHold();
    request = null;
    if (pointers.size !== 1 || event.isPrimary === false || event.button !== 0) return;
    suppressedClick = null;
    const target = event.target;
    if (!eligibleSurface(target)) return;
    const block = blockAt(target);
    if (!block) return;
    const element = elementForBlock(block);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (event.clientX < rect.right - HANDLE_ZONE) return;
    const doc = editor.state.doc;
    gesture = { pointerID: event.pointerId, x: event.clientX, y: event.clientY,
      timer: window.setTimeout(() => {
        gesture = null;
        present(block, doc);
      }, 500) };
  }, { capture: true, passive: true });
  document.addEventListener("pointermove", event => {
    if (gesture && (event.pointerId !== gesture.pointerID ||
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10)) cancelHold();
  }, { capture: true, passive: true });
  for (const name of ["pointerup", "pointercancel"]) {
    document.addEventListener(name, event => {
      pointers.delete(event.pointerId);
      cancelHold();
      if (suppressedClick) suppressedClick.until = Date.now() + 600;
    }, { capture: true, passive: true });
  }
  document.addEventListener("scroll", cancelHold, { capture: true, passive: true });
  document.addEventListener("dragstart", cancelHold, true);
  document.addEventListener("keydown", cancelHold, true);
  window.addEventListener("blur", () => { pointers.clear(); cancelHold(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pointers.clear(); reset(); } });
  document.addEventListener("contextmenu", event => {
    const block = blockAt(event.target);
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    present(block, editor.state.doc);
  }, true);
  document.addEventListener("click", event => {
    if (!suppressedClick || Date.now() > suppressedClick.until) return;
    if (!suppressedClick.element?.contains(event.target)) return;
    suppressedClick = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  editor.on("transaction", ({ transaction }) => { if (transaction.docChanged) reset(); });

  return {
    reset,
    dismiss(token) {
      if (request?.token !== token) return false;
      request = null;
      restoreText();
      return true;
    },
    remove(token) {
      const pending = request;
      if (!pending || pending.token !== token) return false;
      request = null;
      restoreText();
      if (!enabled() || editor.state.doc !== pending.doc ||
          !canRemove(pending.block)) return false;
      const { block } = pending;
      let from = block.pos;
      let to = from + block.node.nodeSize;
      const $from = editor.state.doc.resolve(from);
      if (["bulletList", "orderedList", "taskList"].includes($from.parent.type.name) && $from.parent.childCount === 1) {
        // Remove an emptied list too, instead of leaving a phantom bullet.
        from = $from.before();
        to = $from.after();
      }
      const transaction = closeHistory(editor.state.tr).delete(from, to);
      if (!transaction.doc.childCount) transaction.insert(0, editor.schema.nodes.paragraph.create());
      editor.view.dispatch(transaction);
      editor.view.dispatch(closeHistory(editor.state.tr));
      post("snapshot", snapshot());
      return true;
    },
  };
}
