export async function prepareDocumentPresentation(root, document) {
  if (document.fonts?.ready) await document.fonts.ready;
  const top = root.getBoundingClientRect().top;
  const images = Array.from(document.images).filter(image => {
    const rect = image.getBoundingClientRect();
    return rect.bottom >= top && rect.top - top < 900;
  });
  await Promise.all(images.map(image => typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve()));
  // Hidden cached WebViews do not receive animation frames. The native host
  // confirms the rendered frame with takeSnapshot after this content check.
  return {
    nativeViews: Array.from(root.querySelectorAll("[data-native-collection-block]"))
      .map(host => ({ blockID: host.dataset.nativeCollectionBlock, viewID: host.dataset.nativeCollectionView })),
  };
}
