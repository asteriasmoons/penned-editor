// Give pasted blocks independent identities while keeping every visual attribute.
// References are remapped only when their targets belong to the copied tree.
export function freshClipboardBlockIDs(blocks, createID = () => crypto.randomUUID()) {
  const replacements = new Map();
  const clone = node => {
    const result = { ...node };
    if (node.attrs) {
      result.attrs = { ...node.attrs };
      if (typeof node.attrs.id === 'string' && node.attrs.id) {
        const replacement = createID();
        replacements.set(node.attrs.id, replacement);
        result.attrs.id = replacement;
      }
    }
    if (Array.isArray(node.content)) result.content = node.content.map(clone);
    return result;
  };
  // Deep-clone the entire document subtree first. In particular, rich-text
  // marks and calendar eventIdentity objects must not remain shared with the
  // original after a copy, paste, or duplicate operation.
  const copies = structuredClone(blocks).map(clone);
  const remap = node => {
    if (node.type === 'tabs' && typeof node.attrs?.activeTab === 'string' && replacements.has(node.attrs.activeTab)) {
      node.attrs.activeTab = replacements.get(node.attrs.activeTab);
    }
    for (const child of node.content || []) remap(child);
  };
  copies.forEach(remap);
  return copies;
}
