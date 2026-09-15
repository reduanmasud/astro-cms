import type { MediaRepository } from "../db/media-repository.ts";
import { mediaKeysIn } from "../media/urls.ts";
import { MAX_PAGE_SIZE, type DocumentService } from "./documents.ts";

/**
 * Which drafts use which media (docs/adr/0008-media-storage-and-gc.md).
 *
 * References are recomputed from the drafts in SQLite: every media URL in a
 * draft's Markdown counts as one reference. Files with none are stamped with
 * `unused_since` so a later garbage collector can age them out; nothing is
 * deleted here.
 *
 * The other two sources — open CMS pull requests and the base branch — are
 * scanned by `media-git-scanner.ts` into their own table, and
 * `MediaRecord.referenceCount` sums both (ADR-0021).
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
      // Every draft, page by page. A partial pass would look exactly like a
      // full one to the collector, and the drafts it skipped would have their
      // media counted as unreferenced.
      for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
        const page = documents.list({ limit: MAX_PAGE_SIZE, offset });
        for (const summary of page) {
          const document = documents.get(summary.id);
          references += sync(document.id, document.source);
          seen += 1;
        }
        if (page.length < MAX_PAGE_SIZE) break;
      }
      repository.refreshUnusedMarkers(now());
      return { documents: seen, references };
    },
  };
}
