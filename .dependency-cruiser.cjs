/**
 * Module boundaries from ADR-012 / ADR-013, enforced in CI (`pnpm deps:check`).
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-service-to-service-imports',
      comment: 'Services talk through APIs, events and Temporal, never by importing each other.',
      severity: 'error',
      from: { path: '^services/([^/]+)/' },
      to: { path: '^services/([^/]+)/', pathNot: '^services/$1/' },
    },
    {
      name: 'packages-stay-generic',
      comment: 'Shared packages must not depend on services or apps.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(services|apps)/' },
    },
    {
      name: 'apps-use-apis-not-services',
      comment: 'Apps reach services over HTTP only.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^services/' },
    },
    {
      name: 'no-circular',
      comment:
        'Type-only cycles (e.g. generated route trees augmenting the router) erase at runtime.',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|\\.output|coverage|node_modules|migrations)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
    },
  },
};
