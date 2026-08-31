/**
 * Typed failures for the configured-Vendor command seam. Callers (HTTP routes)
 * distinguish these by `instanceof` instead of matching message strings, so the
 * response contract survives message rewording.
 */

export class VendorConfigConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorConfigConflictError";
  }
}

export class VendorConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorConfigNotFoundError";
  }
}
