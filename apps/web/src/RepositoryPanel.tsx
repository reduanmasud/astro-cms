import { useEffect, useState, type JSX } from "react";
import { getRepositoryStatus, type RepositoryStatus } from "./api.ts";

const EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; report: RepositoryStatus };

/** Shows whether GitHub is connected and the token has what the CMS needs. */
export function RepositoryPanel(): JSX.Element {
  const [state, setState] = useState<State>({ status: "loading" });

  // Bumping this re-runs the effect, which fetches the status again.
  const [checkCount, setCheckCount] = useState(0);

  useEffect(() => {
    getRepositoryStatus()
      .then((report) => setState({ status: "loaded", report }))
      .catch((error: Error) =>
        setState({ status: "error", message: error.message }),
      );
  }, [checkCount]);

  const load = (): void => {
    setState({ status: "loading" });
    setCheckCount((count) => count + 1);
  };

  return (
    <section className="card" aria-labelledby="repository-heading">
      <header className="card-header">
        <h2 id="repository-heading">GitHub repository</h2>
        <button
          type="button"
          onClick={load}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "Checking…" : "Check again"}
        </button>
      </header>
      {state.status === "loading" && <p className="hint">Checking GitHub…</p>}
      {state.status === "error" && <p role="alert">{state.message}</p>}
      {state.status === "loaded" && <Report report={state.report} />}
    </section>
  );
}

interface ReportProps {
  report: RepositoryStatus;
}

function Report({ report }: ReportProps): JSX.Element {
  const failed = report.checks.filter((check) => !check.ok).length;

  return (
    <>
      <p className="repo-line">
        <a href={report.url} target="_blank" rel="noreferrer">
          {report.fullName}
        </a>{" "}
        · base branch <code>{report.baseBranch}</code>
      </p>
      <p className={failed === 0 ? "summary ok" : "summary fail"}>
        {failed === 0
          ? "Connected. All checks passed."
          : `${failed} of ${report.checks.length} checks failed.`}
      </p>

      <dl className="stats">
        <Stat label="Latest commit" value={report.headSha?.slice(0, 7)} mono />
        <Stat label="Files" value={report.stats.files} />
        <Stat
          label="Markdown / MDX in src/"
          value={report.stats.contentFiles}
        />
        <Stat
          label="Open pull requests"
          value={
            report.stats.openPullRequests === null
              ? null
              : `${report.stats.openPullRequests} (${report.stats.openCmsPullRequests ?? 0} from CMS)`
          }
        />
        <Stat
          label="Token expires"
          value={formatExpiry(report.tokenExpiresAt)}
        />
      </dl>

      <ul className="checks">
        {report.checks.map((check) => (
          <li key={check.id} className={check.ok ? "ok" : "fail"}>
            <span className="mark" aria-hidden="true">
              {check.ok ? "✓" : "✗"}
            </span>
            <span>
              <strong>{check.label}</strong>
              <span className="sr-only">
                {check.ok ? " passed" : " failed"}
              </span>
              <br />
              <span className="hint">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        Checks only read from GitHub. A fine-grained token&apos;s write
        permission is confirmed the first time the CMS publishes.
      </p>
    </>
  );
}

interface StatProps {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}

function Stat({ label, value, mono = false }: StatProps): JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value ?? "—"}</dd>
    </div>
  );
}

function formatExpiry(iso: string | null): string {
  if (iso === null) return "No expiry reported";
  const expires = new Date(iso);
  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / DAY_MS);
  const date = expires.toLocaleDateString();
  if (daysLeft < 0) return `Expired ${date}`;
  return daysLeft <= EXPIRY_WARNING_DAYS
    ? `${date} (in ${daysLeft} days!)`
    : date;
}
