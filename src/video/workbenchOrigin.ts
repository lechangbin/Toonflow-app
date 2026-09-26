/** Browser workbench actions cannot impersonate a trusted Agent caller. */
export class WorkbenchAgentOriginRejectedError extends Error {
  constructor() { super("HTTP workbench requests cannot claim Project Agent origin"); }
}

export function assertWorkbenchUserOrigin(input: { requestedBy: string }): void {
  if (input.requestedBy !== "user") throw new WorkbenchAgentOriginRejectedError();
}
