export function createCaretTracking({ editor, post, reportHeight, selectionActive }) {
  let frame = null;
  let revision = 0;
  const report = () => {
    frame = null;
    if (editor.isDestroyed || !editor.isEditable || !editor.view.hasFocus() || selectionActive()) return;
    const selection = editor.state.selection;
    if (!selection.empty || !selection.$head.parent.isTextblock) return;
    // Resize the native editor surface before asking its scroll view to reveal the caret.
    reportHeight();
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
  const schedule = () => {
    if (frame === null && !editor.isDestroyed) frame = requestAnimationFrame(report);
  };
  editor.on("transaction", ({ transaction }) => {
    if (transaction.docChanged || transaction.selectionSet) schedule();
  });
  editor.on("focus", schedule);
  editor.on("destroy", () => { if (frame !== null) cancelAnimationFrame(frame); });
  return { schedule };
}
