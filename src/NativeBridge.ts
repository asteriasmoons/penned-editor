export type NativeMessagePayload = Record<string, unknown>;

export interface NativeMessage {
  version: 1;
  id: string;
  type: string;
  payload: NativeMessagePayload;
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        vellixEditor?: {
          postMessage: (message: NativeMessage) => void;
        };
      };
    };

    receiveNativeMessage?: (message: NativeMessage) => Promise<void>;
  }
}

function makeMessage(
  type: string,
  payload: NativeMessagePayload = {},
): NativeMessage {
  return {
    version: 1,
    id: crypto.randomUUID(),
    type,
    payload,
  };
}

function deliver(message: NativeMessage): void {
  const nativeHandler = window.webkit?.messageHandlers?.vellixEditor;

  if (nativeHandler) {
    nativeHandler.postMessage(message);
    return;
  }

  /*
   This is expected while testing in Chrome, Safari, or Vite.

   The native handler will only exist when the compiled editor is
   eventually opened inside the Vellix Swift app's WKWebView.
  */
  console.log("[Vellix Native Bridge]", message);
}

/*
 High-frequency, idempotent status messages. DOM observers (resize, mutation,
 selection, focus) can emit these many times per frame, and only the latest
 value in a frame is meaningful.

 This is the hard backstop that stops the WKWebView message queue from ever
 growing without bound: no matter which observer is the source of a burst,
 each of these types is delivered at most once per animation frame with only
 its newest value. A synchronous storm of thousands collapses to one post.

 Everything NOT in this set (documentChanged, editorReady, editorError,
 requestHaptic, requestCalloutIconPicker, selectedBlocksForSubpage,
 documentSnapshot) is delivered immediately and untouched.
*/
const COALESCED_TYPES = new Set<string>([
  "contentHeightChanged",
  "blockSelectionChanged",
  "editorFocusChanged",
]);

const pendingByType = new Map<string, NativeMessage>();
const lastSignatureByType = new Map<string, string>();
let flushHandle: number | undefined;

function flushPendingNativeMessages(): void {
  flushHandle = undefined;

  pendingByType.forEach((message, type) => {
    const signature = JSON.stringify(message.payload);

    /*
     Drop a status update identical to the one we last delivered, so a stuck
     observer that keeps re-reporting the same value stays completely silent.
    */
    if (lastSignatureByType.get(type) === signature) {
      return;
    }

    lastSignatureByType.set(type, signature);
    deliver(message);
  });

  pendingByType.clear();
}

export function sendToNative(
  type: string,
  payload: NativeMessagePayload = {},
): void {
  const message = makeMessage(type, payload);

  if (!COALESCED_TYPES.has(type)) {
    deliver(message);
    return;
  }

  pendingByType.set(type, message);

  if (flushHandle === undefined) {
    flushHandle =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(flushPendingNativeMessages)
        : (setTimeout(flushPendingNativeMessages, 16) as unknown as number);
  }
}
