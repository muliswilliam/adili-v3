import type { components } from './api.gen';

type Schemas = components['schemas'];

export type DataClass = Schemas['DataClass'];
export type ProviderClass = Schemas['ProviderClass'];
export type GatePolicyInput = Schemas['GatePolicyInput'];
export type TenantPolicy = Schemas['TenantPolicy'];
export type GateRuleInput = Schemas['GateRuleInput'];
export type GateRule = Schemas['GateRule'];
export type GatePolicyList = Schemas['GatePolicyList'];
export type Route = Schemas['Route'];
export type RouteInput = Schemas['RouteInput'];
export type TaskName = Schemas['TaskName'];
export type BudgetInput = Schemas['BudgetInput'];
export type TenantUsage = Schemas['TenantUsage'];
export type UsageList = Schemas['UsageList'];
