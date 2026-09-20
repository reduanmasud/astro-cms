import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { resolveAssetSrc } from "./assetSrc.ts";

/**
 * The image node's `src` attribute stays exactly what was written in the
 * document — serializing back to Markdown must round-trip byte for byte.
 * Only the rendered <img> tag's `src` is resolved, so a path pointing at a
 * file already in the repository (not our own S3 media) actually displays.
 */
export function createDocumentImage(
  documentPath: string,
): ReturnType<typeof Image.extend> {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      const src = HTMLAttributes.src as unknown;
      return [
        "img",
        mergeAttributes(HTMLAttributes, {
          src:
            typeof src === "string" ? resolveAssetSrc(src, documentPath) : src,
        }),
      ];
    },
  });
}
