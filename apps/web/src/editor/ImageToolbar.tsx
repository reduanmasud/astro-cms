import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useState, type JSX } from "react";

export interface ImageToolbarProps {
  editor: Editor;
}

interface Position {
  top: number;
  left: number;
}

/**
 * A small floating field under the selected image, for the one property
 * that matters most and has nowhere else to live: alt text. Appears only
 * while an image node is selected (docs: PublishReview already flags
 * images with none — this is where that gets fixed, not just reported).
 *
 * Position comes from the image element's own DOM rect, not ProseMirror's
 * `coordsAtPos`: images are atom nodes, and Tiptap already marks the
 * selected one with `.ProseMirror-selectednode`, so reading that element
 * directly is simpler and cannot drift out of sync with what is actually
 * on screen.
 */
export function ImageToolbar({
  editor,
}: ImageToolbarProps): JSX.Element | null {
  const [position, setPosition] = useState<Position | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (instance.isDestroyed || !instance.isActive("image")) {
        return { active: false, alt: "" };
      }
      const alt = instance.getAttributes("image").alt as string | undefined;
      return { active: true, alt: alt ?? "" };
    },
  });

  useEffect(() => {
    function update(): void {
      if (editor.isDestroyed || !state.active) {
        setPosition(null);
        return;
      }
      const node = editor.view.dom.querySelector<HTMLElement>(
        "img.ProseMirror-selectednode",
      );
      if (node === null) {
        setPosition(null);
        return;
      }
      const rect = node.getBoundingClientRect();
      setPosition({ top: rect.bottom + 8, left: rect.left });
    }

    update();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor, state.active]);

  if (position === null) return null;

  return (
    <div
      className="image-toolbar"
      style={{ top: position.top, left: position.left }}
    >
      <label>
        <span>Alt text</span>
        <input
          type="text"
          value={state.alt}
          placeholder="Describe this image for screen readers"
          onChange={(event) =>
            editor
              .chain()
              .updateAttributes("image", { alt: event.target.value })
              .run()
          }
        />
      </label>
    </div>
  );
}
