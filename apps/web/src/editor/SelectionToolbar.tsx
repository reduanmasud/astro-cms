import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useState, type JSX, type MouseEvent } from "react";
import { LinkIcon, QuoteIcon } from "../Icons.tsx";

export interface SelectionToolbarProps {
  editor: Editor;
}

interface Position {
  top: number;
  left: number;
}

/** Prevents the button's mousedown from collapsing the editor's selection
    before the click handler runs — without this, every command below would
    apply to no selection at all. */
function keepSelection(event: MouseEvent): void {
  event.preventDefault();
}

/**
 * Formatting appears only when text is selected, positioned right above it —
 * block-level insertion (headings, lists, images, tables…) stays on the
 * existing "/" slash menu, which already covers it (docs: UX rethink,
 * "Focus canvas" direction).
 *
 * Position comes from the browser's own Selection API, not ProseMirror's
 * `coordsAtPos`: the latter can throw or miss updates around custom node
 * views (images, MDX blocks, tables), while `getBoundingClientRect()` on the
 * live selection range works for exactly whatever the user actually
 * selected, every time.
 */
export function SelectionToolbar({ editor }: SelectionToolbarProps): JSX.Element | null {
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    function update(): void {
      if (editor.isDestroyed || !editor.isEditable) {
        setPosition(null);
        return;
      }
      const selection = window.getSelection();
      if (
        selection === null ||
        selection.isCollapsed ||
        selection.rangeCount === 0 ||
        !editor.isFocused
      ) {
        setPosition(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPosition(null);
        return;
      }
      setPosition({ top: rect.top, left: rect.left + rect.width / 2 });
    }

    // Both sources matter: Tiptap's own events cover selection changes made
    // through its commands, and the native "selectionchange" event catches
    // every real way a person selects text (drag, double/triple-click,
    // shift+arrow) — whichever fires first hides or shows the toolbar.
    editor.on("selectionUpdate", update);
    editor.on("blur", update);
    document.addEventListener("selectionchange", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", update);
      document.removeEventListener("selectionchange", update);
    };
  }, [editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (instance.isDestroyed) {
        return {
          bold: false,
          italic: false,
          strike: false,
          code: false,
          link: false,
          heading2: false,
          blockquote: false,
        };
      }
      return {
        bold: instance.isActive("bold"),
        italic: instance.isActive("italic"),
        strike: instance.isActive("strike"),
        code: instance.isActive("code"),
        link: instance.isActive("link"),
        heading2: instance.isActive("heading", { level: 2 }),
        blockquote: instance.isActive("blockquote"),
      };
    },
  });

  function toggleLink(): void {
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL", previous ?? "https://");
    if (href === null) return;
    if (href === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  if (position === null) return null;

  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="Format selection"
      style={{ top: position.top, left: position.left }}
    >
      <button
        type="button"
        aria-label="Bold"
        aria-pressed={state.bold}
        className={state.bold ? "active" : undefined}
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </button>
      <button
        type="button"
        aria-label="Italic"
        aria-pressed={state.italic}
        className={state.italic ? "active" : undefined}
        style={{ fontStyle: "italic" }}
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </button>
      <button
        type="button"
        aria-label="Strikethrough"
        aria-pressed={state.strike}
        className={state.strike ? "active" : undefined}
        style={{ textDecoration: "line-through" }}
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        S
      </button>
      <button
        type="button"
        aria-label="Inline code"
        aria-pressed={state.code}
        className={state.code ? "active" : undefined}
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {"</>"}
      </button>
      <button
        type="button"
        aria-label="Link"
        aria-pressed={state.link}
        className={state.link ? "active" : undefined}
        onMouseDown={keepSelection}
        onClick={toggleLink}
      >
        <LinkIcon />
      </button>
      <span className="toolbar-separator" aria-hidden="true" />
      <button
        type="button"
        aria-label="Turn into heading"
        aria-pressed={state.heading2}
        className={state.heading2 ? "active" : undefined}
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <button
        type="button"
        aria-label="Turn into quote"
        aria-pressed={state.blockquote}
        className={state.blockquote ? "active" : undefined}
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <QuoteIcon />
      </button>
    </div>
  );
}
