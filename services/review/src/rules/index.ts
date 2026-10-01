export {
  type Category,
  match,
  type MatchedPair,
  type MatchResult,
  normalise,
  type PlacedItem,
} from './match.js';
export {
  type ArdhisasaResult,
  type BrsResult,
  householdIds,
  type KraResult,
  matchRegistries,
  type NtsaResult,
  type PersonRegistryResults,
  REGISTRY_CHECK_STATUSES,
  REGISTRY_RULE_IDS,
  REGISTRY_RULE_SYSTEMS,
  REGISTRY_SYSTEMS,
  type RegistryCheck,
  type RegistryCheckStatus,
  type RegistryMatch,
  type RegistryMatchInput,
  type RegistryNote,
  type RegistryNoteKind,
  type RegistryRecords,
  type RegistryRelation,
  type RegistryRow,
  type RegistryRuleId,
  registryRows,
  registrySystemOf,
  type RegistrySystem,
  type SupplierCheckResult,
  type Unavailable,
} from './registry-checks.js';
export { RULES, type RuleId, SEVERITIES, type Severity } from './registry.js';
export { type Evidence, type Flag, type ItemRef, runRules, type RulesInput } from './rules.js';
export { type Band, band, BANDS, score } from './score.js';
