import { useEffect, useState, type JSX } from "react";
import { getSession, logout, type Collaborator, type Session } from "./api.ts";
import { CollectionBrowser } from "./CollectionBrowser.tsx";
import { DisplayNameForm } from "./DisplayNameForm.tsx";
import { DocumentEditor } from "./editor/DocumentEditor.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { RepositoryPanel } from "./RepositoryPanel.tsx";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session };

/** Which screen the signed-in user is on. */
type View = { name: "browse" } | { name: "edit"; documentId: string };

export function App(): JSX.Element {
  const [state, setState] = useState<State>({ status: "loading" });
  const [view, setView] = useState<View>({ name: "browse" });

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
      setView({ name: "browse" });
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
          view={view}
          onView={setView}
          onLogout={() => void handleLogout()}
        />
      );
  }
}

interface ShellProps {
  collaborator: Collaborator;
  view: View;
  onView: (view: View) => void;
  onLogout: () => void;
}

function Shell({
  collaborator,
  view,
  onView,
  onLogout,
}: ShellProps): JSX.Element {
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
      {view.name === "edit" ? (
        <DocumentEditor
          documentId={view.documentId}
          collaboratorName={collaborator.name}
          onClose={() => onView({ name: "browse" })}
        />
      ) : (
        <main className="content">
          <CollectionBrowser
            onOpen={(documentId) => onView({ name: "edit", documentId })}
          />
          <RepositoryPanel />
        </main>
      )}
    </div>
  );
}
