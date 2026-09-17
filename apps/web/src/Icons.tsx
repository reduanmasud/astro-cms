import type { JSX } from "react";

/**
 * Small, purpose-specific inline icons (from the design canvas's stroke-icon
 * set): each one names the exact action it sits next to, never decoration.
 */

export function SearchIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4" />
    </svg>
  );
}

export function MediaIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4" />
    </svg>
  );
}

export function ChevronRightIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function PlusIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function LinkIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  );
}

export function BulletListIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  );
}

export function QuoteIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 18V6M9 8h10M9 12h10M9 16h6" />
    </svg>
  );
}

export function ChevronLeftIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function DetailsIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16v14H4zM15 5v14" />
    </svg>
  );
}

export function CodeIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
    </svg>
  );
}

export function CheckIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function WarningIcon(): JSX.Element {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />
    </svg>
  );
}
