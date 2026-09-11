import { useState, type FormEvent, type JSX } from "react";
import { login, type Session } from "./api.ts";

export interface LoginFormProps {
  onSignedIn: (session: Session) => void;
}

export function LoginForm({ onSignedIn }: LoginFormProps): JSX.Element {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      onSignedIn(await login(password));
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <main className="centered">
      <form className="panel" onSubmit={(event) => void handleSubmit(event)}>
        <h1>Astro CMS</h1>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
