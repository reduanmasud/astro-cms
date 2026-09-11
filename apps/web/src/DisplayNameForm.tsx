import { useState, type FormEvent } from "react";
import { chooseDisplayName, type Collaborator } from "./api.ts";

const REMEMBERED_NAME_KEY = "astro-cms:display-name";

function rememberedName(): string {
  try {
    return localStorage.getItem(REMEMBERED_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(REMEMBERED_NAME_KEY, name);
  } catch {
    // Prefilling the name next time is a convenience; ignore storage failures.
  }
}

export function DisplayNameForm({
  onChosen,
}: {
  onChosen: (collaborator: Collaborator) => void;
}) {
  const [name, setName] = useState(rememberedName);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const collaborator = await chooseDisplayName(name);
      rememberName(collaborator.name);
      onChosen(collaborator);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <main className="centered">
      <form className="panel" onSubmit={(event) => void handleSubmit(event)}>
        <h1>Who are you?</h1>
        <p className="hint">
          Collaborators see this name next to your cursor and changes.
        </p>
        <label>
          Display name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            autoComplete="nickname"
            autoFocus
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
