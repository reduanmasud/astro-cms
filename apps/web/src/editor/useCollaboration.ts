import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { getCollabConnection, type CollabConnection } from "../api.ts";

export type CollabStatus =
  "checking" | "disabled" | "connecting" | "connected" | "offline";

export interface Collaboration {
  readonly status: CollabStatus;
  /** The shared document, once a room is open. */
  readonly doc: Y.Doc | null;
  readonly provider: HocuspocusProvider | null;
  /** True once the room's current state has arrived. */
  readonly synced: boolean;
}

/**
 * Opens the HocusPocus room for a draft, if the server has collaboration
 * configured (docs/adr/0016-collaboration-service.md). The provider reconnects
 * on its own; `status` follows it.
 */
export function useCollaboration(
  documentId: string,
  enabled: boolean,
): Collaboration {
  const [connection, setConnection] = useState<
    CollabConnection | null | undefined
  >(undefined);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<CollabStatus>(
    enabled ? "checking" : "disabled",
  );
  const [synced, setSynced] = useState(false);
  const [doc] = useState(() => new Y.Doc());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getCollabConnection(documentId)
      .then((result) => {
        if (cancelled) return;
        setConnection(result ?? null);
        setStatus(result ? "connecting" : "disabled");
      })
      .catch(() => {
        if (!cancelled) setStatus("disabled");
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, enabled]);

  useEffect(() => {
    if (!connection) return;

    const instance = new HocuspocusProvider({
      url: connection.url,
      name: connection.room,
      token: connection.token,
      document: doc,
      onStatus: ({ status: next }) => {
        setStatus(String(next) === "connected" ? "connected" : "connecting");
      },
      onSynced: () => setSynced(true),
      onDisconnect: () => {
        setSynced(false);
        setStatus("offline");
      },
    });
    queueMicrotask(() => setProvider(instance));

    return () => {
      instance.destroy();
      setProvider(null);
      setSynced(false);
    };
  }, [connection, doc]);

  return { status, doc: connection ? doc : null, provider, synced };
}
