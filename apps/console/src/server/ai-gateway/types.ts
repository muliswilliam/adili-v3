import type { components } from './api.gen';

type Schemas = components['schemas'];

export type DataClass = Schemas['DataClass'];
export type ProviderClass = Schemas['ProviderClass'];
export type GatePolicyInput = Schemas['GatePolicyInput'];
export type TenantPolicy = Schemas['TenantPolicy'];
export type GateRule = TenantPolicy['rules'][number];
export type Route = Schemas['Route'];
export type TaskName = Schemas['TaskName'];
export type BudgetInput = Schemas['BudgetInput'];
export type TenantUsage = Schemas['TenantUsage'];
