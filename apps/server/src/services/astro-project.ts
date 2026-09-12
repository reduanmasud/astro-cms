import {
  parseContentConfig,
  type CollectionDefinition,
} from "../astro/content-config.ts";
import type { RepositoryService } from "./repository.ts";

export interface CollectionSummary extends CollectionDefinition {
  /** Number of files the collection reads, or null when it cannot be counted. */
  readonly entryCount: number | null;
}

export interface CollectionEntry {
  readonly path: string;
  readonly format: string;
}

export interface AstroProject {
  /** Base-branch commit the project was read at. */
  readonly headSha: string;
  readonly isAstroProject: boolean;
  readonly astroConfigPath: string | null;
  /** The `astro` version range from package.json. */
  readonly astroVersion: string | null;
  readonly contentConfigPath: string | null;
  readonly collections: readonly CollectionSummary[];
  readonly warnings: readonly string[];
}

export interface CollectionDetail {
  readonly collection: CollectionSummary;
  readonly entries: readonly CollectionEntry[];
}

export interface AstroProjectService {
  /** Reads the project at the current base-branch head. Cached per commit. */
  discover(): Promise<AstroProject>;
  getCollection(name: string): Promise<CollectionDetail | undefined>;
}

const ASTRO_CONFIG = /^astro\.config\.(mjs|js|ts|mts|cjs|cts)$/;
const CONTENT_CONFIGS = [
  "src/content.config.ts",
  "src/content.config.mts",
  "src/content.config.js",
  "src/content.config.mjs",
];
const LEGACY_CONTENT_CONFIGS = [
  "src/content/config.ts",
  "src/content/config.mts",
  "src/content/config.js",
  "src/content/config.mjs",
];
/** Loaders whose content is a set of files in one directory. */
const DIRECTORY_LOADERS = new Set(["glob", "legacy-content", "legacy-data"]);

interface Snapshot {
  readonly project: AstroProject;
  readonly files: readonly string[];
}

/**
 * Finds the Astro configuration and content collections in the repository.
 * The Astro project stays authoritative: nothing here is a second schema.
 */
export function createAstroProjectService({
  repository,
}: {
  repository: RepositoryService;
}): AstroProjectService {
  let cached: Snapshot | undefined;

  async function snapshot(): Promise<Snapshot> {
    const headSha = await repository.getBaseHead();
    if (cached?.project.headSha !== headSha) {
      cached = await readProject(repository, headSha);
    }
    return cached;
  }

  return {
    async discover() {
      return (await snapshot()).project;
    },

    async getCollection(name) {
      const { project, files } = await snapshot();
      const collection = project.collections.find((c) => c.name === name);
      return (
        collection && { collection, entries: entriesOf(collection, files) }
      );
    },
  };
}

async function readProject(
  repository: RepositoryService,
  headSha: string,
): Promise<Snapshot> {
  const files = await repository.listFiles(headSha);
  const fileSet = new Set(files);
  const warnings: string[] = [];

  const astroConfigPath = files.find((path) => ASTRO_CONFIG.test(path)) ?? null;
  const astroVersion = await readAstroVersion(repository, headSha, fileSet);
  const isAstroProject = astroConfigPath !== null || astroVersion !== null;
  if (!isAstroProject) {
    warnings.push(
      "No astro.config.* file and no astro dependency found. Is this an Astro project?",
    );
  }

  const contentConfigPath =
    CONTENT_CONFIGS.find((path) => fileSet.has(path)) ??
    LEGACY_CONTENT_CONFIGS.find((path) => fileSet.has(path)) ??
    null;

  let collections: CollectionSummary[] = [];
  if (contentConfigPath === null) {
    warnings.push(
      "No src/content.config.* file found, so there are no content collections.",
    );
  } else {
    if (LEGACY_CONTENT_CONFIGS.includes(contentConfigPath)) {
      warnings.push(
        `The content config is at the legacy location ${contentConfigPath}; Astro 5 uses src/content.config.ts.`,
      );
    }
    const source =
      (await repository.readFile(contentConfigPath, headSha)) ?? "";
    const config = parseContentConfig(source);
    warnings.push(...config.warnings);
    collections = config.collections.map((collection) => ({
      ...collection,
      entryCount: DIRECTORY_LOADERS.has(collection.loader)
        ? entriesOf(collection, files).length
        : null,
    }));
  }

  return {
    files,
    project: {
      headSha,
      isAstroProject,
      astroConfigPath,
      astroVersion,
      contentConfigPath,
      collections,
      warnings,
    },
  };
}

async function readAstroVersion(
  repository: RepositoryService,
  headSha: string,
  files: ReadonlySet<string>,
): Promise<string | null> {
  if (!files.has("package.json")) return null;
  try {
    const manifest = JSON.parse(
      (await repository.readFile("package.json", headSha)) ?? "{}",
    ) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const version =
      manifest.dependencies?.astro ?? manifest.devDependencies?.astro;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** Files inside the collection's directory with one of its formats. */
function entriesOf(
  collection: CollectionDefinition,
  files: readonly string[],
): CollectionEntry[] {
  if (
    !DIRECTORY_LOADERS.has(collection.loader) ||
    collection.contentPath === null
  )
    return [];
  const prefix =
    collection.contentPath === "." ? "" : `${collection.contentPath}/`;
  const formats = new Set(collection.formats);

  return files.flatMap((path) => {
    if (!path.startsWith(prefix)) return [];
    const format = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
    return format && formats.has(format) ? [{ path, format }] : [];
  });
}
