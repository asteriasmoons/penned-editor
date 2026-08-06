# Vellix TipTap Bundle

This package builds the static TipTap runtime shipped inside the Vellix app.

The shape intentionally follows Lurelia:

- `src/tiptap.html` is the WKWebView HTML shell.
- `src/editor.js` owns the TipTap schema, commands, callout node, and Swift bridge.
- `npm run build:render` writes `dist/tiptap.html` and `dist/tiptap.bundle.js`.
- `npm run build` also syncs those files into `../Vellix/Vellix/VellixEditor.bundle`.

Swift talks to the editor with:

```js
window.tiptapCommand(name, args)
```

The editor talks back with:

```js
webkit.messageHandlers.tiptap.postMessage({ kind, payload })
```
