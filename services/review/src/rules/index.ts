export {
  type Category,
  match,
  type MatchedPair,
  type MatchResult,
  normalise,
  type Placed,
} from './match.js';
export { RULES, type RuleId, type Severity } from './registry.js';
export { type Evidence, type Flag, type ItemRef, runRules, type RulesInput } from './rules.js';
export { band, score } from './score.js';
