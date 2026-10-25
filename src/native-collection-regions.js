export function nativeCollectionRegions(root) {
  if (!root) return [];
  const origin = root.getBoundingClientRect();
  return Array.from(root.querySelectorAll("[data-native-collection]"))
    .filter(element => {
      const style = window.getComputedStyle(element);
      return element.dataset.nativeCollectionBlock && style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    })
    .map(element => {
      const rect = element.getBoundingClientRect();
      return {
        blockID: element.dataset.nativeCollectionBlock,
        collectionID: element.dataset.nativeCollection,
        x: Math.round(rect.left * 10) / 10,
        y: Math.max(0, Math.round((rect.top - origin.top) * 10) / 10),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };
    });
}
