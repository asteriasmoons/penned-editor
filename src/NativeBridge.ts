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

export function sendToNative(
  type: string,
  payload: NativeMessagePayload = {},
): void {
  const message = makeMessage(type, payload);

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
