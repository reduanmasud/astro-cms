export type Collaborator = { id: string; name: string };

/** `collaborator` is null until a display name has been chosen. */
export type Session = { collaborator: Collaborator | null };

type ErrorBody = { error?: { code?: string; message?: string } };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  const body = (await response.json().catch(() => undefined)) as
    ErrorBody | undefined;
  throw new ApiError(
    response.status,
    body?.error?.code ?? "http_error",
    body?.error?.message ?? `Request failed (${response.status}).`,
  );
}

function sendJson(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Returns the current session, or undefined when signed out. */
export async function getSession(): Promise<Session | undefined> {
  try {
    return await request<Session>("/api/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return undefined;
    throw error;
  }
}

export function login(password: string): Promise<Session> {
  return request<Session>("/api/session", sendJson("POST", { password }));
}

export async function chooseDisplayName(name: string): Promise<Collaborator> {
  const { collaborator } = await request<{ collaborator: Collaborator }>(
    "/api/session/display-name",
    sendJson("PUT", { name }),
  );
  return collaborator;
}

export function logout(): Promise<void> {
  return request<void>("/api/session", { method: "DELETE" });
}
