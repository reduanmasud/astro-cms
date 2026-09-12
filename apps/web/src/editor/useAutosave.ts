import { useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaveState {
  readonly status: SaveStatus;
  readonly message?: string;
}

export interface Autosave {
  readonly state: AutosaveState;
  /** Call after every change; saving happens once typing pauses. */
  readonly schedule: () => void;
  /** Saves immediately, e.g. before leaving the page. */
  readonly saveNow: () => void;
}

const DEFAULT_DELAY_MS = 1200;

/**
 * Debounced saving. One save runs at a time; changes made while saving are
 * written straight after.
 */
export function useAutosave(
  save: () => Promise<void>,
  delay = DEFAULT_DELAY_MS,
): Autosave {
  const [state, setState] = useState<AutosaveState>({ status: "idle" });
  const saveRef = useRef(save);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const runningRef = useRef(false);
  const againRef = useRef(false);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  async function run(): Promise<void> {
    if (runningRef.current) {
      againRef.current = true;
      return;
    }
    runningRef.current = true;
    setState({ status: "saving" });
    try {
      await saveRef.current();
      setState({ status: "saved" });
    } catch (error) {
      setState({ status: "error", message: (error as Error).message });
    } finally {
      runningRef.current = false;
      if (againRef.current) {
        againRef.current = false;
        void run();
      }
    }
  }

  function schedule(): void {
    setState({ status: "pending" });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void run(), delay);
  }

  function saveNow(): void {
    clearTimeout(timerRef.current);
    void run();
  }

  // Save one last time if the editor closes with unsaved changes.
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        void saveRef.current();
      }
    };
  }, []);

  return { state, schedule, saveNow };
}
