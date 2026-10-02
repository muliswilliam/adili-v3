export const REGISTRY_URLS = Symbol('REGISTRY_URLS');

/** Base URLs of the registries, each ending before `/v1` (the mocks serve them under `/<system>`). */
export interface RegistryUrls {
  kra: string;
  ntsa: string;
  brs: string;
  ardhisasa: string;
  /** HR, for employers' supplier lists. */
  hr: string;
}
