import { useEditorState, type Editor } from "@tiptap/react";
import type { JSX } from "react";

export interface ToolbarProps {
  editor: Editor;
}

/** Formatting buttons. Every action also has a keyboard shortcut from Tiptap. */
export function Toolbar({ editor }: ToolbarProps): JSX.Element {
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive("bold"),
      italic: instance.isActive("italic"),
      strike: instance.isActive("strike"),
      code: instance.isActive("code"),
      link: instance.isActive("link"),
      heading2: instance.isActive("heading", { level: 2 }),
      bulletList: instance.isActive("bulletList"),
      orderedList: instance.isActive("orderedList"),
      blockquote: instance.isActive("blockquote"),
      codeBlock: instance.isActive("codeBlock"),
      canUndo: instance.can().undo(),
      canRedo: instance.can().redo(),
    }),
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

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Button
        label="Bold"
        shortcut="⌘B"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </Button>
      <Button
        label="Italic"
        shortcut="⌘I"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </Button>
      <Button
        label="Strikethrough"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        S
      </Button>
      <Button
        label="Inline code"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {"</>"}
      </Button>
      <Button label="Link" active={state.link} onClick={toggleLink}>
        🔗
      </Button>
      <span className="toolbar-gap" />
      <Button
        label="Heading 2"
        active={state.heading2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </Button>
      <Button
        label="Bullet list"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </Button>
      <Button
        label="Numbered list"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </Button>
      <Button
        label="Quote"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </Button>
      <Button
        label="Code block"
        active={state.codeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        {"{ }"}
      </Button>
      <Button
        label="Table"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        ▦
      </Button>
      <Button
        label="Divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        —
      </Button>
      <span className="toolbar-gap" />
      <Button
        label="Undo"
        shortcut="⌘Z"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        ↶
      </Button>
      <Button
        label="Redo"
        shortcut="⇧⌘Z"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        ↷
      </Button>
    </div>
  );
}

interface ButtonProps {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Button({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={active ? "active" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
