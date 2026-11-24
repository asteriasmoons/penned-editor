// Keep non-editing interactions inside the block chrome, not the editor's
// caret, block-selection, drag, or context-menu handlers.
export const weekStripChromeEvent = type => /^(?:pointer|mouse|touch|click|dblclick|contextmenu)/.test(type);
export const linkedEventInteractionEvent = type => /^(?:pointer|mouse|touch|click|dblclick|contextmenu)/.test(type);
export const weekStripSettingsAllowed = editable => editable === true;
