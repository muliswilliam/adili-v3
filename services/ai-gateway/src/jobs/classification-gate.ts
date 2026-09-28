import type { ProviderClass } from '../providers/port.js';
import type { DataClass } from './task-request.js';

/**
 * The classification gate's default policy (spec 07c): self-hosted providers may see every data
 * class; external providers see synthetic data only, so no real declaration leaves the platform
 * without a decision. Per-tenant policies that relax this with an approval reference are
 * spec 07c BE-3; until they land, this default applies to every tenant.
 */
export function gateAdmits(dataClass: DataClass, providerClass: ProviderClass): boolean {
  return providerClass === 'self-hosted' || dataClass === 'synthetic';
}
