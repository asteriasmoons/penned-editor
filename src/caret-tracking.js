export function createCaretTracking({ editor, post, reportHeight, selectionActive }) {
  let frame = null;
  let revision = 0;
  let heightDirty = false;
  const report = timestamp => {
    frame = null;
    if (editor.isDestroyed || !editor.isEditable || !editor.view.hasFocus() || selectionActive()) { heightDirty = false; return; }
    const selection = editor.state.selection;
    if (!selection.empty || !selection.$head.parent.isTextblock) { heightDirty = false; return; }
    // Only remeasure the native editor surface when the document actually changed.
    // A pure caret move cannot change content height, so forcing a full-document
    // layout for it (a getBoundingClientRect sweep over all content plus the
    // page-break regions) is wasted work — the dominant editing cost on long docs.
    if (heightDirty) { heightDirty = false; reportHeight(timestamp); }
    const coordinates = editor.view.coordsAtPos(selection.head);
    if (![coordinates.left, coordinates.right, coordinates.top, coordinates.bottom].every(Number.isFinite)) return;
    post("caret", {
      x: coordinates.left + window.scrollX,
      y: coordinates.top + window.scrollY,
      width: Math.max(1, coordinates.right - coordinates.left),
      height: Math.max(1, coordinates.bottom - coordinates.top),
      revision: ++revision,
    });
  };
  const schedule = (remeasureHeight = true) => {
    if (remeasureHeight) heightDirty = true;
    if (frame === null && !editor.isDestroyed) frame = requestAnimationFrame(report);
  };
  editor.on("transaction", ({ transaction }) => {
    // A document change can move content, so it needs a height remeasure; a
    // selection-only change cannot, so it just moves the caret without one.
    if (transaction.docChanged || transaction.selectionSet) schedule(transaction.docChanged);
  });
  editor.on("focus", schedule);
  editor.on("destroy", () => { if (frame !== null) cancelAnimationFrame(frame); });
  return { schedule };
}
