import { useEffect, useState, type JSX } from "react";
import { getSession, logout, type Collaborator, type Session } from "./api.ts";
import { DisplayNameForm } from "./DisplayNameForm.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { RepositoryPanel } from "./RepositoryPanel.tsx";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session };

export function App(): JSX.Element {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    getSession()
      .then((session) =>
        setState(
          session ? { status: "signed-in", session } : { status: "signed-out" },
        ),
      )
      .catch((error: Error) =>
        setState({ status: "error", message: error.message }),
      );
  }, []);

  async function handleLogout() {
    try {
      await logout();
      setState({ status: "signed-out" });
    } catch (error) {
      setState({ status: "error", message: (error as Error).message });
    }
  }

  const signedIn = (session: Session) =>
    setState({ status: "signed-in", session });

  switch (state.status) {
    case "loading":
      return <main className="centered">Loading…</main>;
    case "error":
      return (
        <main className="centered">
          <p role="alert">Could not reach the CMS server: {state.message}</p>
        </main>
      );
    case "signed-out":
      return <LoginForm onSignedIn={signedIn} />;
    case "signed-in":
      return state.session.collaborator === null ? (
        <DisplayNameForm
          onChosen={(collaborator) => signedIn({ collaborator })}
        />
      ) : (
        <Shell
          collaborator={state.session.collaborator}
          onLogout={() => void handleLogout()}
        />
      );
  }
}

interface ShellProps {
  collaborator: Collaborator;
  onLogout: () => void;
}

function Shell({ collaborator, onLogout }: ShellProps): JSX.Element {
  return (
    <div className="shell">
      <header className="topbar">
        <strong>Astro CMS</strong>
        <span className="spacer" />
        <span>{collaborator.name}</span>
        <button type="button" onClick={onLogout}>
          Sign out
        </button>
      </header>
      <main className="content">
        <RepositoryPanel />
        <p className="hint">Content editing is not built yet.</p>
      </main>
    </div>
  );
}
