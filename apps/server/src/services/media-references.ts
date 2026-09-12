import type { MediaRepository } from "../db/media-repository.ts";
import type { DocumentService } from "./documents.ts";

/**
 * Which drafts use which media (docs/adr/0008-media-storage-and-gc.md).
 *
 * References are recomputed from the drafts in SQLite: every media URL in a
 * draft's Markdown counts as one reference. Files with none are stamped with
 * `unused_since` so a later garbage collector can age them out; nothing is
 * deleted here.
 *
 * Pull requests and the base branch are not scanned yet; that arrives with
 * publishing, when the CMS knows which drafts are on which branch.
 */

export interface ReferenceSummary {
  readonly documents: number;
  readonly references: number;
}

export interface MediaReferenceTracker {
  /** Rebuilds references for one draft. */
  syncDocument(documentId: string): ReferenceSummary;
  /** Rebuilds references for every draft. */
  recompute(): ReferenceSummary;
}

interface Deps {
  repository: MediaRepository;
  documents: DocumentService;
  /** Public base URL media is served from; used to spot our own files. */
  publicUrl: string | null;
  now?: () => number;
}

export function createMediaReferenceTracker({
  repository,
  documents,
  publicUrl,
  now = Date.now,
}: Deps): MediaReferenceTracker {
  /** Object keys of our own media mentioned anywhere in the text. */
  function keysIn(source: string): string[] {
    if (publicUrl === null) return [];
    const found = new Set<string>();
    const base = publicUrl.replace(/\/+$/, "");
    // Matches the URL wherever it appears: Markdown, HTML, or MDX props.
    const pattern = new RegExp(`${escapeRegExp(base)}/([A-Za-z0-9/_.-]+)`, "g");
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (key !== undefined) found.add(key);
    }
    return [...found];
  }

  function sync(documentId: string, source: string): number {
    const keys = keysIn(source);
    const media = repository.findByObjectKeys(keys);
    repository.setReferences(
      documentId,
      media.map((record) => record.id),
    );
    return media.length;
  }

  return {
    syncDocument(documentId) {
      const document = documents.get(documentId);
      const references = sync(document.id, document.source);
      repository.refreshUnusedMarkers(now());
      return { documents: 1, references };
    },

    recompute() {
      let references = 0;
      let seen = 0;
      // Drafts are few; a full pass keeps this simple and always correct.
      for (const summary of documents.list({ limit: 200 })) {
        const document = documents.get(summary.id);
        references += sync(document.id, document.source);
        seen += 1;
      }
      repository.refreshUnusedMarkers(now());
      return { documents: seen, references };
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
