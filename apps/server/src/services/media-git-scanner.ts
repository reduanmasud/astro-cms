import type { GitReference, MediaRepository } from "../db/media-repository.ts";
import { CMS_BRANCH_PREFIX } from "../github/names.ts";
import { mediaKeysIn } from "../media/urls.ts";
import type { AstroProjectService } from "./astro-project.ts";
import type { RepositoryService } from "./repository.ts";

/**
 * Which published content uses which media: the base branch and every open
 * CMS branch (docs/superpowers/specs/2026-09-15-media-gc-design.md).
 *
 * Only content files are read, and only when a ref has moved since the last
 * scan. Nothing is deleted here; the collector does that.
 */

export interface GitScanSummary {
  /** Refs considered. */
  readonly refs: number;
  /** Refs actually read, the rest being unchanged since last time. */
  readonly read: number;
  readonly files: number;
  readonly references: number;
}

/**
 * The scan could not establish what is referenced, so its result must not be
 * treated as "nothing is referenced". Always thrown, never returned.
 */
export class MediaScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaScanError";
  }
}

export interface MediaGitScanner {
  scan(): Promise<GitScanSummary>;
}

interface Deps {
  repository: MediaRepository;
  git: RepositoryService;
  project: AstroProjectService;
  /** Public base URL media is served from. Null switches scanning off. */
  publicUrl: string | null;
  baseBranch: string;
}

const CONTENT_FILE = /\.mdx?$/;

export function createMediaGitScanner({
  repository,
  git,
  project,
  publicUrl,
  baseBranch,
}: Deps): MediaGitScanner {
  /** Heads we have already scanned, so an unchanged ref costs nothing. */
  const scanned = new Map<string, string>();

  function underContent(path: string, roots: readonly string[]): boolean {
    if (!CONTENT_FILE.test(path)) return false;
    return roots.some((root) => root === "." || path.startsWith(`${root}/`));
  }

  /**
   * The directories a reference can live in. An empty list is not an answer:
   * `discover()` returns no collections when the content config is missing,
   * and a collection whose loader the static parser cannot model has a null
   * `contentPath`. Either way nothing would be found, every git reference
   * would be replaced with none, and the collector would read that as proof
   * of disuse. Refuse instead.
   */
  async function contentRoots(): Promise<string[]> {
    const { collections } = await project.discover();
    const roots = collections
      .map((collection) => collection.contentPath)
      .filter((path): path is string => path !== null);
    if (roots.length === 0) {
      throw new MediaScanError(
        "No content collection paths could be resolved, so no media reference can be proved. Check src/content.config.* and its loaders.",
      );
    }
    return roots;
  }

  async function scanRef(
    ref: string,
    roots: readonly string[],
  ): Promise<{ files: number; references: number }> {
    const paths = (await git.listFiles(ref)).filter((path) =>
      underContent(path, roots),
    );

    const references: GitReference[] = [];
    for (const path of paths) {
      const source = await git.readFile(path, ref);
      if (source === undefined) continue;
      const keys = mediaKeysIn(source, publicUrl);
      if (keys.length === 0) continue;
      for (const record of repository.findByObjectKeys(keys)) {
        references.push({ mediaId: record.id, path });
      }
    }

    repository.setGitReferences(ref, references);
    return { files: paths.length, references: references.length };
  }

  return {
    async scan() {
      if (publicUrl === null) {
        return { refs: 0, read: 0, files: 0, references: 0 };
      }

      const open = await git.listOpenPullRequests();
      const refs = [
        baseBranch,
        ...open
          .map((pullRequest) => pullRequest.head)
          .filter((head) => head.startsWith(CMS_BRANCH_PREFIX)),
      ];

      // Read once per sweep, not once per ref. The roots come from the base
      // branch even while scanning a `cms/` branch: those branches are created
      // by the CMS from the base branch, so their layout is the same one.
      const roots = await contentRoots();

      let read = 0;
      let files = 0;
      let references = 0;

      for (const ref of refs) {
        const head = await git.getBranchHead(ref);
        if (head === undefined) {
          // A `cms/` branch disappears when its pull request is merged. The
          // base branch never legitimately does, so an absent one is a
          // misconfiguration, not a prune.
          if (ref === baseBranch) {
            throw new MediaScanError(
              `Base branch "${baseBranch}" does not exist, so its media references cannot be read. Check GITHUB_BASE_BRANCH.`,
            );
          }
          repository.deleteGitReferences(ref);
          scanned.delete(ref);
          continue;
        }
        if (scanned.get(ref) === head) continue;

        const result = await scanRef(ref, roots);
        scanned.set(ref, head);
        read += 1;
        files += result.files;
        references += result.references;
      }

      // Refs we hold references for that are no longer open.
      const live = new Set(refs);
      for (const ref of repository.listGitRefs()) {
        if (!live.has(ref)) {
          repository.deleteGitReferences(ref);
          scanned.delete(ref);
        }
      }

      return { refs: refs.length, read, files, references };
    },
  };
}
