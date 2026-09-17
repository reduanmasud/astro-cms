import { parseDocument, type EditorDoc, type EditorNode } from "@astro-cms/markdown";
import type { Editor } from "@tiptap/react";
import { useEffect, useState, type JSX } from "react";
import { getDrift, type CmsDocument, type SchemaField } from "../api.ts";
import { CheckIcon, CloseIcon, WarningIcon } from "../Icons.tsx";
import {
  parseFrontmatter,
  type FrontmatterDocument,
} from "../frontmatter/document.ts";
import { planFields, toControlValue } from "../frontmatter/fields.ts";

export interface PublishReviewProps {
  document: CmsDocument;
  editor: Editor;
  schema: readonly SchemaField[] | null;
  fmDoc: FrontmatterDocument | undefined;
  title: string;
  publishing: boolean;
  onClose: () => void;
  onPublish: () => Promise<void>;
}

type CheckTone = "ok" | "bad" | "warn";

interface Check {
  tone: CheckTone;
  label: string;
}

function requiredMissing(
  schema: readonly SchemaField[] | null,
  fmDoc: FrontmatterDocument | undefined,
): string[] {
  if (schema === null || fmDoc === undefined) return [];
  const values = Object.fromEntries(
    fmDoc.keys().map((key) => [key, fmDoc.get(key)]),
  );
  const { planned } = planFields(schema, fmDoc.keys(), values);
  return planned
    .filter((plan) => {
      if (!plan.field.required) return false;
      const value = toControlValue(plan.kind, values[plan.field.name]);
      return value === "" || (Array.isArray(value) && value.length === 0);
    })
    .map((plan) => plan.field.name);
}

/** Tiptap image nodes with no `alt` — a real accessibility check, not a guess. */
function imagesMissingAlt(doc: EditorDoc): number {
  let count = 0;
  function walk(node: EditorNode): void {
    if (node.type === "image") {
      const alt = (node.attrs as { alt?: string } | undefined)?.alt;
      if (alt === undefined || alt === "") count += 1;
    }
    (node.content ?? []).forEach(walk);
  }
  doc.content.forEach(walk);
  return count;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

interface Baseline {
  baseContent: string | null;
  drifted: boolean;
}

/**
 * What changed versus the base branch, computed from the real drift report
 * (docs: UX rethink, "Publish as review" direction) — not a fabricated diff.
 */
function diffAgainstBase(
  baseline: Baseline | undefined,
  current: { text: string; fmDoc: FrontmatterDocument | undefined; imageCount: number },
  format: "md" | "mdx",
): { body: string; frontmatter: string; media: string } {
  if (baseline === undefined || baseline.baseContent === null) {
    return {
      body: "New file — nothing to compare yet.",
      frontmatter: "New file",
      media: current.imageCount === 0 ? "No images" : `${String(current.imageCount)} image(s)`,
    };
  }

  const base = parseDocument(baseline.baseContent, format);
  const baseFm = parseFrontmatter(base.frontmatter);
  const baseWords = wordCount(base.doc.content.map(textOf).join(" "));
  const wordDelta = wordCount(current.text) - baseWords;

  let frontmatterSummary = "No changes";
  if (current.fmDoc !== undefined) {
    const keys = new Set([
      ...current.fmDoc.keys(),
      ...(baseFm?.keys() ?? []),
    ]);
    const changed = [...keys].filter((key) => {
      const before = baseFm?.get(key);
      const after = current.fmDoc?.get(key);
      return JSON.stringify(before) !== JSON.stringify(after);
    });
    if (changed.length > 0) frontmatterSummary = `${changed.join(", ")} changed`;
  }

  const baseImageCount = (baseline.baseContent.match(/!\[[^\]]*\]\(/g) ?? []).length;
  const mediaDelta = current.imageCount - baseImageCount;

  return {
    body:
      wordDelta === 0
        ? "No word count change"
        : `${wordDelta > 0 ? "+" : ""}${String(wordDelta)} words vs. the base branch`,
    frontmatter: frontmatterSummary,
    media:
      mediaDelta === 0
        ? `${String(current.imageCount)} image(s), unchanged`
        : `${String(current.imageCount)} image(s) (${mediaDelta > 0 ? "+" : ""}${String(mediaDelta)})`,
  };
}

/** Plain-text content of one Tiptap node, recursively. */
function textOf(node: EditorNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOf).join(" ");
}

export function PublishReview({
  document,
  editor,
  schema,
  fmDoc,
  title,
  publishing,
  onClose,
  onPublish,
}: PublishReviewProps): JSX.Element {
  const [baseline, setBaseline] = useState<Baseline>();
  const [commitMessage, setCommitMessage] = useState(`Publish: ${title}`);

  useEffect(() => {
    getDrift(document.id)
      .then((report) => setBaseline({ baseContent: report.baseContent, drifted: report.drifted }))
      .catch(() => setBaseline(undefined));
  }, [document.id]);

  const missing = requiredMissing(schema, fmDoc);
  const noAltCount = imagesMissingAlt(editor.getJSON() as EditorDoc);
  const upToDate = baseline === undefined || !baseline.drifted;

  const checks: Check[] = [
    missing.length === 0
      ? { tone: "ok", label: "Required fields are set" }
      : { tone: "bad", label: `Required: ${missing.join(", ")}` },
    noAltCount === 0
      ? { tone: "ok", label: "Images have alt text" }
      : {
          tone: "warn",
          label: `${String(noAltCount)} image${noAltCount === 1 ? "" : "s"} missing alt text`,
        },
    upToDate
      ? { tone: "ok", label: "Up to date with the base branch" }
      : { tone: "bad", label: "The base branch moved — re-sync first" },
  ];

  const blocked = checks.some((check) => check.tone === "bad");
  const diff = diffAgainstBase(
    baseline,
    { text: editor.getText(), fmDoc, imageCount: countImages(editor.getJSON() as EditorDoc) },
    document.format,
  );

  return (
    <div className="publish-review-overlay">
      <div className="publish-review-scrim" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-review-title"
        className="publish-review"
      >
        <header className="publish-review-header">
          <div>
            <h2 id="publish-review-title">Review and publish</h2>
            <p className="hint mono">{document.path}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="publish-review-body">
          <section className="publish-review-section">
            <h3>Before it goes live</h3>
            <ul className="publish-checklist">
              {checks.map((check) => (
                <li key={check.label} className={`check-${check.tone}`}>
                  <span className="check-icon" aria-hidden="true">
                    {check.tone === "ok" ? <CheckIcon /> : <WarningIcon />}
                  </span>
                  <span>{check.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="publish-review-section">
            <h3>What&apos;s changing</h3>
            <dl className="publish-diff">
              <dt>Body</dt>
              <dd>{diff.body}</dd>
              <dt>Frontmatter</dt>
              <dd className="mono">{diff.frontmatter}</dd>
              <dt>Media</dt>
              <dd>{diff.media}</dd>
            </dl>
          </section>

          <section className="publish-review-section">
            <label htmlFor="commit-message">Commit message</label>
            <textarea
              id="commit-message"
              className="mono"
              rows={2}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            <p className="hint">
              Not sent to GitHub yet — the publish API doesn&apos;t accept a
              custom message. Recorded here for when it does.
            </p>
          </section>
        </div>

        <footer className="publish-review-footer">
          <span className={blocked ? "check-bad" : "check-ok"}>
            {blocked ? "Fix the required items above" : "Ready to publish"}
          </span>
          <div className="publish-review-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={blocked || publishing}
              onClick={() => void onPublish()}
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function countImages(doc: EditorDoc): number {
  let count = 0;
  function walk(node: EditorNode): void {
    if (node.type === "image") count += 1;
    (node.content ?? []).forEach(walk);
  }
  doc.content.forEach(walk);
  return count;
}
