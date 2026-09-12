import {
  parseDocument,
  serializeDocument,
  type EditorDoc,
} from "@astro-cms/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  ApiError,
  getDocument,
  saveDocument,
  type CmsDocument,
} from "../api.ts";
import { editorExtensions, toEditorContent } from "./extensions.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import type { SlashMenuState } from "./SlashCommand.ts";
import { Toolbar } from "./Toolbar.tsx";
import { useAutosave } from "./useAutosave.ts";

export interface DocumentEditorProps {
  documentId: string;
  onClose: () => void;
}

interface Loaded {
  document: CmsDocument;
  doc: EditorDoc;
  frontmatter: string | null;
}

/**
 * Editing one draft: Tiptap for the body, a raw YAML box for frontmatter
 * (docs/adr/0007-frontmatter-schema-inference.md), and autosave to SQLite.
 */
export function DocumentEditor({
  documentId,
  onClose,
}: DocumentEditorProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string>();
  const [frontmatter, setFrontmatter] = useState("");
  const [menu, setMenu] = useState<SlashMenuState | null>(null);

  const revision = useRef(0);
  const saved = useRef("");
  const currentDoc = useRef<EditorDoc | null>(null);
  const frontmatterRef = useRef<string | null>(null);

  useEffect(() => {
    getDocument(documentId)
      .then(({ document }) => {
        const parsed = parseDocument(document.source, document.format);
        revision.current = document.revision;
        saved.current = document.source;
        currentDoc.current = parsed.doc;
        frontmatterRef.current = parsed.frontmatter;
        setFrontmatter(parsed.frontmatter ?? "");
        setLoaded({
          document,
          doc: parsed.doc,
          frontmatter: parsed.frontmatter,
        });
      })
      .catch((caught: Error) => setError(caught.message));
  }, [documentId]);

  const save = useCallback(async () => {
    const doc = currentDoc.current;
    if (!loaded || !doc) return;
    const source = serializeDocument(
      { frontmatter: frontmatterRef.current, doc },
      loaded.document.format,
    );
    if (source === saved.current) return;

    try {
      const { document } = await saveDocument(loaded.document.id, {
        source,
        expectedRevision: revision.current,
      });
      revision.current = document.revision;
      saved.current = document.source;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "conflict") {
        throw new Error(
          "Someone else saved this document. Reload to continue.",
          {
            cause: caught,
          },
        );
      }
      throw caught;
    }
  }, [loaded]);

  const autosave = useAutosave(save);

  const editor = useEditor(
    {
      extensions: editorExtensions({ onStateChange: setMenu }),
      content: toEditorContent(loaded?.doc ?? { type: "doc", content: [] }),
      editable: loaded !== null,
      onUpdate: ({ editor: instance }) => {
        currentDoc.current = instance.getJSON() as EditorDoc;
        autosave.schedule();
      },
    },
    [loaded],
  );

  function updateFrontmatter(value: string): void {
    setFrontmatter(value);
    frontmatterRef.current =
      value === "" && loaded?.frontmatter === null ? null : value;
    autosave.schedule();
  }

  if (error !== undefined) {
    return (
      <main className="content">
        <p role="alert">{error}</p>
        <button type="button" onClick={onClose}>
          Back
        </button>
      </main>
    );
  }
  if (!loaded || !editor) return <main className="content">Loading…</main>;

  return (
    <main className="content editor-page">
      <header className="editor-header">
        <button type="button" onClick={onClose}>
          ← Back
        </button>
        <div>
          <strong>{loaded.document.path}</strong>
          <span className="hint">
            {loaded.document.collection} · {loaded.document.format} ·{" "}
            {loaded.document.status}
          </span>
        </div>
        <span className="spacer" />
        <SaveIndicator autosave={autosave} />
        <button type="button" onClick={autosave.saveNow}>
          Save now
        </button>
      </header>

      <details className="frontmatter" open={frontmatter !== ""}>
        <summary>Frontmatter (YAML)</summary>
        <textarea
          value={frontmatter}
          spellCheck={false}
          rows={Math.min(12, frontmatter.split("\n").length + 1)}
          onChange={(event) => updateFrontmatter(event.target.value)}
          aria-label="Frontmatter"
        />
      </details>

      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="editor" />
      <SlashMenu state={menu} />
      <p className="hint">
        Type <code>/</code> for blocks. Markdown shortcuts such as{" "}
        <code># </code>, <code>- </code> and <code>```</code> work while typing.
      </p>
    </main>
  );
}

function SaveIndicator({
  autosave,
}: {
  autosave: ReturnType<typeof useAutosave>;
}): JSX.Element {
  const { status, message } = autosave.state;
  const text = {
    idle: "No changes",
    pending: "Unsaved changes…",
    saving: "Saving…",
    saved: "Saved",
    error: message ?? "Save failed",
  }[status];

  return (
    <span
      className={status === "error" ? "save-status fail" : "save-status"}
      role="status"
    >
      {text}
    </span>
  );
}
