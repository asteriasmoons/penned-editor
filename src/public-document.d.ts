export interface ReaderOptions {
  mediaURL(id: string): string;
  iconURL(name: string): string | undefined;
  allowFollowLinkedContent?: boolean;
  publicationURL?: string;
}
export function renderPublicContent(document: { content: Record<string, unknown>; media: Array<{ id: string; name: string; mimeType: string; size: number }> }, options: ReaderOptions): {
  toc: Array<{ id: string; level: number; text: string }>;
  segments: string[];
};
export const documentFonts: Record<string, string>;
export function safePhoto(value: unknown): string | null;
export function validColor(value: unknown): string | null;
export function contrastColor(hex: unknown): string;
