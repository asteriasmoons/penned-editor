// Consume direct touches on editor chrome before WebKit can focus the text host.
// Touch activation is explicit because cancelling touchstart suppresses click.
export function bindNonEditingTap(element, activate, enabled, { hold, holdMS = 550 } = {}) {
  let touch = null;
  let suppressClickUntil = 0;
  const cancel = () => {
    clearTimeout(touch?.timer);
    touch = null;
  };
  const preventFocus = event => {
    if (!enabled()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener("pointerdown", preventFocus);
  element.addEventListener("mousedown", preventFocus);
  element.addEventListener("touchstart", event => {
    cancel();
    if (!enabled() || event.touches.length !== 1) return;
    const point = event.touches[0];
    touch = { id: point.identifier, x: point.clientX, y: point.clientY };
    preventFocus(event);
    if (hold && window.PennedBlockDragAndDrop?.allowBlockHold(event, "editor-control-hold") !== false) {
      const contact = touch;
      contact.timer = setTimeout(() => {
        if (touch === contact && element.isConnected && enabled() && hold(event) !== false) contact.held = true;
      }, holdMS);
    }
  }, { passive: false });
  const matches = point => point && touch && point.identifier === touch.id &&
    Math.hypot(point.clientX - touch.x, point.clientY - touch.y) <= 10;
  element.addEventListener("touchmove", event => {
    if (event.touches.length !== 1 || !matches(event.touches[0])) cancel();
  }, { passive: true });
  element.addEventListener("touchcancel", cancel);
  element.addEventListener("touchend", event => {
    const tapped = Array.from(event.changedTouches).some(matches);
    const held = touch?.held;
    cancel();
    if (!tapped || !enabled()) return;
    suppressClickUntil = performance.now() + 450;
    if (!held) activate(event);
    else preventFocus(event);
  }, { passive: false });
  element.addEventListener("click", event => {
    if (event.sourceCapabilities?.firesTouchEvents && performance.now() < suppressClickUntil) {
      preventFocus(event);
      return;
    }
    activate(event);
  });
  return cancel;
}
