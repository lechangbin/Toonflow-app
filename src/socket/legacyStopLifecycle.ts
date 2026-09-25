/** Compatibility-only Socket lifecycle. A stop request gets a server event, not a UI guess. */
export function createLegacyStopLifecycle() {
  let active: { controller: AbortController; message: { stop(): void } } | null = null;
  return {
    start(controller: AbortController, message: { stop(): void }) {
      if (active) {
        const previous = active;
        active = null;
        previous.controller.abort();
        previous.message.stop();
      }
      active = { controller, message };
    },
    stop(): boolean {
      if (!active) return false;
      const previous = active;
      active = null;
      previous.controller.abort();
      previous.message.stop();
      return true;
    },
    finish(controller: AbortController) {
      if (active?.controller === controller) active = null;
    },
  };
}
