// Adjacent circles meet at their outside intersection. The corner circles
// use the longer arc, turning the perimeter without stretching any scallop.
function scallopedPath(width, height, fontSize) {
  const radius = Math.min(fontSize * 0.34, Math.min(width, height) / 5);
  const corners = [[radius, radius], [width - radius, radius],
    [width - radius, height - radius], [radius, height - radius]];
  const centers = corners.flatMap(([x, y], i) => {
    const [nextX, nextY] = corners[(i + 1) % 4];
    const length = Math.hypot(nextX - x, nextY - y);
    const count = Math.max(1, Math.round(length / (1.72 * radius)), Math.ceil(length / (1.9 * radius)));
    return Array.from({ length: count }, (_, j) => [
      x + (nextX - x) * j / count, y + (nextY - y) * j / count,
    ]);
  });
  const joints = centers.map(([x, y], i) => {
    const [nextX, nextY] = centers[(i + 1) % centers.length];
    const dx = nextX - x, dy = nextY - y, distance = Math.hypot(dx, dy);
    const offset = Math.sqrt(radius ** 2 - (distance / 2) ** 2) / distance;
    return [(x + nextX) / 2 + dy * offset, (y + nextY) / 2 - dx * offset];
  });
  let start = joints.at(-1);
  let path = `M ${start.join(" ")}`;
  for (const [i, [x, y]] of centers.entries()) {
    const end = joints[i];
    const sweep = (Math.atan2(end[1] - y, end[0] - x) - Math.atan2(start[1] - y, start[0] - x) + 2 * Math.PI) % (2 * Math.PI);
    path += ` A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${end.join(" ")}`;
    start = end;
  }
  return path + " Z";
}

export const measuredLabelShape = shape => ["scalloped", "plaque", "banner"].includes(shape);

// Keep the end caps proportional to the type and height, not the label's length.
function decorativeLabelPath(shape, w, h, fontSize) {
  if (shape === "banner") {
    const notch = Math.min(fontSize * 0.66, w * 0.20, h * 0.34);
    return `M 0 0 L ${w} 0 L ${w - notch} ${h / 2} L ${w} ${h} L 0 ${h} L ${notch} ${h / 2} Z`;
  }
  const cap = Math.min(fontSize * 0.42, w * 0.19, h * 0.16);
  const shoulder = cap * 1.58;
  const step = h * 0.12, join = h * 0.26;
  const halfChord = h / 2 - join;
  const radius = (halfChord * halfChord + cap * cap) / (2 * cap);
  return [
    `M ${shoulder} 0 H ${w - shoulder} V ${step} H ${w - cap} V ${join}`,
    `A ${radius} ${radius} 0 0 1 ${w - cap} ${h - join}`,
    `V ${h - step} H ${w - shoulder} V ${h} H ${shoulder} V ${h - step} H ${cap} V ${h - join}`,
    `A ${radius} ${radius} 0 0 1 ${cap} ${join} V ${step} H ${shoulder} Z`,
  ].join(" ");
}

/** @param {Element} tile */
export function paintLabelPerimeter(tile) {
  const surface = tile.querySelector(":scope > .penned-label-path-surface");
  const stroke = tile.querySelector(":scope > .penned-label-path-frame > path");
  const shape = tile.parentElement?.dataset.labelShape;
  const style = tile.ownerDocument.defaultView.getComputedStyle(tile);
  const width = parseFloat(style.width), height = parseFloat(style.height), fontSize = parseFloat(style.fontSize);
  if (!surface || !stroke || !measuredLabelShape(shape) ||
      ![width, height, fontSize].every(value => Number.isFinite(value) && value > 0)) return;
  const path = shape === "scalloped" ? scallopedPath(width, height, fontSize) : decorativeLabelPath(shape, width, height, fontSize);
  if (stroke.getAttribute("d") === path) return;
  surface.setAttribute("style", `clip-path:path('${path}')`);
  stroke.setAttribute("d", path);
}

const tileSelector = "[data-label-perimeter] > .penned-label-tile";

/** @param {Element} root */
export function repaintScallopedLabels(root) {
  for (const tile of root.querySelectorAll(tileSelector)) paintLabelPerimeter(tile);
}

/** @param {Element} root */
export function observeScallopedLabels(root) {
  const Observer = root.ownerDocument.defaultView.ResizeObserver;
  if (!Observer) {
    repaintScallopedLabels(root);
    return () => {};
  }
  const observer = new Observer(entries => {
    for (const { target } of entries) paintLabelPerimeter(target);
  });
  for (const tile of root.querySelectorAll(tileSelector)) {
    paintLabelPerimeter(tile);
    observer.observe(tile, { box: "border-box" });
  }
  return () => observer.disconnect();
}
