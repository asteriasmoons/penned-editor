export async function prepareDocumentPresentation(root, document, diagnostic) {
  diagnostic?.("fonts-wait-start", { fontsLoading: document.fonts?.status === "loading" });
  if (document.fonts?.ready) await document.fonts.ready;
  diagnostic?.("fonts-wait-completed", { fontsLoading: document.fonts?.status === "loading" });
  const top = root.getBoundingClientRect().top;
  const images = Array.from(document.images).filter(image => {
    if (!root.contains(image) || !image.complete || !image.naturalWidth) return false;
    const rect = image.getBoundingClientRect();
    // Decode visible media that has arrived. An outstanding image download or
    // an inactive tab cannot own the document-opening request.
    return rect.width > 0 && rect.height > 0 && rect.bottom >= top && rect.top - top < 900 &&
      document.defaultView?.getComputedStyle(image).visibility !== "hidden";
  });
  diagnostic?.("image-decode-start", { count: images.length });
  await Promise.all(images.map(image => typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve()));
  diagnostic?.("image-decode-completed", { count: images.length });
  // Hidden cached WebViews do not receive animation frames. The native host
  // confirms the rendered frame with takeSnapshot after this content check.
  return {
    nativeViews: Array.from(root.querySelectorAll("[data-native-collection-block]"))
      .map(host => ({ blockID: host.dataset.nativeCollectionBlock, viewID: host.dataset.nativeCollectionView })),
  };
}
