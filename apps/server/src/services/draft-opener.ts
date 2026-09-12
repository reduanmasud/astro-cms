import type { CmsDocument, CollaboratorRef } from "../documents/model.ts";
import { formatFromPath } from "../documents/model.ts";
import type { AstroProjectService } from "./astro-project.ts";
import { DocumentError, type DocumentService } from "./documents.ts";
import type { RepositoryService } from "./repository.ts";

export interface OpenDraftInput {
  readonly collection: string;
  readonly path: string;
}

export interface OpenedDraft {
  readonly document: CmsDocument;
  /** False when a draft for the path already existed. */
  readonly created: boolean;
}

export interface DraftOpener {
  /**
   * Returns the draft for `path`, creating it on first open. A new draft
   * copies the file from the base branch (if it exists) and records that
   * commit as its base. GitHub is only read, never written.
   */
  open(
    input: OpenDraftInput,
    actor: CollaboratorRef | null,
  ): Promise<OpenedDraft>;
}

interface Deps {
  documents: DocumentService;
  repository: RepositoryService;
  project: AstroProjectService;
}

export function createDraftOpener({
  documents,
  repository,
  project,
}: Deps): DraftOpener {
  return {
    async open({ collection, path }, actor) {
      const existing = documents.findByPath(path);
      if (existing) {
        if (existing.collection !== collection) {
          throw new DocumentError(
            "invalid",
            `This file is a draft in "${existing.collection}".`,
          );
        }
        return { document: existing, created: false };
      }

      const detail = await project.getCollection(collection);
      if (!detail)
        throw new DocumentError("not_found", "No collection with that name.");
      const { contentPath, formats } = detail.collection;

      const inside =
        contentPath === "." ||
        (contentPath !== null && path.startsWith(`${contentPath}/`));
      if (!inside) {
        throw new DocumentError(
          "invalid",
          `The path must be inside ${contentPath ?? "the collection"}.`,
        );
      }
      const format = formatFromPath(path);
      if (format === undefined || !formats.includes(format)) {
        throw new DocumentError(
          "invalid",
          `The "${collection}" collection does not use this file type.`,
        );
      }

      const baseCommitSha = await repository.getBaseHead();
      const source = (await repository.readFile(path, baseCommitSha)) ?? "";
      const document = documents.create(
        { collection, path, source, contentPath, baseCommitSha },
        actor,
      );
      return { document, created: true };
    },
  };
}
