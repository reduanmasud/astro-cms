import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

export interface SlashCommandItem {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  /** Runs after the typed "/query" has been removed. */
  readonly run: (editor: Editor) => void;
}

export interface SlashMenuState {
  readonly items: readonly SlashCommandItem[];
  /** Where the "/" is on screen, for positioning the menu. */
  readonly rect: DOMRect | null;
  readonly select: (item: SlashCommandItem) => void;
}

export interface SlashCommandOptions {
  /** Called when the menu opens, moves, or closes (null closes it). */
  onStateChange: (state: SlashMenuState | null) => void;
}

/**
 * The commands the slash menu offers. Adding one here is enough: filtering,
 * the menu, and keyboard handling are shared.
 */
export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    id: "heading1",
    title: "Heading 1",
    hint: "#",
    run: (editor) =>
      void editor.chain().focus().setNode("heading", { level: 1 }).run(),
  },
  {
    id: "heading2",
    title: "Heading 2",
    hint: "##",
    run: (editor) =>
      void editor.chain().focus().setNode("heading", { level: 2 }).run(),
  },
  {
    id: "heading3",
    title: "Heading 3",
    hint: "###",
    run: (editor) =>
      void editor.chain().focus().setNode("heading", { level: 3 }).run(),
  },
  {
    id: "paragraph",
    title: "Text",
    hint: "Plain paragraph",
    run: (editor) => void editor.chain().focus().setParagraph().run(),
  },
  {
    id: "bulletList",
    title: "Bullet list",
    hint: "-",
    run: (editor) => void editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "orderedList",
    title: "Numbered list",
    hint: "1.",
    run: (editor) => void editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "blockquote",
    title: "Quote",
    hint: ">",
    run: (editor) => void editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "codeBlock",
    title: "Code block",
    hint: "```",
    run: (editor) => void editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "table",
    title: "Table",
    hint: "3 × 3 with header",
    run: (editor) =>
      void editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "horizontalRule",
    title: "Divider",
    hint: "---",
    run: (editor) => void editor.chain().focus().setHorizontalRule().run(),
  },
];

export function filterCommands(query: string): SlashCommandItem[] {
  const text = query.trim().toLowerCase();
  return text === ""
    ? [...SLASH_COMMANDS]
    : SLASH_COMMANDS.filter((item) => item.title.toLowerCase().includes(text));
}

/** Typing "/" opens a command menu. React renders the menu itself. */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onStateChange: () => undefined,
    };
  },

  addProseMirrorPlugins() {
    const { onStateChange } = this.options;

    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        items: ({ query }) => filterCommands(query),
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SlashCommandItem;
        }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => ({
          onStart: ({ items, clientRect, command }) => {
            onStateChange({
              items,
              rect: clientRect?.() ?? null,
              select: command,
            });
          },
          onUpdate: ({ items, clientRect, command }) => {
            onStateChange({
              items,
              rect: clientRect?.() ?? null,
              select: command,
            });
          },
          onKeyDown: ({ event }) => {
            // Escape closes; the React menu handles navigation keys itself.
            if (event.key === "Escape") {
              onStateChange(null);
              return true;
            }
            return false;
          },
          onExit: () => {
            onStateChange(null);
          },
        }),
      }),
    ];
  },
});
