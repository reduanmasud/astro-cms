import {
  isValidBranchName,
  isValidOwner,
  isValidRepositoryName,
} from "./github/names.ts";

export interface GitHubConfig {
  readonly token: string;
  readonly owner: string;
  readonly repository: string;
  readonly baseBranch: string;
}

/**
 * A HocusPocus server the CMS points clients at. Collaboration is off unless
 * all four values are set (docs/adr/0016-collaboration-service.md).
 */
export interface CollaborationConfig {
  /** WebSocket URL the browser connects to. */
  readonly publicUrl: string;
  /** WebSocket URL the server and MCP connect to, inside the private network. */
  readonly internalUrl: string;
  /** Signs the short-lived tokens HocusPocus verifies. */
  readonly jwtSecret: string;
  /** Verifies webhook requests coming back from HocusPocus. */
  readonly webhookSecret: string;
}

export interface Config {
  readonly port: number;
  readonly dataDir: string;
  readonly cmsPassword: string;
  readonly sessionSecret: string;
  readonly cookieSecure: boolean;
  readonly github: GitHubConfig;
  readonly collaboration: CollaborationConfig | null;
}

type Env = Readonly<Record<string, string | undefined>>;

const MIN_PASSWORD_LENGTH = 12;
const MIN_SECRET_LENGTH = 32;
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = "data";
const DEFAULT_BASE_BRANCH = "main";

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/** Validates environment variables once at startup. Throws ConfigError listing every problem. */
export function loadConfig(env: Env): Config {
  const problems: string[] = [];

  const cmsPassword = env.CMS_PASSWORD ?? "";
  problems.push(
    ...checkSecret("CMS_PASSWORD", cmsPassword, MIN_PASSWORD_LENGTH),
  );

  const sessionSecret = env.SESSION_SECRET ?? "";
  problems.push(
    ...checkSecret("SESSION_SECRET", sessionSecret, MIN_SECRET_LENGTH),
  );
  if (sessionSecret !== "" && sessionSecret === cmsPassword) {
    problems.push("SESSION_SECRET and CMS_PASSWORD must be different.");
  }

  const port = parsePort(env.PORT);
  if (port === undefined) {
    problems.push("PORT must be an integer between 1 and 65535.");
  }

  const cookieSecure = parseBoolean(
    env.COOKIE_SECURE,
    env.NODE_ENV === "production",
  );
  if (cookieSecure === undefined) {
    problems.push('COOKIE_SECURE must be "true" or "false".');
  }

  const collaboration = readCollaboration(env, problems);

  const github = {
    token: env.GITHUB_TOKEN ?? "",
    owner: env.GITHUB_OWNER ?? "",
    repository: env.GITHUB_REPOSITORY ?? "",
    baseBranch: env.GITHUB_BASE_BRANCH || DEFAULT_BASE_BRANCH,
  };
  problems.push(...checkGitHub(github));

  if (problems.length > 0 || port === undefined || cookieSecure === undefined) {
    throw new ConfigError(problems);
  }

  return {
    port,
    dataDir: env.DATA_DIR || DEFAULT_DATA_DIR,
    cmsPassword,
    sessionSecret,
    cookieSecure,
    github,
    collaboration,
  };
}

const COLLABORATION_KEYS = [
  "HOCUSPOCUS_PUBLIC_URL",
  "HOCUSPOCUS_INTERNAL_URL",
  "HOCUSPOCUS_JWT_SECRET",
  "HOCUSPOCUS_WEBHOOK_SECRET",
] as const;

/** All four values or none: collaboration is optional, but never half-configured. */
function readCollaboration(
  env: Env,
  problems: string[],
): CollaborationConfig | null {
  const values = COLLABORATION_KEYS.map((name) => env[name] ?? "");
  if (values.every((value) => value === "")) return null;

  COLLABORATION_KEYS.forEach((name, index) => {
    if (values[index] === "") {
      problems.push(
        `${name} is required when any other HOCUSPOCUS_* value is set.`,
      );
    }
  });

  const [publicUrl = "", internalUrl = "", jwtSecret = "", webhookSecret = ""] =
    values;
  if (publicUrl !== "" && !isWebSocketUrl(publicUrl)) {
    problems.push("HOCUSPOCUS_PUBLIC_URL must be a ws:// or wss:// URL.");
  }
  if (internalUrl !== "" && !isWebSocketUrl(internalUrl)) {
    problems.push("HOCUSPOCUS_INTERNAL_URL must be a ws:// or wss:// URL.");
  }
  problems.push(
    ...checkSecret("HOCUSPOCUS_JWT_SECRET", jwtSecret, MIN_SECRET_LENGTH),
  );
  problems.push(
    ...checkSecret(
      "HOCUSPOCUS_WEBHOOK_SECRET",
      webhookSecret,
      MIN_SECRET_LENGTH,
    ),
  );
  if (jwtSecret !== "" && jwtSecret === webhookSecret) {
    problems.push(
      "HOCUSPOCUS_JWT_SECRET and HOCUSPOCUS_WEBHOOK_SECRET must be different.",
    );
  }

  return { publicUrl, internalUrl, jwtSecret, webhookSecret };
}

function isWebSocketUrl(value: string): boolean {
  try {
    return ["ws:", "wss:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function checkGitHub(github: GitHubConfig): string[] {
  const problems: string[] = [];
  if (github.token === "") problems.push("GITHUB_TOKEN is required.");

  if (github.owner === "") problems.push("GITHUB_OWNER is required.");
  else if (!isValidOwner(github.owner)) {
    problems.push(
      "GITHUB_OWNER is not a valid GitHub user or organization name.",
    );
  }

  if (github.repository === "") problems.push("GITHUB_REPOSITORY is required.");
  else if (!isValidRepositoryName(github.repository)) {
    problems.push(
      "GITHUB_REPOSITORY is not a valid repository name (use the name only, not owner/name).",
    );
  }

  if (!isValidBranchName(github.baseBranch)) {
    problems.push("GITHUB_BASE_BRANCH is not a valid branch name.");
  }
  return problems;
}

function checkSecret(name: string, value: string, minLength: number): string[] {
  if (value === "") return [`${name} is required.`];
  if (value.length < minLength)
    return [`${name} must be at least ${minLength} characters.`];
  return [];
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return DEFAULT_PORT;
  if (!/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean | undefined {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
