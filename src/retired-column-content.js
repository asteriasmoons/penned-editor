// Retain content from the retired column layout without retaining its UI/schema.
export function unwrapRetiredColumns(nodes) {
  return nodes.flatMap((node) => {
    if (node.type === "columns" || node.type === "column") {
      return unwrapRetiredColumns(node.content ?? []);
    }
    if (!Array.isArray(node.content)) return [node];
    const content = unwrapRetiredColumns(node.content);
    if (node.type === "plainCalloutRow" && !content.length) return [];
    return [{ ...node, content }];
  });
}
