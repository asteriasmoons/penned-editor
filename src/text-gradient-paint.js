// Shared text-gradient paint geometry for the editor and published reader.
((global) => {
  const doc = global.document;
  if (!doc || global.PennedTextGradientPainter) return;
  const attribute = 'data-vellix-gradient-paint';
  const properties = ['--vellix-text-gradients', '--vellix-text-gradient-sizes', '--vellix-text-gradient-positions'];
  const style = doc.createElement('style');
  style.textContent = [
    '[data-vellix-gradient-paint]{background-image:var(--vellix-text-gradients)!important;background-size:var(--vellix-text-gradient-sizes)!important;background-position:var(--vellix-text-gradient-positions)!important;background-repeat:no-repeat!important;background-origin:border-box!important;background-clip:text!important;-webkit-background-clip:text!important}',
    '[data-vellix-gradient-paint] span[data-vellix-gradient]{background-image:none!important}',
  ].join('\n');
  doc.head.appendChild(style);

  function gradient(span) {
    try {
      const value = JSON.parse(span.getAttribute('data-vellix-gradient'));
      if (!/^#[a-f\d]{6}$/i.test(value.start) || !/^#[a-f\d]{6}$/i.test(value.end) || !Number.isFinite(value.angle)) return null;
      return { start: value.start, end: value.end, angle: ((value.angle % 360) + 360) % 360 };
    } catch { return null; }
  }
  function clear(block) {
    block.removeAttribute(attribute);
    for (const name of properties) block.style.removeProperty(name);
  }
  function create(root) {
    let frame = 0, destroyed = false;
    const painted = new Set();
    function paint() {
      frame = 0;
      if (destroyed) return;
      const blocks = new Set();
      for (const span of root.querySelectorAll('span[data-vellix-gradient]')) {
        const block = span.closest('p,h1,h2,h3,h4,h5,h6,pre,figcaption');
        if (block && root.contains(block)) blocks.add(block);
      }
      for (const block of painted) if (!blocks.has(block)) { clear(block); painted.delete(block); }
      for (const block of blocks) {
        const bounds = block.getBoundingClientRect(), groups = [];
        if (!bounds.width || !bounds.height) { clear(block); continue; }
        const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let node, current = null;
        while ((node = walker.nextNode())) {
          if (!node.textContent) continue;
          const span = node.parentElement?.closest('span[data-vellix-gradient]');
          const value = span && block.contains(span) ? gradient(span) : null;
          if (!value) { current = null; continue; }
          const key = JSON.stringify(value);
          if (current?.key !== key) { current = { key, value, rects: [] }; groups.push(current); }
          const range = doc.createRange(); range.selectNodeContents(node);
          current.rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0.1 && rect.height > 0.1));
        }
        const images = [], sizes = [], positions = [];
        for (const group of groups) {
          if (!group.rects.length) continue;
          const left = Math.min(...group.rects.map(rect => rect.left)), right = Math.max(...group.rects.map(rect => rect.right));
          const top = Math.min(...group.rects.map(rect => rect.top)), bottom = Math.max(...group.rects.map(rect => rect.bottom));
          const radians = group.value.angle * Math.PI / 180, dx = Math.sin(radians), dy = -Math.cos(radians);
          const length = Math.abs(dx) * (right - left) + Math.abs(dy) * (bottom - top);
          const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
          for (const rect of group.rects) {
            const fragmentLength = Math.abs(dx) * rect.width + Math.abs(dy) * rect.height;
            if (fragmentLength <= 0) continue;
            // Crop the same two-dimensional gradient into each visual line/run.
            const offset = dx * (centerX - (rect.left + rect.right) / 2) + dy * (centerY - (rect.top + rect.bottom) / 2);
            const start = (offset - (length - fragmentLength) / 2) / fragmentLength;
            const end = start + length / fragmentLength;
            images.push('linear-gradient(' + group.value.angle + 'deg,' + group.value.start + ' ' + (start * 100).toFixed(4) + '%,' + group.value.end + ' ' + (end * 100).toFixed(4) + '%)');
            sizes.push(rect.width.toFixed(4) + 'px ' + rect.height.toFixed(4) + 'px');
            positions.push((rect.left - bounds.left).toFixed(4) + 'px ' + (rect.top - bounds.top).toFixed(4) + 'px');
          }
        }
        if (!images.length) { clear(block); painted.delete(block); continue; }
        block.style.setProperty(properties[0], images.join(','));
        block.style.setProperty(properties[1], sizes.join(','));
        block.style.setProperty(properties[2], positions.join(','));
        block.setAttribute(attribute, '');
        painted.add(block);
      }
    }
    function refresh() { if (!destroyed && !frame) frame = requestAnimationFrame(paint); }
    const resize = new ResizeObserver(refresh); resize.observe(root);
    const content = new MutationObserver(refresh);
    content.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
    const appearance = new MutationObserver(refresh);
    appearance.observe(doc.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    doc.fonts?.addEventListener('loadingdone', refresh);
    void doc.fonts?.ready.then(refresh);
    refresh();
    return { refresh, destroy() {
      destroyed = true; cancelAnimationFrame(frame);
      resize.disconnect(); content.disconnect(); appearance.disconnect();
      doc.fonts?.removeEventListener('loadingdone', refresh);
      for (const block of painted) clear(block);
      painted.clear();
    } };
  }
  function install() {
    const editor = doc.querySelector('.tiptap-editor')?.editor;
    if (!editor || editor.storage.pennedTextGradientPainter) return;
    const painter = create(editor.view.dom);
    editor.storage.pennedTextGradientPainter = painter;
    editor.on('update', painter.refresh);
    editor.on('destroy', () => { editor.off('update', painter.refresh); painter.destroy(); });
  }
  global.PennedTextGradientPainter = { create };
  install();
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install, { once: true });
})(globalThis);
