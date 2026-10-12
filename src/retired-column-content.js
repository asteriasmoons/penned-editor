// Retain content from the retired column layout without retaining its UI/schema.
export function unwrapRetiredColumns(nodes) {
  return nodes.flatMap((node) => {
    if (node.type === "columns" || node.type === "column") {
      return unwrapRetiredColumns(node.content ?? []);
    }
    return Array.isArray(node.content)
      ? [{ ...node, content: unwrapRetiredColumns(node.content) }]
      : [node];
  });
}
