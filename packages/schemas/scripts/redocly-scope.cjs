// Redocly plugin for the published API reference (build-api-docs.mjs): keeps one side of a
// service's contract. `public` keeps the `/v1` (and `/open-data`) routes that portals, Commissions
// and agencies call (ADR-009); `internal` keeps the `/internal/v1` routes services call each other
// with (ADR-013).
module.exports = function adiliPlugin() {
  return {
    id: 'adili',
    decorators: {
      oas3: {
        scope: ({ keep }) => ({
          Paths: {
            leave(paths) {
              for (const path of Object.keys(paths)) {
                const internal = path.startsWith('/internal/');
                if ((keep === 'public') === internal) delete paths[path];
              }
            },
          },
        }),
      },
    },
  };
};
