import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

export interface Peer {
  clientId: number;
  id: string;
  name: string;
  color: string;
}

/** Other people in the document right now (one entry per person, however many tabs they have open). */
export function usePeers(awareness: Awareness | null, selfId: string | undefined): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      return;
    }
    const read = () => {
      const seen = new Map<string, Peer>();
      for (const [clientId, state] of awareness.getStates()) {
        const user = (state as { user?: { id?: string; name?: string; color?: string } }).user;
        if (clientId === awareness.clientID || !user?.name) continue;
        const id = user.id || String(clientId);
        if (id === selfId || seen.has(id)) continue;
        seen.set(id, { clientId, id, name: user.name, color: user.color ?? "#8a8174" });
      }
      setPeers([...seen.values()]);
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [awareness, selfId]);
  return peers;
}
