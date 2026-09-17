import { useEffect, useRef, useState, type JSX } from "react";
import { getSession, logout, type Collaborator, type Session } from "./api.ts";
import { CollectionEntries } from "./CollectionEntries.tsx";
import { DisplayNameForm } from "./DisplayNameForm.tsx";
import { DocumentEditor } from "./editor/DocumentEditor.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { MediaLibrary } from "./media/MediaLibrary.tsx";
import { pathToView, viewToPath, type View } from "./route.ts";
import { RepositoryPanel } from "./RepositoryPanel.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { useTheme } from "./useTheme.ts";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session };

/** The collection a view belongs to, so reloading on it can restore both. */
function collectionOf(view: View): string | undefined {
  return view.name === "collection" || view.name === "edit"
    ? view.collectionName
    : undefined;
}

export function App(): JSX.Element {
  const [state, setState] = useState<State>({ status: "loading" });
  // Read once, from whatever URL the page loaded (or reloaded) on, so a
  // refresh in the editor or on Media/Status lands back where it was
  // instead of always resetting to browse.
  const [view, setView] = useState<View>(() =>
    pathToView(window.location.pathname),
  );
  // The sidebar stays on the last-chosen collection while Media/Status/Editor
  // are open on top of it, so closing one of those returns here rather than
  // to the bare "choose a collection" prompt.
  const [lastCollection, setLastCollection] = useState<string | undefined>(() =>
    collectionOf(pathToView(window.location.pathname)),
  );
  const [theme, toggleTheme] = useTheme();

  function goToCollection(collectionName: string): void {
    setLastCollection(collectionName);
    setView({ name: "collection", collectionName });
  }

  function goBackToBrowse(): void {
    setView(
      lastCollection !== undefined
        ? { name: "collection", collectionName: lastCollection }
        : { name: "browse" },
    );
  }

  // Keeps the URL in sync with `view` (so it can be reloaded or shared) in
  // both directions: pushes a new URL when `view` changes from in-app
  // navigation, and, via popstate, updates `view` when the browser's
  // back/forward buttons change the URL instead. The ref breaks the loop
  // that would otherwise cause: a popstate-driven `setView` would trigger
  // the push effect below, which would push right back the entry the user
  // just navigated away from.
  const fromPopState = useRef(false);
  useEffect(() => {
    const onPopState = (): void => {
      fromPopState.current = true;
      setView(pathToView(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (fromPopState.current) {
      fromPopState.current = false;
      return;
    }
    const path = viewToPath(view);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
  }, [view]);

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
      return (
        <main className="centered">
          <ThemeToggle theme={theme} onToggle={toggleTheme} floating />
          Loading…
        </main>
      );
    case "error":
      return (
        <main className="centered">
          <ThemeToggle theme={theme} onToggle={toggleTheme} floating />
          <p role="alert">Could not reach the CMS server: {state.message}</p>
        </main>
      );
    case "signed-out":
      return (
        <>
          <ThemeToggle theme={theme} onToggle={toggleTheme} floating />
          <LoginForm onSignedIn={signedIn} />
        </>
      );
    case "signed-in":
      return state.session.collaborator === null ? (
        <>
          <ThemeToggle theme={theme} onToggle={toggleTheme} floating />
          <DisplayNameForm
            onChosen={(collaborator) => signedIn({ collaborator })}
          />
        </>
      ) : (
        <Shell
          collaborator={state.session.collaborator}
          view={view}
          onView={setView}
          onSelectCollection={goToCollection}
          onBackToBrowse={goBackToBrowse}
          onLogout={() => void handleLogout()}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      );
  }
}

interface ShellProps {
  collaborator: Collaborator;
  view: View;
  onView: (view: View) => void;
  onSelectCollection: (collectionName: string) => void;
  onBackToBrowse: () => void;
  onLogout: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

function Shell({
  collaborator,
  view,
  onView,
  onSelectCollection,
  onBackToBrowse,
  onLogout,
  theme,
  onToggleTheme,
}: ShellProps): JSX.Element {
  return (
    <div className="app-shell">
      <Sidebar
        collaborator={collaborator}
        view={
          view.name === "collection"
            ? { name: "collection", collectionName: view.collectionName }
            : view.name === "edit"
              ? { name: "edit" }
              : view.name === "media"
                ? { name: "media" }
                : view.name === "status"
                  ? { name: "status" }
                  : { name: "collection", collectionName: "" }
        }
        onSelectCollection={onSelectCollection}
        onOpenMedia={() => onView({ name: "media" })}
        onOpenStatus={() => onView({ name: "status" })}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onCollectionsLoaded={(collections) => {
          const first = collections[0];
          if (view.name === "browse" && first !== undefined) {
            onSelectCollection(first.name);
          }
        }}
      />
      {view.name === "edit" ? (
        <DocumentEditor
          documentId={view.documentId}
          collaboratorName={collaborator.name}
          onClose={onBackToBrowse}
        />
      ) : view.name === "media" ? (
        <MediaLibrary onClose={onBackToBrowse} />
      ) : view.name === "status" ? (
        <RepositoryPanel onClose={onBackToBrowse} />
      ) : view.name === "collection" ? (
        <CollectionEntries
          key={view.collectionName}
          collectionName={view.collectionName}
          onOpen={(documentId) =>
            onView({
              name: "edit",
              documentId,
              collectionName: view.collectionName,
            })
          }
        />
      ) : (
        <main className="content">
          <p className="hint">Choose a collection from the sidebar.</p>
        </main>
      )}
    </div>
  );
}
