import { Extension } from "@tiptap/core";
import { joinBackward, joinTextblockBackward, lift, selectNodeBackward } from "@tiptap/pm/commands";
import { Plugin } from "@tiptap/pm/state";

function emptyNumberedListTail(state) {
  const { empty, $from } = state.selection;
  if (!empty || $from.depth < 3 || $from.parent.type.name !== "paragraph" || $from.parent.content.size) return false;
  const item = $from.node(-1), list = $from.node(-2);
  return item.type.name === "listItem" && list.type.name === "orderedList" &&
    $from.index(-1) === item.childCount - 1 && $from.index(-2) === list.childCount - 1;
}

function numberedCalloutBoundary(state) {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code || $from.parentOffset !== 0) return null;
  let calloutDepth = 0, list = null;
  for (let depth = $from.depth - 1; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (!calloutDepth && ["callout", "plainCallout"].includes(name)) calloutDepth = depth;
    if (!list && ["orderedList", "bulletList", "taskList"].includes(name)) list = { name, depth };
  }
  if (!calloutDepth || (list && list.depth > calloutDepth && list.name !== "orderedList")) return null;
  const followsList = state.doc.resolve($from.before()).nodeBefore?.type.name === "orderedList";
  if (list?.name !== "orderedList" && !followsList) return null;
  return { joinTextblocks: followsList || (list && list.depth > calloutDepth && $from.index(list.depth) > 0) };
}

export function createCalloutListBackspace({ selectionActive }) {
  return Extension.create({
    name: "pennedCalloutListBackspace",
    priority: 110,
    addProseMirrorPlugins() {
      const editor = this.editor;
      const backspace = () => {
        if (!editor.isEditable || editor.view.composing || selectionActive()) return false;
        const exitList = emptyNumberedListTail(editor.state);
        const boundary = numberedCalloutBoundary(editor.state);
        if (!exitList && !boundary) return false;
        if (editor.commands.undoInputRule()) return true;
        // Use the model's logical boundary, not transient WebKit DOM geometry.
        // These standard commands respect isolation and map the caret with the edit.
        const dispatch = tr => editor.view.dispatch(tr);
        // A blank trailing line exits the list instead of joining its last item.
        // Lift the paragraph, not the whole item, so existing numbered text stays put.
        if (exitList) return lift(editor.state, dispatch);
        if (boundary.joinTextblocks && joinTextblockBackward(editor.state, dispatch)) return true;
        if (joinBackward(editor.state, dispatch)) return true;
        selectNodeBackward(editor.state, dispatch);
        // Do not fall through to the list keymap's lift/cut cycle at this boundary.
        return true;
      };
      return [new Plugin({
        props: {
          handleKeyDown(_view, event) {
            if (event.defaultPrevented || event.key !== "Backspace" || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false;
            return backspace();
          },
          handleDOMEvents: {
            beforeinput(_view, event) {
              if (event.defaultPrevented || event.inputType !== "deleteContentBackward" || event.isComposing || !event.cancelable) return false;
              if (!backspace()) return false;
              event.preventDefault();
              return true;
            },
          },
        },
      })];
    },
  });
}
