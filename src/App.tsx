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

/*
 Horizontal distance (in points) a finger must travel left across a block
 before that block is toggled into the selection.
*/
const SWIPE_TRIGGER_DISTANCE = -42;

/*
 The block visually follows the finger up to this far while dragging.
*/
const SWIPE_MAX_DRAG_DISTANCE = -58;

/*
 If the finger drifts vertically more than this, treat the gesture as a
 scroll / text interaction instead of a swipe-to-select.
*/
const SWIPE_VERTICAL_TOLERANCE = 54;

/*
 Once a horizontal-left drag passes this many points we treat the gesture as a
 swipe and capture the pointer, so the browser can no longer hand it to text
 selection or scrolling.
*/
const SWIPE_ACTIVATION_DISTANCE = -18;

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

interface SwipeState {
  blockId: string;
  x: number;
  y: number;
  block: HTMLElement;
  pointerId: number;
  lastDx: number;
  lastDyAbs: number;
  active: boolean;
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
  const swipeRef = useRef<SwipeState | null>(null);
  const focusTimerRef = useRef<number | undefined>(undefined);
  const hasReceivedAppearanceRef = useRef(false);
  const lastSelectionCountRef = useRef<number | undefined>(undefined);
  const reportHeightRef = useRef<(() => void) | null>(null);

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

    /*
     Reflect the current selection state into the DOM: selection-mode flags,
     per-block highlight classes, and notify native of the selected count.
    */
    function applySelectionState(): void {
      const outers = blockOuters();
      const inSelectionMode = selectionRef.current.size > 0;
      const authored = hasUserContent();

      document.documentElement.classList.toggle(
        "vellix-selection-mode",
        inSelectionMode,
      );
      document.body?.classList.toggle("vellix-selection-mode", inSelectionMode);
      document.documentElement.classList.toggle(
        "vellix-has-user-content",
        authored,
      );
      document.body?.classList.toggle("vellix-has-user-content", authored);

      outers.forEach((outer) => {
        const blockId = outer.dataset.id;
        const selected = blockId ? selectionRef.current.has(blockId) : false;

        outer.classList.toggle("vellix-selected-block", selected);
        outer.setAttribute("data-vellix-selected", selected ? "true" : "false");
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
     Native sizes its container to this value, so it must stop at the last
     meaningful block rather than the full viewport.
    */
    function reportContentHeight(): void {
      reinforceEditorAppearance();

      const page = document.querySelector<HTMLElement>(".vellix-editor-page");
      const editorEl = document.querySelector<HTMLElement>(".bn-editor");
      const outers = blockOuters();
      const authored = hasUserContent();

      const meaningful = outers.filter((outer) => {
        if (!authored) {
          return true;
        }
        const blockId = outer.dataset.id;
        const block = blockId ? editor.getBlock(blockId) : undefined;
        return !!(
          block &&
          (firstText([block]) ||
            block.type !== "paragraph" ||
            (Array.isArray(block.children) && block.children.length > 0))
        );
      });

      const measured = meaningful.length ? meaningful : outers;
      let height = 60;

      if (page && measured.length > 0) {
        const top = page.getBoundingClientRect().top;
        const bottom = Math.max(
          ...measured.map((el) => el.getBoundingClientRect().bottom),
        );
        height = Math.max(60, Math.ceil(bottom - top + 2));
      } else if (editorEl) {
        height = Math.max(
          60,
          Math.ceil(editorEl.getBoundingClientRect().height + 2),
        );
      }

      sendToNative("contentHeightChanged", { height });
      applySelectionState();
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
          editor.updateBlock(block, {
            type: "callout",
            props: { icon: "sparkle", color },
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

    // MARK: - Swipe-to-select gesture

    function clearDragVisual(): void {
      if (swipeRef.current?.block) {
        swipeRef.current.block.classList.remove("vellix-dragging-block");
        swipeRef.current.block.style.removeProperty("--vellix-drag-x");
      }
    }

    /*
     Swipe-to-select uses Pointer Events, not Touch Events. A horizontal drag
     over editable text competes with the browser's native text-selection
     gesture, which steals the touch stream (only the first move is delivered,
     no end fires). Pointer Events let us setPointerCapture once we recognise a
     left swipe, which hands the whole gesture to us so selection is reliable.
    */
    function onPointerDown(event: PointerEvent): void {
      if (event.pointerType !== "touch") {
        return;
      }
      const target = event.target as HTMLElement;
      if (
        target.closest?.(
          "button, input, textarea, select, a, [data-vellix-editor-control], .bn-toggle-button, .bn-toggle-add-block-button",
        )
      ) {
        return;
      }
      const block = target.closest?.(".bn-block-outer") as HTMLElement | null;
      if (!block) {
        return;
      }
      const blockId = block.dataset.id;
      if (!blockId || !editor.getBlock(blockId)) {
        return;
      }
      swipeRef.current = {
        blockId,
        x: event.clientX,
        y: event.clientY,
        block,
        pointerId: event.pointerId,
        lastDx: 0,
        lastDyAbs: 0,
        active: false,
      };
    }

    function onPointerMove(event: PointerEvent): void {
      const swipe = swipeRef.current;
      if (!swipe || event.pointerId !== swipe.pointerId) {
        return;
      }
      const dx = event.clientX - swipe.x;
      const dyAbs = Math.abs(event.clientY - swipe.y);
      const horizontalAbs = Math.abs(dx);
      swipe.lastDx = dx;
      swipe.lastDyAbs = dyAbs;

      if (!swipe.active && dyAbs > 8 && dyAbs > horizontalAbs) {
        clearDragVisual();
        swipeRef.current = null;
        return;
      }

      if (
        !swipe.active &&
        dx < SWIPE_ACTIVATION_DISTANCE &&
        dyAbs < SWIPE_VERTICAL_TOLERANCE &&
        horizontalAbs > dyAbs * 1.25
      ) {
        /*
         Clearly a left swipe now: capture the pointer so the browser can no
         longer hand it to text selection or scrolling. Vertical drags never
         reach here (touch-action: pan-y scrolls them natively), so scrolling
         still works.
        */
        swipe.active = true;
        try {
          swipe.block.setPointerCapture(swipe.pointerId);
        } catch {
          /* capture can fail if the pointer already ended */
        }
      }

      if (swipe.active) {
        event.preventDefault();
        event.stopPropagation();
      }

      if (dx < 0 && dyAbs < SWIPE_VERTICAL_TOLERANCE && horizontalAbs > dyAbs) {
        const offset = Math.max(SWIPE_MAX_DRAG_DISTANCE, Math.min(0, dx));
        swipe.block.classList.add("vellix-dragging-block");
        swipe.block.style.setProperty("--vellix-drag-x", `${offset}px`);
      }
    }

    function commitSwipe(dx: number, dyAbs: number, blockId: string): void {
      clearDragVisual();

      if (dx < SWIPE_TRIGGER_DISTANCE && dyAbs < SWIPE_VERTICAL_TOLERANCE) {
        if (selectionRef.current.has(blockId)) {
          selectionRef.current.delete(blockId);
        } else {
          selectionRef.current.add(blockId);
        }
        /*
         One quick native haptic per swipe-toggle. iOS WKWebView has no
         navigator.vibrate, so Swift fires the taptic engine for us.
        */
        sendToNative("requestHaptic", { style: "light" });
        if (selectionRef.current.size > 0) {
          blurEditor();
        }
        reportContentHeight();
      }
    }

    function onPointerUp(event: PointerEvent): void {
      const swipe = swipeRef.current;
      if (!swipe || event.pointerId !== swipe.pointerId) {
        return;
      }
      commitSwipe(
        event.clientX - swipe.x,
        Math.abs(event.clientY - swipe.y),
        swipe.blockId,
      );
      swipeRef.current = null;
    }

    /*
     If the gesture is cut short, still commit using the last movement we saw
     so an in-progress swipe selects rather than being silently dropped.
    */
    function onPointerCancel(event: PointerEvent): void {
      const swipe = swipeRef.current;
      if (!swipe || event.pointerId !== swipe.pointerId) {
        return;
      }
      commitSwipe(swipe.lastDx, swipe.lastDyAbs, swipe.blockId);
      swipeRef.current = null;
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
      }
    }

    function onFocusOut(): void {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = window.setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active?.closest?.(".bn-editor")) {
          sendToNative("editorFocusChanged", { focused: false });
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

    const resizeObserver = new ResizeObserver(() => reportContentHeight());
    resizeObserver.observe(document.documentElement);

    let appearanceFrame: number | undefined;
    function scheduleAppearanceReinforcement(): void {
      if (appearanceFrame !== undefined) {
        return;
      }

      appearanceFrame = requestAnimationFrame(() => {
        appearanceFrame = undefined;
        reinforceEditorAppearance();
      });
    }

    const mutationObserver = new MutationObserver(
      scheduleAppearanceReinforcement,
    );
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
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
            editor.replaceBlocks(
              editor.document,
              blocks as unknown as EditorInsertBlocks,
            );
            selectionRef.current.clear();
            reinforceEditorAppearance();
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
            const text = (message.payload?.text as string | undefined) || "Callout";
            const color = (message.payload?.color as string | undefined) || "#ffffff";
            const anchor =
              editor.getTextCursorPosition?.()?.block ??
              editor.document[editor.document.length - 1];
            const block: Record<string, unknown> = {
              type: "callout",
              props: {
                icon,
                color,
              },
              content: [
                {
                  type: "text",
                  text,
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
    reinforceEditorAppearance();

    return () => {
      delete window.receiveNativeMessage;
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
      window.clearTimeout(focusTimerRef.current);
      if (appearanceFrame !== undefined) {
        cancelAnimationFrame(appearanceFrame);
      }
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
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
