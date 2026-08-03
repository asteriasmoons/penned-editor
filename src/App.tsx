import { useEffect, useRef } from "react";
import { BlockNoteView } from "@blocknote/ariakit";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/ariakit/style.css";

import { applyAppearance, reinforceEditorAppearance } from "./appearance";
import { calloutBlockSpec } from "./calloutBlock";
import { sendToNative } from "./NativeBridge";
import type { NativeMessage } from "./NativeBridge";

const SAVE_DELAY_MS = 500;

const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: calloutBlockSpec,
  },
});

type SelectedBlockType =
  | "bulletListItem"
  | "callout"
  | "checkListItem"
  | "heading"
  | "numberedListItem"
  | "paragraph"
  | "quote"
  | "toggleListItem";

type RawBlock = Record<string, unknown>;
type RawInlineContent = Array<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function textNode(text: string): Record<string, unknown> {
  return {
    type: "text",
    text,
    styles: {},
  };
}

function normalizeInlineContent(content: unknown): RawInlineContent {
  if (typeof content === "string") {
    return content.trim() ? [textNode(content)] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((node) => {
      if (!isRecord(node)) {
        return null;
      }

      if (node.type === "text") {
        return {
          type: "text",
          text: typeof node.text === "string" ? node.text : "",
          styles: isRecord(node.styles) ? node.styles : {},
        };
      }

      return node;
    })
    .filter((node): node is Record<string, unknown> => node !== null);
}

function blockText(block: RawBlock): string {
  return normalizeInlineContent(block.content)
    .map((node) => (typeof node.text === "string" ? node.text : ""))
    .join("");
}

function normalizeEditorBlock(value: unknown): RawBlock {
  if (!isRecord(value)) {
    return {
      type: "paragraph",
      props: {},
      content: [],
      children: [],
    };
  }

  const type = typeof value.type === "string" ? value.type : "paragraph";
  const props = isRecord(value.props) ? { ...value.props } : {};
  const children = Array.isArray(value.children)
    ? value.children.map(normalizeEditorBlock)
    : [];

  if (type === "callout") {
    return {
      ...value,
      type: "callout",
      props: {
        icon:
          typeof props.icon === "string" && props.icon.trim()
            ? props.icon.trim()
            : "sparkle",
        color:
          typeof props.color === "string" && props.color.trim()
            ? props.color.trim()
            : "#ffffff",
      },
      content: normalizeInlineContent(value.content),
      children,
    };
  }

  if (typeof value.type !== "string") {
    return {
      ...value,
      type: "paragraph",
      props,
      content: normalizeInlineContent(value.content),
      children,
    };
  }

  return {
    ...value,
    props,
    children,
  };
}

function normalizeEditorBlocks(blocks: unknown[]): RawBlock[] {
  return blocks.map(normalizeEditorBlock);
}

function App() {
  const editor = useCreateBlockNote({
    schema: editorSchema,
  });

  type EditorBlock = (typeof editor.document)[number];
  type EditorPartialBlock = Parameters<typeof editor.updateBlock>[1];
  type EditorInsertBlocks = Parameters<typeof editor.insertBlocks>[0];

  const saveTimerRef = useRef<number | undefined>(undefined);
  const selectionRef = useRef<Set<string>>(new Set());
  const focusTimerRef = useRef<number | undefined>(undefined);
  const hasReceivedAppearanceRef = useRef(false);
  const lastSelectionCountRef = useRef<number | undefined>(undefined);
  const reportHeightRef = useRef<(() => void) | null>(null);
  const lastReportedHeightRef = useRef<number>(-1);

  useEffect(() => {
    /*
     The list of on-screen block wrappers, in document order.

     BlockNote nests indented blocks inside child block groups, so this must be
     a flat DOM query by block id rather than direct top-level children.
    */
    function blockOuters(): HTMLElement[] {
      const ids = new Set(documentBlocks().map((block) => block.id));

      return Array.from(
        document.querySelectorAll<HTMLElement>(
          '.bn-editor .bn-block-outer[data-id]',
        ),
      ).filter((outer) => ids.has(outer.dataset.id ?? ""));
    }

    function documentBlocks(): EditorBlock[] {
      const flattened: EditorBlock[] = [];

      function visit(blocks: readonly EditorBlock[] | undefined): void {
        blocks?.forEach((block) => {
          flattened.push(block);
          visit(block.children as readonly EditorBlock[] | undefined);
        });
      }

      visit(editor.document);
      return flattened;
    }

    /*
     Recursively find the first non-empty run of text inside a block tree.
     Used for subpage titles and clipboard fallbacks.
    */
    function firstText(nodes: unknown): string {
      if (!Array.isArray(nodes) || !nodes.length) {
        return "";
      }

      for (const node of nodes as Array<Record<string, unknown>>) {
        if (
          node.type === "text" &&
          typeof node.text === "string" &&
          node.text.trim()
        ) {
          return node.text.trim();
        }

        if (Array.isArray(node.content)) {
          const found = firstText(node.content);
          if (found) {
            return found;
          }
        }

        if (Array.isArray(node.children)) {
          const found = firstText(node.children);
          if (found) {
            return found;
          }
        }
      }

      return "";
    }

    /*
     True when the document contains anything the user has actually authored
     (text, a non-paragraph block, or nested children) rather than a single
     empty starter paragraph.
    */
    function hasUserContent(): boolean {
      return (
        Array.isArray(editor.document) &&
        editor.document.some(
          (block) =>
            !!(
              block &&
              (firstText([block]) ||
                block.type !== "paragraph" ||
                (Array.isArray(block.children) && block.children.length > 0))
            ),
        )
      );
    }

    function editorHasFocus(): boolean {
      const active = document.activeElement as HTMLElement | null;
      return !!active?.closest?.(".bn-editor");
    }

    function setEditorClassState(): void {
      const focused = editorHasFocus();
      const authored = hasUserContent();

      document.documentElement.classList.toggle(
        "vellix-editor-focused",
        focused,
      );
      document.body?.classList.toggle("vellix-editor-focused", focused);
      document.documentElement.classList.toggle(
        "vellix-has-user-content",
        authored,
      );
      document.body?.classList.toggle("vellix-has-user-content", authored);
    }

    function toggleBlockSelection(blockId: string): void {
      if (!editor.getBlock(blockId)) {
        return;
      }

      if (selectionRef.current.has(blockId)) {
        selectionRef.current.delete(blockId);
      } else {
        selectionRef.current.add(blockId);
      }

      if (selectionRef.current.size > 0) {
        blurEditor();
      }

      applySelectionState();
      sendToNative("requestHaptic", { style: "light" });
    }

    /*
     Reflect the current selection state into the DOM: selection-mode flags,
     per-block highlight classes, and notify native of the selected count.
    */
    function applySelectionState(): void {
      const outers = blockOuters();
      const inSelectionMode = selectionRef.current.size > 0;
      setEditorClassState();
      editor.isEditable = !inSelectionMode;

      document.documentElement.classList.toggle(
        "vellix-selection-mode",
        inSelectionMode,
      );
      document.body?.classList.toggle("vellix-selection-mode", inSelectionMode);

      outers.forEach((outer) => {
        const blockId = outer.dataset.id;
        const selected = blockId ? selectionRef.current.has(blockId) : false;
        const selectedValue = selected ? "true" : "false";

        outer.classList.toggle("vellix-selected-block", selected);
        if (outer.getAttribute("data-vellix-selected") !== selectedValue) {
          outer.setAttribute("data-vellix-selected", selectedValue);
        }
        outer
          .querySelectorAll(
            ":scope .bn-block-content, :scope .react-renderer > .bn-block-content",
          )
          .forEach((content) =>
            content.classList.remove("vellix-selected-content"),
          );
      });

      if (lastSelectionCountRef.current !== selectionRef.current.size) {
        lastSelectionCountRef.current = selectionRef.current.size;
        sendToNative("blockSelectionChanged", {
          count: selectionRef.current.size,
        });
      }
    }

    /*
     Measure the true height of the authored content and report it to native.
     Native sizes its container to this value, so measure visible block boxes
     without mutating selection state during the measurement pass.
    */
    function reportContentHeight(): void {
      reinforceEditorAppearance();
      setEditorClassState();

      const page = document.querySelector<HTMLElement>(".vellix-editor-page");
      const outers = blockOuters();
      const measured = outers.filter((outer) => {
        const style = window.getComputedStyle(outer);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          outer.getClientRects().length > 0
        );
      });
      let height = 60;

      if (page && measured.length > 0) {
        const top = page.getBoundingClientRect().top;
        const bottom = Math.max(
          ...measured.map((el) => el.getBoundingClientRect().bottom),
        );
        height = Math.max(60, Math.ceil(bottom - top + 2));
      }

      /*
       Only notify native when the measured height actually changes. Native
       sizes its container to this value, which resizes the web view and fires
       our ResizeObserver again; without this guard the two sides ping-pong
       every frame and flood the bridge until WebKit kills the web process.
      */
      if (Math.abs(height - lastReportedHeightRef.current) > 1) {
        lastReportedHeightRef.current = height;
        sendToNative("contentHeightChanged", { height });
      }
    }

    reportHeightRef.current = reportContentHeight;

    /*
     BlockNote, WKWebView, and web fonts can settle over a few frames. Native
     uses these reports to size the SwiftUI wrapper, so send one immediately and
     then repeat after layout/font resolution instead of waiting for one delayed
     measurement.
    */
    function runSettledContentHeightReports(): void {
      reportContentHeight();

      requestAnimationFrame(() => {
        reportContentHeight();
        requestAnimationFrame(reportContentHeight);
      });

      window.setTimeout(reportContentHeight, 40);
      window.setTimeout(reportContentHeight, 120);

      void document.fonts?.ready
        ?.then(() => {
          reportContentHeight();
          window.setTimeout(reportContentHeight, 40);
        })
        .catch(() => {
          /* Font readiness is best-effort in embedded web views. */
        });
    }

    function scheduleContentHeightReports(
      options: { waitForInitialAppearance?: boolean } = {},
    ): void {
      if (
        options.waitForInitialAppearance &&
        !hasReceivedAppearanceRef.current
      ) {
        window.setTimeout(runSettledContentHeightReports, 24);
        return;
      }

      runSettledContentHeightReports();
    }

    /*
     The selected blocks in document order, or null (with an error) if the
     selection is empty.
    */
    function selectedBlocks(): EditorBlock[] | null {
      const blocks = documentBlocks().filter((block) =>
        selectionRef.current.has(block.id),
      );

      if (!blocks.length) {
        sendToNative("editorError", {
          message: "Select at least one block first.",
        });
        return null;
      }

      return blocks;
    }

    function sendDocumentChanged(): void {
      window.setTimeout(reportContentHeight, 40);
      sendToNative("documentChanged", { blocks: editor.document });
    }

    function selectedBlockUpdate(
      type: SelectedBlockType,
      payload: Record<string, unknown>,
    ): EditorPartialBlock {
      switch (type) {
        case "heading": {
          const level =
            typeof payload.level === "number" && payload.level >= 1
              ? Math.min(6, Math.floor(payload.level))
              : 3;
          return { type: "heading", props: { level } } as EditorPartialBlock;
        }
        case "callout": {
          return {
            type: "callout",
            props: {
              icon:
                typeof payload.icon === "string" && payload.icon.trim()
                  ? payload.icon.trim()
                  : "sparkle",
              color:
                typeof payload.color === "string" && payload.color.trim()
                  ? payload.color.trim()
                  : "#ffffff",
            },
          } as unknown as EditorPartialBlock;
        }
        case "checkListItem":
          return {
            type: "checkListItem",
            props: { checked: false },
          } as EditorPartialBlock;
        default:
          return { type, props: {} } as EditorPartialBlock;
      }
    }

    function transformSelectedBlocks(
      type: SelectedBlockType,
      payload: Record<string, unknown> = {},
    ): void {
      const blocks = selectedBlocks();
      if (!blocks) {
        return;
      }

      try {
        const update = selectedBlockUpdate(type, payload);
        blocks.forEach((block) => {
          editor.updateBlock(block, update);
        });
        sendDocumentChanged();
      } catch (error) {
        sendToNative("editorError", {
          message:
            error instanceof Error
              ? error.message
              : "Could not update selected blocks.",
        });
      }
    }

    function updateSelectedCalloutColor(color: string): void {
      const blocks = selectedBlocks();
      if (!blocks) {
        return;
      }

      blocks.forEach((block) => {
        if (block.type === "callout") {
          editor.updateBlock(block, {
            props: { color },
          } as EditorPartialBlock);
        } else {
          const text = blockText(block as unknown as RawBlock);
          editor.updateBlock(block, {
            type: "callout",
            props: { icon: "sparkle", color },
            content: normalizeInlineContent(text),
          } as unknown as EditorPartialBlock);
        }
      });
      sendDocumentChanged();
    }

    function updateCalloutIcon(blockId: string | undefined, icon: string): void {
      const trimmedIcon = icon.trim() || "sparkle";

      if (blockId) {
        const block = editor.getBlock(blockId);
        if (block?.type === "callout") {
          editor.updateBlock(block, {
            props: { icon: trimmedIcon },
          } as EditorPartialBlock);
          sendDocumentChanged();
          return;
        }
      }

      const blocks = selectedBlocks();
      if (!blocks) {
        return;
      }

      blocks.forEach((block) => {
        if (block.type === "callout") {
          editor.updateBlock(block, {
            props: { icon: trimmedIcon },
          } as EditorPartialBlock);
        }
      });
      sendDocumentChanged();
    }

    function moveSelectedBlocks(direction: "in" | "out"): void {
      const blocks = selectedBlocks();
      if (!blocks) {
        return;
      }

      const orderedBlocks = direction === "in" ? blocks : [...blocks].reverse();

      orderedBlocks.forEach((block) => {
        editor.setTextCursorPosition(block, "start");
        if (direction === "in") {
          if (editor.canNestBlock()) {
            editor.nestBlock();
          }
        } else if (editor.canUnnestBlock()) {
          editor.unnestBlock();
        }
      });

      selectionRef.current.clear();
      applySelectionState();
      sendDocumentChanged();
    }

    function blurEditor(): void {
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === "function") {
        active.blur();
      }
      sendToNative("editorFocusChanged", { focused: false });
    }

    function clearSelection(): void {
      selectionRef.current.clear();
      applySelectionState();
    }

    function selectAll(): void {
      selectionRef.current = new Set(documentBlocks().map((block) => block.id));
      blurEditor();
      applySelectionState();
    }

    function requestSubpage(): void {
      const blocks = selectedBlocks();
      if (!blocks) {
        return;
      }
      const title = firstText(blocks) || "New Sub Page";
      sendToNative("selectedBlocksForSubpage", { title, blocks });
    }

    function deleteSelected(): void {
      const blocks = selectedBlocks();

      if (!blocks?.length) {
        return;
      }

      try {
        if (typeof editor.removeBlocks === "function") {
          editor.removeBlocks(blocks);
        } else {
          editor.replaceBlocks(blocks, []);
        }
        selectionRef.current.clear();
        applySelectionState();
        reportContentHeight();
        sendToNative("documentChanged", { blocks: editor.document });
      } catch (error) {
        sendToNative("editorError", {
          message:
            error instanceof Error
              ? error.message
              : "Could not delete selected blocks.",
        });
      }
    }

    function clone<T>(value: T): T {
      return typeof structuredClone === "function"
        ? structuredClone(value)
        : (JSON.parse(JSON.stringify(value)) as T);
    }

    function reassignIds(block: Record<string, unknown>): Record<string, unknown> {
      block.id = crypto.randomUUID();
      if (Array.isArray(block.children)) {
        block.children.forEach((child) =>
          reassignIds(child as Record<string, unknown>),
        );
      }
      return block;
    }

    function duplicateSelected(): void {
      const blocks = selectedBlocks();
      if (!blocks?.length) {
        return;
      }

      const copies = blocks.map((block) =>
        reassignIds(clone(block) as Record<string, unknown>),
      );

      const anchor = blocks[blocks.length - 1];
      if (!anchor || !copies.length) {
        return;
      }

      try {
        editor.insertBlocks(copies as unknown as EditorInsertBlocks, anchor, "after");
        selectionRef.current.clear();
        window.setTimeout(reportContentHeight, 40);
        sendToNative("documentChanged", { blocks: editor.document });
      } catch (error) {
        sendToNative("editorError", {
          message:
            error instanceof Error
              ? error.message
              : "Could not duplicate selected blocks.",
        });
      }
    }

    async function copySelected(): Promise<void> {
      const blocks = selectedBlocks();
      if (!blocks) {
        return;
      }
      const text = firstText(blocks) || JSON.stringify(blocks);
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        /* clipboard may be unavailable */
      }
    }

    async function cutSelected(): Promise<void> {
      await copySelected();
      deleteSelected();
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as HTMLElement;
      const block = target.closest?.(".bn-block-outer") as HTMLElement | null;

      if (block) {
        const blockId = block.dataset.id;
        const callout = target.closest?.(".vellix-callout") as HTMLElement | null;
        const editorBlock = blockId ? editor.getBlock(blockId) : undefined;

        if (callout && editorBlock?.type === "callout") {
          const rect = callout.getBoundingClientRect();
          const inIconHitArea =
            event.clientX >= rect.left &&
            event.clientX <= rect.left + 58 &&
            event.clientY >= rect.top &&
            event.clientY <= rect.top + 58;

          if (inIconHitArea) {
            event.preventDefault();
            event.stopPropagation();
            sendToNative("requestCalloutIconPicker", {
              blockId,
              icon:
                typeof editorBlock.props.icon === "string" &&
                editorBlock.props.icon.trim()
                  ? editorBlock.props.icon.trim()
                  : "sparkle",
            });
            return;
          }
        }
      }

      if (
        target.closest?.(
          "button, input, textarea, select, a, [data-vellix-editor-control], .bn-toggle-button, .bn-toggle-add-block-button",
        )
      ) {
        return;
      }

      if (!block) {
        return;
      }
      const blockId = block.dataset.id;
      if (!blockId || !editor.getBlock(blockId)) {
        return;
      }

      const rect = block.getBoundingClientRect();
      const inSelectionRail =
        event.clientX >= rect.right - 44 && event.clientX <= rect.right + 12;
      if (!inSelectionRail) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      toggleBlockSelection(blockId);
    }

    function onFocusIn(event: FocusEvent): void {
      const target = event.target as HTMLElement;
      if (target.closest?.(".bn-editor")) {
        window.clearTimeout(focusTimerRef.current);
        if (selectionRef.current.size > 0) {
          blurEditor();
          return;
        }
        if (selectionRef.current.size === 0) {
          sendToNative("editorFocusChanged", { focused: true });
        }
        setEditorClassState();
        window.setTimeout(reportContentHeight, 40);
      }
    }

    function onFocusOut(): void {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = window.setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active?.closest?.(".bn-editor")) {
          setEditorClassState();
          sendToNative("editorFocusChanged", { focused: false });
          window.setTimeout(reportContentHeight, 40);
        }
      }, 80);
    }

    function isEditorEditEvent(event: Event): boolean {
      const target = event.target as HTMLElement | null;
      return !!target?.closest?.(".bn-editor") && selectionRef.current.size > 0;
    }

    function blockEditingWhileSelecting(event: Event): void {
      if (!isEditorEditEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      blurEditor();
    }

    /*
     Coalesce resize bursts into a single measurement per frame. ResizeObserver
     can fire several times synchronously and reportContentHeight forces a
     layout on every call, so batching avoids a resize storm.
    */
    let resizeFrame: number | undefined;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== undefined) {
        return;
      }
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        reportContentHeight();
      });
    });
    resizeObserver.observe(document.documentElement);

    let syncFrame: number | undefined;
    function scheduleEditorDOMSync(): void {
      if (syncFrame !== undefined) {
        return;
      }

      syncFrame = requestAnimationFrame(() => {
        syncFrame = undefined;
        reinforceEditorAppearance();
        applySelectionState();
        reportContentHeight();
      });
    }

    const mutationObserver = new MutationObserver(
      scheduleEditorDOMSync,
    );
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("beforeinput", blockEditingWhileSelecting, true);
    document.addEventListener("keydown", blockEditingWhileSelecting, true);
    document.addEventListener("paste", blockEditingWhileSelecting, true);

    /*
     Swift calls this to send commands into the editor.
    */
    window.receiveNativeMessage = async (
      message: NativeMessage,
    ): Promise<void> => {
      try {
        switch (message.type) {
          case "loadDocument": {
            const blocks = message.payload.blocks;
            if (!Array.isArray(blocks)) {
              throw new Error("loadDocument requires a blocks array.");
            }
            const normalizedBlocks = normalizeEditorBlocks(blocks);
            editor.replaceBlocks(
              editor.document,
              normalizedBlocks as unknown as EditorInsertBlocks,
            );
            selectionRef.current.clear();
            reinforceEditorAppearance();
            applySelectionState();
            scheduleContentHeightReports({ waitForInitialAppearance: true });
            break;
          }

          case "setEditable": {
            const editable = message.payload.editable;
            if (typeof editable !== "boolean") {
              throw new Error("setEditable requires a boolean editable value.");
            }
            editor.isEditable = editable;
            break;
          }

          case "focusEditor": {
            if (selectionRef.current.size === 0) {
              editor.focus();
            }
            break;
          }

          case "undo": {
            editor.undo();
            window.setTimeout(reportContentHeight, 40);
            break;
          }

          case "redo": {
            editor.redo();
            window.setTimeout(reportContentHeight, 40);
            break;
          }

          case "setAppearance": {
            const payload = (message.payload ?? {}) as Record<string, unknown>;
            hasReceivedAppearanceRef.current = true;
            applyAppearance(payload);
            reinforceEditorAppearance();
            scheduleContentHeightReports();
            break;
          }

          case "insertDivider": {
            const dividerStyle =
              (message.payload?.style as string | undefined) || "thinLine";
            const anchor =
              editor.getTextCursorPosition?.()?.block ??
              editor.document[editor.document.length - 1];
            const block: Record<string, unknown> =
              dividerStyle === "thinLine" || dividerStyle === "thickLine"
                ? { type: "divider", props: {}, content: [], children: [] }
                : {
                    type: "paragraph",
                    props: {
                      textColor: "default",
                      backgroundColor: "default",
                      textAlignment: "center",
                    },
                    content: [
                      {
                        type: "text",
                        text:
                          dividerStyle === "fourDots"
                            ? "••••"
                            : "· · · · · · · · · · · · ·",
                        styles: {},
                      },
                    ],
                    children: [],
                  };
            const [inserted] = editor.insertBlocks(
              [block] as unknown as EditorInsertBlocks,
              anchor,
              "after",
            );
            if (inserted) {
              editor.setTextCursorPosition?.(inserted, "end");
            }
            window.setTimeout(reportContentHeight, 40);
            sendToNative("documentChanged", { blocks: editor.document });
            break;
          }

          case "insertPageBreak": {
            const anchor =
              editor.getTextCursorPosition?.()?.block ??
              editor.document[editor.document.length - 1];
            try {
              const [inserted] = editor.insertBlocks(
                [
                  {
                    type: "pageBreak",
                    props: {},
                    content: [],
                    children: [],
                  },
                ] as unknown as EditorInsertBlocks,
                anchor,
                "after",
              );
              if (inserted) {
                editor.setTextCursorPosition?.(inserted, "end");
              }
            } catch {
              const [fallback] = editor.insertBlocks(
                [
                  {
                    type: "divider",
                    props: {},
                    content: [],
                    children: [],
                  },
                ] as unknown as EditorInsertBlocks,
                anchor,
                "after",
              );
              if (fallback) {
                editor.setTextCursorPosition?.(fallback, "end");
              }
            }
            window.setTimeout(reportContentHeight, 40);
            sendToNative("documentChanged", { blocks: editor.document });
            break;
          }

          case "insertCallout": {
            const icon = (message.payload?.icon as string | undefined) || "sparkle";
            const text = (message.payload?.text as string | undefined) || "";
            const color = (message.payload?.color as string | undefined) || "#ffffff";
            const anchor =
              editor.getTextCursorPosition?.()?.block ??
              editor.document[editor.document.length - 1];
            const content = text.trim()
              ? [
                  {
                    type: "text",
                    text,
                    styles: {},
                  },
                ]
              : [];
            const block: Record<string, unknown> = {
              type: "callout",
              props: {
                icon,
                color,
              },
              content,
              children: [],
            };
            const [inserted] = editor.insertBlocks(
              [normalizeEditorBlock(block)] as unknown as EditorInsertBlocks,
              anchor,
              "after",
            );
            if (inserted) {
              editor.setTextCursorPosition?.(inserted, "end");
            }
            window.setTimeout(reportContentHeight, 40);
            sendToNative("documentChanged", { blocks: editor.document });
            break;
          }

          case "setSelectedBlockType": {
            const blockType = message.payload?.blockType;
            if (typeof blockType !== "string") {
              throw new Error("setSelectedBlockType requires a blockType.");
            }
            transformSelectedBlocks(
              blockType as SelectedBlockType,
              message.payload ?? {},
            );
            break;
          }

          case "indentSelectedBlocks": {
            moveSelectedBlocks("in");
            break;
          }

          case "outdentSelectedBlocks": {
            moveSelectedBlocks("out");
            break;
          }

          case "setSelectedCalloutColor": {
            const color = message.payload?.color;
            if (typeof color !== "string") {
              throw new Error("setSelectedCalloutColor requires a color.");
            }
            updateSelectedCalloutColor(color);
            break;
          }

          case "updateCalloutIcon": {
            const icon = message.payload?.icon;
            const blockId = message.payload?.blockId;
            if (typeof icon !== "string") {
              throw new Error("updateCalloutIcon requires an icon.");
            }
            updateCalloutIcon(
              typeof blockId === "string" ? blockId : undefined,
              icon,
            );
            break;
          }

          case "selectAllBlocks": {
            selectAll();
            break;
          }

          case "clearBlockSelection": {
            clearSelection();
            break;
          }

          case "deleteSelectedBlocks": {
            deleteSelected();
            break;
          }

          case "copySelectedBlocks": {
            await copySelected();
            break;
          }

          case "cutSelectedBlocks": {
            await cutSelected();
            break;
          }

          case "duplicateSelectedBlocks": {
            duplicateSelected();
            break;
          }

          case "requestSelectedBlocksForSubpage": {
            requestSubpage();
            break;
          }

          case "requestSnapshot": {
            sendToNative("documentSnapshot", { blocks: editor.document });
            break;
          }

          default: {
            console.warn(`[Vellix] Unknown native command: ${message.type}`);
          }
        }
      } catch (error) {
        sendToNative("editorError", {
          command: message.type,
          message:
            error instanceof Error
              ? error.message
              : "An unknown editor error occurred.",
        });
      }
    };

    sendToNative("editorReady", {
      blockCount: editor.document.length,
    });

    /*
     Report the real height as early as possible (next frame) so native can
     hand off from its instant-preview placeholder quickly, then again after
     layout settles.
    */
    scheduleContentHeightReports();
    applySelectionState();
    reinforceEditorAppearance();

    return () => {
      delete window.receiveNativeMessage;
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
      window.clearTimeout(focusTimerRef.current);
      if (syncFrame !== undefined) {
        cancelAnimationFrame(syncFrame);
      }
      if (resizeFrame !== undefined) {
        cancelAnimationFrame(resizeFrame);
      }
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener(
        "beforeinput",
        blockEditingWhileSelecting,
        true,
      );
      document.removeEventListener("keydown", blockEditingWhileSelecting, true);
      document.removeEventListener("paste", blockEditingWhileSelecting, true);
    };
  }, [editor]);

  function handleEditorChange(): void {
    /*
     Wait until the user pauses typing before sending the document to Swift.
    */
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      reportHeightRef.current?.();
      sendToNative("documentChanged", {
        blocks: editor.document,
      });
    }, SAVE_DELAY_MS);
  }

  return (
    <main className="vellix-editor-shell">
      <div className="vellix-editor-page">
        <BlockNoteView editor={editor} onChange={handleEditorChange} theme="dark" />
      </div>
    </main>
  );
}

export default App;
