/*
 * The deck's settings: how long each slide gets, and what each live app slide shows.
 *
 * Retiming: each talk length below lists minutes per slide id (the `data-id` of a <section> in
 * index.html). Open the deck with ?talk=25 to use another length. A length with no table here
 * scales the default table to fit, e.g. ?talk=20. A slide missing from a table gets 0 minutes and
 * the presenter view says so.
 *
 * Live app slides: `embeds` maps a slide's `data-embed` to the app, the demo account to sign in as
 * (a demo key from packages/demo-auth/src/accounts.ts) and the path to open. `fallback` is the
 * screenshot shown if the app does not load in time.
 */
window.DECK_CONFIG = {
  defaultTalk: '15',

  talks: {
    15: {
      title: 0.5,
      problem: 1.5,
      solution: 1,
      'demo-declarant': 3,
      'demo-commission': 3,
      'demo-eacc': 2.5,
      impact: 1.5,
      architecture: 1,
      'built-to-last': 1,
    },
    25: {
      title: 0.5,
      problem: 2.5,
      solution: 2,
      'demo-declarant': 5,
      'demo-commission': 5,
      'demo-eacc': 4.5,
      impact: 2.5,
      architecture: 1.5,
      'built-to-last': 1.5,
    },
  },

  /*
   * Where the apps are. Left null, they follow the page: on the demo host (the deck at
   * https://<host>/deck/) the portal is this origin and the console and verify are ports 3020 and
   * 3030; on localhost they are the dev servers (3010, 3020, 3030).
   */
  apps: { portal: null, console: null, verify: null },

  embeds: {
    'demo-declarant': {
      app: 'portal',
      as: 'otieno',
      label: 'Otieno Odhiambo · Declarant',
      path: '/access/history',
      fallback: 'shots/portal-access-history.jpg',
    },
    'demo-commission': {
      app: 'console',
      as: 'auditor',
      label: 'Kariuki Muriithi · Auditor, EACC',
      path: '/audit/integrity',
      fallback: 'shots/console-audit-integrity.jpg',
    },
    'demo-eacc': {
      app: 'console',
      as: 'platform-admin',
      label: 'Juma Omondi · Platform admin',
      path: '/ai-policy',
      fallback: 'shots/console-ai-policy.jpg',
    },
  },

  /* Seconds before a slide's time is up when its timer turns amber. */
  warnSeconds: 20,
  /* Seconds an app slide waits for the app before it shows the fallback screenshot. */
  embedTimeoutSeconds: 12,
};
