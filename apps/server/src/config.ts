export type Config = {
  readonly port: number;
  readonly dataDir: string;
  readonly cmsPassword: string;
  readonly sessionSecret: string;
  readonly cookieSecure: boolean;
};

type Env = Readonly<Record<string, string | undefined>>;

const MIN_PASSWORD_LENGTH = 12;
const MIN_SECRET_LENGTH = 32;
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = "data";

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

  if (problems.length > 0 || port === undefined || cookieSecure === undefined) {
    throw new ConfigError(problems);
  }

  return {
    port,
    dataDir: env.DATA_DIR || DEFAULT_DATA_DIR,
    cmsPassword,
    sessionSecret,
    cookieSecure,
  };
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
