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
import { useCollaboration, type CollabStatus } from "./useCollaboration.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import type { SlashMenuState } from "./SlashCommand.ts";
import { Toolbar } from "./Toolbar.tsx";
import { useAutosave } from "./useAutosave.ts";

export interface DocumentEditorProps {
  documentId: string;
  /** Shown on this user's caret to other collaborators. */
  collaboratorName: string;
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
  collaboratorName,
  onClose,
}: DocumentEditorProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string>();
  const [frontmatter, setFrontmatter] = useState("");
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  // Keyed off state, never a ref: reading refs during render is not allowed.
  const collaboration = useCollaboration(documentId, loaded !== null);
  const seeded = useRef(false);

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

  const live =
    collaboration.status === "connected" || collaboration.status === "offline";
  const shared =
    collaboration.doc && collaboration.provider
      ? {
          doc: collaboration.doc,
          provider: collaboration.provider,
          user: { name: collaboratorName, color: colorFor(collaboratorName) },
        }
      : undefined;

  const editor = useEditor(
    {
      extensions: editorExtensions({ onStateChange: setMenu }, shared),
      // A room holds the text; otherwise the draft does.
      ...(shared ? {} : { content: toEditorContent(loaded?.doc ?? EMPTY_DOC) }),
      editable: loaded !== null,
      onUpdate: ({ editor: instance }) => {
        currentDoc.current = instance.getJSON() as EditorDoc;
        // With a room open, HocusPocus saves through the webhook instead.
        if (!live) autosave.schedule();
      },
    },
    [loaded, shared?.provider],
  );

  // The first client fills an empty room from the draft (ADR-0016).
  useEffect(() => {
    if (!editor || !loaded || !collaboration.synced || seeded.current) return;
    seeded.current = true;
    if (editor.isEmpty) editor.commands.setContent(toEditorContent(loaded.doc));
  }, [editor, loaded, collaboration.synced]);

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
        <CollabIndicator status={collaboration.status} />
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

const EMPTY_DOC: EditorDoc = { type: "doc", content: [] };
const CARET_COLORS = ["#2e7d32", "#1565c0", "#ad1457", "#ef6c00", "#6a1b9a"];

/** A stable colour per name, so a collaborator keeps the same caret colour. */
function colorFor(name: string): string {
  const sum = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
  return CARET_COLORS[sum % CARET_COLORS.length] ?? CARET_COLORS[0]!;
}

function CollabIndicator({
  status,
}: {
  status: CollabStatus;
}): JSX.Element | null {
  if (status === "disabled" || status === "checking") return null;
  const text = {
    connecting: "Connecting…",
    connected: "Live",
    offline: "Reconnecting…",
  }[status];
  return (
    <span
      className={status === "connected" ? "live-status" : "live-status pending"}
    >
      {text}
    </span>
  );
}
