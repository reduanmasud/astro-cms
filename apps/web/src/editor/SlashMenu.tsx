import { useEffect, useState, type JSX } from "react";
import type { SlashCommandItem, SlashMenuState } from "./SlashCommand.ts";

export interface SlashMenuProps {
  state: SlashMenuState | null;
}

const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab"]);
const NO_ITEMS: readonly SlashCommandItem[] = [];

/**
 * The "/" command menu. While it is open it takes arrow keys, Enter, and Tab
 * before the editor sees them; Escape is handled by the extension.
 */
export function SlashMenu({ state }: SlashMenuProps): JSX.Element | null {
  const items = state?.items ?? NO_ITEMS;
  const signature = items.map((item) => item.id).join(",");

  // Reset the highlight when the list changes, without an extra render pass.
  const [selection, setSelection] = useState({ signature, index: 0 });
  const index = selection.signature === signature ? selection.index : 0;

  useEffect(() => {
    if (state === null || items.length === 0) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!NAVIGATION_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "ArrowDown") {
        setSelection({ signature, index: (index + 1) % items.length });
      } else if (event.key === "ArrowUp") {
        setSelection({
          signature,
          index: (index - 1 + items.length) % items.length,
        });
      } else {
        const item = items[index];
        if (item) state.select(item);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [state, items, signature, index]);

  if (state === null || items.length === 0) return null;

  return (
    <ul
      className="slash-menu"
      style={{
        top: (state.rect?.bottom ?? 0) + 6,
        left: state.rect?.left ?? 0,
      }}
      role="listbox"
      aria-label="Insert block"
    >
      {items.map((item: SlashCommandItem, position: number) => (
        <li key={item.id}>
          <button
            type="button"
            className={position === index ? "selected" : undefined}
            role="option"
            aria-selected={position === index}
            onMouseEnter={() => setSelection({ signature, index: position })}
            onClick={() => state.select(item)}
          >
            <strong>{item.title}</strong>
            <span className="hint">{item.hint}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
