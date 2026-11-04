export function calloutWidth(value) {
  const width = Number(value);
  return Number.isFinite(width) && width > 0 ? Math.max(1, Math.min(100, width)) : null;
}

export function calloutRowMetrics(nodes) {
  const children = Array.from(nodes);
  const specified = children.reduce((sum, child) => sum + (calloutWidth(child.attrs?.widthPercent) || 0), 0);
  const automatic = children.filter(child => !calloutWidth(child.attrs?.widthPercent)).length;
  const share = automatic ? Math.max(0, 100 - specified) / automatic : 0;
  const widths = children.map(child => calloutWidth(child.attrs?.widthPercent) || share || 100 / children.length);
  const remaining = automatic ? 0 : Math.max(0, 100 - specified);
  const cells = children.length + (remaining > 1 ? 1 : 0);
  return { widths, remaining, gapShare: cells ? 12 * (cells - 1) / cells : 0 };
}
