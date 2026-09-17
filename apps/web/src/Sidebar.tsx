import { useEffect, useState, type JSX } from "react";
import {
  getCollections,
  getRepositoryStatus,
  type Collaborator,
  type CollectionSummary,
} from "./api.ts";
import { MediaIcon, SearchIcon } from "./Icons.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import type { Theme } from "./useTheme.ts";

type RepoTone = "loading" | "ok" | "warn";

interface RepoState {
  tone: RepoTone;
  label: string;
}

const CHECKING: RepoState = { tone: "loading", label: "Checking repository…" };

export type SidebarView =
  | { name: "collection"; collectionName: string }
  | { name: "media" }
  | { name: "status" }
  | { name: "edit" };

export interface SidebarProps {
  collaborator: Collaborator;
  view: SidebarView;
  onSelectCollection: (name: string) => void;
  onOpenMedia: () => void;
  onOpenStatus: () => void;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  /** Reports the loaded list up so the caller can auto-select the first one. */
  onCollectionsLoaded: (collections: CollectionSummary[]) => void;
}

/**
 * Persistent left navigator: every collection, plus Media and Repository
 * status, always one click away instead of buried in per-screen chrome
 * (docs: UX rethink, "Navigator" direction).
 */
export function Sidebar({
  collaborator,
  view,
  onSelectCollection,
  onOpenMedia,
  onOpenStatus,
  onLogout,
  theme,
  onToggleTheme,
  onCollectionsLoaded,
}: SidebarProps): JSX.Element {
  const [collections, setCollections] = useState<CollectionSummary[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [repo, setRepo] = useState<RepoState>(CHECKING);

  useEffect(() => {
    getCollections()
      .then((project) => {
        setCollections(project.collections);
        onCollectionsLoaded(project.collections);
      })
      .catch((caught: Error) => setError(caught.message));
    // onCollectionsLoaded is stable enough for a mount-only fetch; including
    // it would refetch on every App render, which the sidebar's own list
    // does not need.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getRepositoryStatus()
      .then((report) => {
        const failed = report.checks.filter((check) => !check.ok).length;
        setRepo(
          failed === 0
            ? { tone: "ok", label: "Connected" }
            : {
                tone: "warn",
                label: `${String(failed)} check${failed === 1 ? "" : "s"} failed`,
              },
        );
      })
      .catch(() => setRepo({ tone: "warn", label: "Could not reach GitHub" }));
  }, []);

  const filtered =
    collections?.filter((collection) =>
      collection.name.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];

  return (
    <aside className="sidebar" aria-label="Navigator">
      <div className="sidebar-brand">Astro CMS</div>

      <div className="sidebar-search search-field">
        <SearchIcon />
        <input
          type="search"
          aria-label="Filter collections"
          placeholder="Filter collections"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <nav aria-label="Collections" className="sidebar-section sidebar-collections">
        <div className="sidebar-heading">Collections</div>
        {error !== undefined && (
          <p className="hint" role="alert">
            {error}
          </p>
        )}
        {collections === undefined && error === undefined && (
          <p className="hint">Loading…</p>
        )}
        {collections !== undefined && filtered.length === 0 && (
          <p className="hint">
            {collections.length === 0 ? "No collections found." : "No matches."}
          </p>
        )}
        {filtered.map((collection) => (
          <button
            key={collection.name}
            type="button"
            className="nav-row"
            aria-current={
              view.name === "collection" && view.collectionName === collection.name
            }
            onClick={() => onSelectCollection(collection.name)}
          >
            <span className="nav-row-label">{collection.name}</span>
            <span className="nav-row-count">{collection.entryCount ?? "?"}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-divider" />

      <nav aria-label="Workspace" className="sidebar-section">
        <button
          type="button"
          className="nav-row"
          aria-current={view.name === "media"}
          onClick={onOpenMedia}
        >
          <MediaIcon />
          Media library
        </button>
        <button
          type="button"
          className="nav-row"
          aria-current={view.name === "status"}
          onClick={onOpenStatus}
        >
          <span
            className={`nav-row-dot nav-row-dot--${repo.tone}`}
            aria-hidden="true"
          />
          {repo.label}
        </button>
      </nav>

      <div className="sidebar-footer">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <span className="sidebar-name">{collaborator.name}</span>
        <button type="button" className="btn btn-ghost" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
