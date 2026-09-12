import type {
  DocumentRepository,
  PublicationChanges,
} from "../db/document-repository.ts";
import type { CmsDocument, CollaboratorRef } from "../documents/model.ts";
import type { PullRequest } from "../github/client.ts";
import { CMS_BRANCH_PREFIX } from "../github/names.ts";
import { DocumentError, type DocumentService } from "./documents.ts";
import { RepositoryError, type RepositoryService } from "./repository.ts";

/**
 * Publishing: a draft becomes a commit on its own `cms/` branch with an open
 * pull request (docs/adr/0004-one-branch-per-content-item.md). Drafting never
 * reaches GitHub; this service is the only one that writes there.
 */

export type PublishErrorCode =
  "drift" | "not_found" | "branch_blocked" | "invalid";

export class PublishError extends Error {
  readonly code: PublishErrorCode;
  /** Present when `code` is "drift", so the caller can show the difference. */
  readonly drift?: DriftReport;

  constructor(code: PublishErrorCode, message: string, drift?: DriftReport) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    if (drift !== undefined) this.drift = drift;
  }
}

export interface DriftReport {
  readonly drifted: boolean;
  readonly baseCommitSha: string | null;
  readonly headSha: string;
  /** The file as it stands on the base branch, or null if it is not there. */
  readonly baseContent: string | null;
}

export interface PublishResult {
  readonly pullRequest: PullRequest;
  readonly commitSha: string;
  readonly createdBranch: boolean;
  readonly createdPullRequest: boolean;
  readonly document: CmsDocument;
}

export interface PublishService {
  publish(id: string, actor: CollaboratorRef | null): Promise<PublishResult>;
  /** Compares the draft's baseline with the base branch head. */
  drift(id: string): Promise<DriftReport>;
  /** Adopts the current base head as the draft's baseline. */
  resync(id: string): Promise<{ baseCommitSha: string }>;
  /** Asks GitHub about this draft's pull request and updates its status. */
  refresh(id: string): Promise<CmsDocument>;
  branchFor(document: CmsDocument): string;
}

interface Deps {
  documents: DocumentService;
  documentRepository: DocumentRepository;
  repository: RepositoryService;
  now?: () => number;
}

export function createPublishService({
  documents,
  documentRepository,
  repository,
  now = Date.now,
}: Deps): PublishService {
  function get(id: string): CmsDocument {
    try {
      return documents.get(id);
    } catch (error) {
      if (error instanceof DocumentError && error.code === "not_found") {
        throw new PublishError("not_found", "No document with that id.");
      }
      throw error;
    }
  }

  /** `cms/<collection>/<slug>`: one branch per content item, never per person. */
  function branchFor(document: CmsDocument): string {
    return `${CMS_BRANCH_PREFIX}${document.collection}/${document.slug}`;
  }

  async function report(document: CmsDocument): Promise<DriftReport> {
    const headSha = await repository.getBaseHead();
    const baseCommitSha = document.publication.baseCommitSha;
    return {
      // A draft with no baseline has nothing to violate.
      drifted: baseCommitSha !== null && baseCommitSha !== headSha,
      baseCommitSha,
      headSha,
      baseContent: (await repository.readFile(document.path)) ?? null,
    };
  }

  return {
    branchFor,

    async publish(id, actor) {
      const document = get(id);
      const drift = await report(document);
      if (drift.drifted) {
        throw new PublishError(
          "drift",
          `${document.path} cannot be published: the base branch moved since this draft started. Re-sync it, then publish again.`,
          drift,
        );
      }

      const branch = branchFor(document);
      const existed = document.publication.branch !== null;
      let saved;
      try {
        saved = await repository.saveToBranch({
          branch,
          message: `${existed ? "Update" : "Add"} ${document.path}`,
          changes: [{ path: document.path, content: document.source }],
          pullRequest: {
            title: `CMS: ${document.collection}/${document.slug}`,
            body: [
              `Published from Astro CMS by ${actor?.name ?? "someone"}.`,
              "",
              `- File: \`${document.path}\``,
              `- Collection: ${document.collection}`,
              "",
              "The CMS manages this branch; it commits here on every publish.",
            ].join("\n"),
          },
        });
      } catch (error) {
        if (error instanceof RepositoryError) {
          throw new PublishError("branch_blocked", error.message);
        }
        throw error;
      }

      const changes: PublicationChanges = {
        branch,
        pullRequestNumber: saved.pullRequest.number,
        pullRequestUrl: saved.pullRequest.url,
        publishedCommitSha: saved.commitSha,
        publishedAt: now(),
        status: "in_review",
      };
      documentRepository.setPublication(id, changes);
      if (drift.baseCommitSha === null) {
        documentRepository.setBaseCommit(id, drift.headSha);
      }

      return {
        pullRequest: saved.pullRequest,
        commitSha: saved.commitSha,
        createdBranch: saved.createdBranch,
        createdPullRequest: saved.createdPullRequest,
        document: get(id),
      };
    },

    drift(id) {
      return report(get(id));
    },

    async resync(id) {
      get(id);
      const headSha = await repository.getBaseHead();
      documentRepository.setBaseCommit(id, headSha);
      return { baseCommitSha: headSha };
    },

    async refresh(id) {
      const document = get(id);
      const number = document.publication.pullRequestNumber;
      if (number === null) return document;

      const pullRequest = await repository.getPullRequest(number);
      if (pullRequest === undefined) return document;
      if (pullRequest.merged) documentRepository.setStatus(id, "published");
      else if (pullRequest.state === "closed")
        documentRepository.setStatus(id, "draft");
      return get(id);
    },
  };
}
