import { Node, mergeAttributes } from "@tiptap/core";

export const Caption = Node.create({
  name: "caption",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "p[data-vellix-caption]", priority: 100 }, { tag: "figcaption", priority: 100 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes, {
      "data-vellix-caption": "",
      class: "vellix-caption",
      style: "font-size:12px;font-weight:400;line-height:1.5;color:color-mix(in srgb,var(--vellix-primary-text) 75%,transparent)",
    }), 0];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.isActive("caption")
        ? this.editor.chain().splitBlock().setParagraph().run() : false,
      Backspace: () => {
        const { selection } = this.editor.state;
        return selection.empty && selection.$from.parent.type.name === "caption" && selection.$from.parent.content.size === 0
          ? this.editor.commands.setParagraph() : false;
      },
    };
  },
});
