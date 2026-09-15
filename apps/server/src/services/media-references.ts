import type { MediaRepository } from "../db/media-repository.ts";
import { mediaKeysIn } from "../media/urls.ts";
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
  function sync(documentId: string, source: string): number {
    const keys = mediaKeysIn(source, publicUrl);
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
