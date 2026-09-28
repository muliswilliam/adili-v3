export {
  type Category,
  match,
  type MatchedPair,
  type MatchResult,
  normalise,
  type PlacedItem,
} from './match.js';
export { RULES, type RuleId, type Severity } from './registry.js';
export { type Evidence, type Flag, type ItemRef, runRules, type RulesInput } from './rules.js';
export { type Band, band, score } from './score.js';
