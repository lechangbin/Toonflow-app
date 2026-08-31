/**
 * The built-in Vendor registry is the single fact source for built-in Vendor
 * identity, release inclusion, and default-enable policy.
 *
 * It owns exactly three facts per entry and nothing else. Name, version,
 * inputs, Models, Video Capabilities, and Prompt Profiles stay in the Vendor
 * adapter sources under `data/vendor/`.
 *
 * Custom Vendors are never registry entries. `isBuiltInVendor()` returning
 * `false` only means "not a built-in"; it never rejects a Vendor.
 */

export interface BuiltInVendorRegistration {
  /** Stable Vendor id. It is also the adapter source file name and the `o_vendorConfig` primary key. */
  id: string;
  /** Whether this built-in Vendor ships in the current release. */
  released: boolean;
  /** Whether a fresh database enables this Vendor before the user configures it. */
  defaultEnabled: boolean;
}

/**
 * Entries with `released: false` are former built-ins. Repair deletes their
 * database rows and adapter sources from installations that predate their
 * removal, which is why they must remain declared here instead of in a
 * second list.
 */
export const BUILT_IN_VENDOR_REGISTRY: readonly BuiltInVendorRegistration[] = [
  { id: "agnes", released: true, defaultEnabled: false },
  { id: "atlascloud", released: false, defaultEnabled: false },
  { id: "deepseek", released: true, defaultEnabled: false },
  { id: "grsai", released: false, defaultEnabled: false },
  { id: "klingai", released: false, defaultEnabled: false },
  { id: "minimax", released: true, defaultEnabled: false },
  { id: "null", released: false, defaultEnabled: false },
  { id: "openai", released: false, defaultEnabled: false },
  { id: "toonflow", released: false, defaultEnabled: false },
  { id: "vidu", released: false, defaultEnabled: false },
  { id: "volcengine", released: true, defaultEnabled: false },
  { id: "volcengineSd2", released: true, defaultEnabled: false },
];

export interface VendorRegistry {
  registrations(): readonly BuiltInVendorRegistration[];
  builtInVendorIds(): string[];
  releasedVendorRegistrations(): BuiltInVendorRegistration[];
  releasedVendorIds(): string[];
  defaultEnabledVendorIds(): string[];
  unreleasedBuiltInVendorIds(): string[];
  releasedVendorSourceFileNames(): string[];
  isBuiltInVendor(id: string): boolean;
  isReleasedBuiltInVendor(id: string): boolean;
}

export function createVendorRegistry(registrations: readonly BuiltInVendorRegistration[]): VendorRegistry {
  const byId = new Map(registrations.map((registration) => [registration.id, registration]));
  const isReleased = (registration: BuiltInVendorRegistration) => registration.released;

  return {
    registrations: () => registrations,
    builtInVendorIds: () => registrations.map((registration) => registration.id),
    releasedVendorRegistrations: () => registrations.filter(isReleased),
    releasedVendorIds: () => registrations.filter(isReleased).map((registration) => registration.id),
    defaultEnabledVendorIds: () =>
      registrations.filter((registration) => isReleased(registration) && registration.defaultEnabled).map((r) => r.id),
    unreleasedBuiltInVendorIds: () =>
      registrations.filter((registration) => !isReleased(registration)).map((registration) => registration.id),
    releasedVendorSourceFileNames: () =>
      registrations.filter(isReleased).map((registration) => `${registration.id}.ts`),
    isBuiltInVendor: (id) => byId.has(id),
    isReleasedBuiltInVendor: (id) => byId.get(id)?.released === true,
  };
}

export const vendorRegistry = createVendorRegistry(BUILT_IN_VENDOR_REGISTRY);

export const builtInVendorIds = vendorRegistry.builtInVendorIds;
export const releasedVendorIds = vendorRegistry.releasedVendorIds;
export const defaultEnabledVendorIds = vendorRegistry.defaultEnabledVendorIds;
export const unreleasedBuiltInVendorIds = vendorRegistry.unreleasedBuiltInVendorIds;
export const releasedVendorSourceFileNames = vendorRegistry.releasedVendorSourceFileNames;
export const isBuiltInVendor = vendorRegistry.isBuiltInVendor;
export const isReleasedBuiltInVendor = vendorRegistry.isReleasedBuiltInVendor;
