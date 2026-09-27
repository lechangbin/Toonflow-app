import type { authorizeLegacyProductionContext } from "./legacyProductionContext";

type Context = NonNullable<Awaited<ReturnType<typeof authorizeLegacyProductionContext>>>;

/** A requested context switch blocks new legacy chats before its async authorization runs. */
export function createLegacyProductionContextGate(initial: Context) {
  let current = initial;
  let generation = 0;
  let enabled = true;
  let closed = false;
  return {
    begin(): number {
      if (closed) throw new Error("Legacy Production Socket is closed");
      enabled = false;
      return ++generation;
    },
    commit(ticket: number, next: Context | null): boolean {
      if (closed || ticket !== generation || !next) return false;
      current = next;
      enabled = true;
      return true;
    },
    chatContext(): Context | null {
      return enabled && !closed && current.scriptId !== null ? current : null;
    },
    close() {
      closed = true;
      enabled = false;
      generation++;
    },
  };
}
