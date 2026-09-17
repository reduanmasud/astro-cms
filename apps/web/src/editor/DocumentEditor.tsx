import {
  parseDocument,
  serializeDocument,
  type EditorDoc,
} from "@astro-cms/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  ApiError,
  getCollection,
  getDocument,
  getDrift,
  publishDocument,
  resyncDocument,
  saveDocument,
  uploadMedia,
  type CmsDocument,
  type DriftReport,
  type SchemaField,
} from "../api.ts";
import { ChevronLeftIcon, CloseIcon, CodeIcon, DetailsIcon } from "../Icons.tsx";
import { editorExtensions, toEditorContent } from "./extensions.ts";
import { useCollaboration, type CollabStatus } from "./useCollaboration.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import type { SlashMenuState } from "./SlashCommand.ts";
import { SelectionToolbar } from "./SelectionToolbar.tsx";
import { PublishReview } from "./PublishReview.tsx";
import { useAutosave } from "./useAutosave.ts";
import { FrontmatterFields } from "../frontmatter/FrontmatterFields.tsx";
import {
  parseFrontmatter,
  type FrontmatterDocument,
} from "../frontmatter/document.ts";

export interface DocumentEditorProps {
  documentId: string;
  /** Shown on this user's caret to other collaborators. */
  collaboratorName: string;
  onClose: () => void;
}

/**
 * Whether to edit frontmatter as YAML rather than through the schema's
 * controls. One preference for every document: someone who prefers YAML
 * prefers it everywhere, and per-document state would be a thing to explain.
 * It lives only in this browser and may be unavailable, so every access is
 * guarded and the controls are the default when it is.
 */
const YAML_MODE_KEY = "astro-cms:frontmatter-yaml";

function preferredYamlMode(): boolean {
  try {
    return localStorage.getItem(YAML_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberYamlMode(on: boolean): void {
  try {
    localStorage.setItem(YAML_MODE_KEY, String(on));
  } catch {
    // A private window, or site data blocked: the preference does not stick.
  }
}

interface Loaded {
  document: CmsDocument;
  doc: EditorDoc;
  frontmatter: string | null;
}

/** The file's own name when the schema has no usable "title" field yet. */
function fallbackTitle(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Editing one draft, focus-canvas style: the frontmatter form lives behind
 * "Details" until it's needed, formatting appears only on selection, and
 * publishing opens a review step instead of firing immediately (docs: UX
 * rethink, "Focus canvas" + "Publish as review" directions).
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
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DriftReport | null>(null);
  const [schema, setSchema] = useState<readonly SchemaField[] | null>(null);
  const [rawReason, setRawReason] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Gates the frontmatter section only — the body editor stays interactive
  // throughout. Until the collection request settles, `fmDoc` still holds
  // the frontmatter parsed from the *original* source, so the first control
  // edit would overwrite whatever was typed into the raw-textarea fallback
  // during that window (docs: see the effect below).
  const [collectionSettled, setCollectionSettled] = useState(false);
  // State, not a ref: the fallback below reads it during render, which the
  // React Compiler's ref rule forbids for a ref (react-hooks/refs).
  const [fmDoc, setFmDoc] = useState<FrontmatterDocument>();
  const [yamlMode, setYamlMode] = useState(preferredYamlMode);
  // Set when leaving YAML mode would need text that does not parse.
  const [yamlError, setYamlError] = useState<string>();
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
        const parsedFrontmatter = parseFrontmatter(parsed.frontmatter);
        setFmDoc(parsedFrontmatter);
        if (parsedFrontmatter === undefined) {
          setRawReason("This file's frontmatter is not valid YAML.");
        }
        setLoaded({
          document,
          doc: parsed.doc,
          frontmatter: parsed.frontmatter,
        });
      })
      .catch((caught: Error) => setError(caught.message));
  }, [documentId]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    getCollection(loaded.document.collection)
      .then(({ collection }) => {
        if (cancelled) return;
        if (collection.schema.inferred) setSchema(collection.schema.fields);
        else setRawReason(collection.schema.reason);
        setCollectionSettled(true);
      })
      .catch((caught: Error) => {
        if (cancelled) return;
        setRawReason(caught.message);
        setCollectionSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  // Esc closes the Details panel, matching its own visible "Esc" hint.
  useEffect(() => {
    if (!detailsOpen) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setDetailsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [detailsOpen]);

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
      extensions: editorExtensions({ onStateChange: setMenu }, shared, {
        upload: async (file) => (await uploadMedia(file)).media,
        onError: setError,
      }),
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

  async function publish(): Promise<void> {
    setPublishing(true);
    setError(undefined);
    try {
      // Save first, and wait for it: publishing a stale draft would publish
      // something the person is not looking at. `save` resolves once SQLite
      // has the current source; `autosave.saveNow` would not wait.
      await save();
      const result = await publishDocument(documentId);
      setConflict(null);
      setPublished(result.pullRequest.url);
      setReviewOpen(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "drift") {
        setConflict(await getDrift(documentId));
        setReviewOpen(false);
      } else {
        setError(
          caught instanceof Error ? caught.message : "Publishing failed.",
        );
      }
    } finally {
      setPublishing(false);
    }
  }

  async function resync(): Promise<void> {
    await resyncDocument(documentId);
    setConflict(null);
  }

  /**
   * Switches the frontmatter between the schema's controls and raw YAML.
   *
   * Going to YAML needs nothing: the controls already write what they produce
   * into `frontmatter`, so the textarea shows it. Coming back does, because
   * the text may have been edited since — it has to become a new document
   * before the controls can read it. Text that does not parse keeps you here,
   * which is what the whole-editor fallback does for the same reason.
   */
  function toggleYamlMode(): void {
    if (!yamlMode) {
      setYamlError(undefined);
      setYamlMode(true);
      rememberYamlMode(true);
      return;
    }
    const parsed = parseFrontmatter(frontmatter);
    if (parsed === undefined) {
      setYamlError(
        "This is not valid YAML yet, so the controls cannot read it.",
      );
      return;
    }
    setFmDoc(parsed);
    setYamlError(undefined);
    setYamlMode(false);
    rememberYamlMode(false);
  }

  function updateFrontmatter(value: string): void {
    setFrontmatter(value);
    // Any edit makes a "this is not valid YAML yet" complaint stale: it was
    // about text that no longer exists. The next toggle decides afresh.
    setYamlError(undefined);
    frontmatterRef.current =
      value === "" && loaded?.frontmatter === null ? null : value;
    autosave.schedule();
  }

  if (error !== undefined) {
    return (
      <main className="content">
        <p role="alert">{error}</p>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Back
        </button>
      </main>
    );
  }
  if (!loaded || !editor) return <main className="content">Loading…</main>;

  const title =
    (fmDoc?.get("title") as string | undefined) ??
    fallbackTitle(loaded.document.path);
  const stats = wordStats(editor);

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <div className="editor-topbar-left">
          <button
            type="button"
            className="icon-btn"
            aria-label="Back to collection"
            onClick={onClose}
          >
            <ChevronLeftIcon />
          </button>
          <span className="editor-breadcrumb">
            {loaded.document.collection}
            <span aria-hidden="true"> / </span>
            <strong>{title}</strong>
          </span>
        </div>
        <div className="editor-topbar-right">
          <CollabIndicator status={collaboration.status} />
          <SaveIndicator autosave={autosave} />
          <UndoRedo editor={editor} />
          <button
            type="button"
            className={detailsOpen ? "btn btn-secondary active" : "btn btn-secondary"}
            aria-expanded={detailsOpen}
            aria-controls="details-panel"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <DetailsIcon />
            Details
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setReviewOpen(true)}
          >
            Publish…
          </button>
        </div>
      </header>

      {conflict !== null && (
        <div role="alert" className="editor-conflict-bar">
          <span>
            <strong>This file changed in the repository.</strong> Re-sync to
            load the latest before you publish.
          </span>
          <button
            type="button"
            className="btn btn-warning"
            onClick={() => void resync()}
          >
            Re-sync
          </button>
        </div>
      )}

      {published !== null && (
        <div className="editor-conflict-bar editor-published-bar">
          <span>
            Published.{" "}
            <a href={published} target="_blank" rel="noreferrer">
              Open the pull request
            </a>
          </span>
        </div>
      )}

      <div className="editor-body">
        <main className="editor-main">
          <article className="editor-article">
            <div className="editor-title-block">
              <h1>{title}</h1>
              <div className="editor-meta">
                <span className="editor-meta-status">
                  <span
                    className={
                      loaded.document.status === "published"
                        ? "dot dot-published"
                        : "dot dot-draft"
                    }
                    aria-hidden="true"
                  />
                  {loaded.document.status === "published" ? "Published" : "Draft"}
                </span>
                <span className="hint">
                  {stats.words} word{stats.words === 1 ? "" : "s"} ·{" "}
                  {stats.minutes} min read
                </span>
                <button
                  type="button"
                  className="text-link"
                  aria-expanded={detailsOpen}
                  aria-controls="details-panel"
                  onClick={() => setDetailsOpen((open) => !open)}
                >
                  {detailsOpen ? "Hide details" : "Edit details"}
                </button>
              </div>
            </div>

            <div className="editor-canvas-wrap">
              <SelectionToolbar editor={editor} />
              <EditorContent editor={editor} className="editor" />
              <SlashMenu state={menu} />
            </div>
            <p className="hint">
              Type <code>/</code> for a heading, image, list or quote.
            </p>
          </article>
        </main>

        {detailsOpen && (
          <aside
            id="details-panel"
            aria-labelledby="details-title"
            className="details-panel"
          >
            <div className="details-header">
              <h2 id="details-title">Details</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close details"
                onClick={() => setDetailsOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="details-body">
              {!collectionSettled ? (
                <p className="hint">Loading…</p>
              ) : schema !== null && fmDoc !== undefined ? (
                yamlMode ? (
                  <textarea
                    value={frontmatter}
                    spellCheck={false}
                    rows={Math.min(16, frontmatter.split("\n").length + 1)}
                    onChange={(event) => updateFrontmatter(event.target.value)}
                    aria-label="Frontmatter"
                  />
                ) : (
                  <FrontmatterFields
                    schema={schema}
                    document={fmDoc}
                    onChange={() => {
                      // `fmDoc.toString()` returns YAML text, which correctly ends in
                      // a trailing newline. `frontmatterRef` instead holds frontmatter
                      // the way `splitFrontmatter` (packages/markdown/src/parse.ts)
                      // yields it, with that trailing newline already excluded, since
                      // `serializeDocument` (packages/markdown/src/serialize.ts) adds
                      // its own when writing the document back out. Strip exactly one
                      // trailing newline to bridge the two contracts, not all
                      // trailing whitespace: a blank line the user left inside their
                      // frontmatter is theirs to keep.
                      const raw = fmDoc.toString();
                      const next = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
                      frontmatterRef.current =
                        next === "" && loaded.frontmatter === null ? null : next;
                      setFrontmatter(next);
                      autosave.schedule();
                    }}
                  />
                )
              ) : (
                <>
                  {rawReason !== undefined && (
                    <p className="hint">{rawReason} Editing it as YAML instead.</p>
                  )}
                  <textarea
                    value={frontmatter}
                    spellCheck={false}
                    rows={Math.min(16, frontmatter.split("\n").length + 1)}
                    onChange={(event) => updateFrontmatter(event.target.value)}
                    aria-label="Frontmatter"
                  />
                </>
              )}
            </div>

            <div className="details-footer">
              <span className="hint">Saves with the entry</span>
              {collectionSettled && schema !== null && fmDoc !== undefined ? (
                <>
                  {yamlError !== undefined && (
                    <small className="hint" role="alert">
                      {yamlError}
                    </small>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={toggleYamlMode}
                  >
                    <CodeIcon />
                    {yamlMode ? "Edit with controls" : "Edit raw YAML"}
                  </button>
                </>
              ) : (
                collectionSettled && (
                  // No inferred schema (or unparsable frontmatter) means
                  // there is no "controls" mode to switch to — already
                  // editing raw YAML above, so say that plainly instead of
                  // just leaving the toggle silently absent.
                  <small className="hint">Editing as raw YAML — no form to switch to</small>
                )
              )}
            </div>
          </aside>
        )}
      </div>

      <footer className="editor-statusbar">
        <span className="mono">{loaded.document.path}</span>
      </footer>

      {reviewOpen && (
        <PublishReview
          document={loaded.document}
          editor={editor}
          schema={schema}
          fmDoc={fmDoc}
          title={title}
          publishing={publishing}
          onClose={() => setReviewOpen(false)}
          onPublish={publish}
        />
      )}
    </div>
  );
}

/**
 * Undo/redo apply to the whole document, not a selection, so — unlike Bold
 * or Link — they don't belong on the floating selection toolbar; they live
 * here instead, always reachable.
 */
function UndoRedo({
  editor,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
}): JSX.Element {
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) =>
      instance.isDestroyed
        ? { canUndo: false, canRedo: false }
        : { canUndo: instance.can().undo(), canRedo: instance.can().redo() },
  });
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Undo"
        title="Undo (⌘Z)"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        ↶
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Redo"
        title="Redo (⇧⌘Z)"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        ↷
      </button>
    </>
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

interface WordCountStats {
  words: number;
  minutes: number;
}

/**
 * Computed inline, on every render, rather than cached in state: an
 * autosave-triggered re-render happens on every keystroke anyway (`schedule`
 * always calls `setState`), so a fresh read here is never stale — no
 * subscription or effect needed, and no risk of showing a count from before
 * the editor's initial content had loaded.
 */
function wordStats(editor: NonNullable<ReturnType<typeof useEditor>>): WordCountStats {
  if (editor.isDestroyed) return { words: 0, minutes: 1 };
  const text = editor.getText().trim();
  const words = text === "" ? 0 : text.split(/\s+/).length;
  return { words, minutes: Math.max(1, Math.round(words / 200)) };
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
