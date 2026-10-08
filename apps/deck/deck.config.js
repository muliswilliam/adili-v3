/*
 * The deck's settings: how long each slide gets, and what each live app slide shows.
 *
 * Retiming: each talk length below lists minutes per slide id (the `data-id` of a <section> in
 * index.html). Open the deck with ?talk=25 to use another length. A length with no table here
 * scales the default table to fit, e.g. ?talk=20. A slide missing from a table gets 0 minutes and
 * the presenter view says so.
 *
 * Live app slides: `embeds` maps a slide's `data-embed` to the app, the demo account to sign in as
 * (a demo key from packages/demo-auth/src/accounts.ts; null for a public page) and the path to
 * open. `fallback` is the screenshot shown if the app does not load in time.
 */
window.DECK_CONFIG = {
  defaultTalk: '15',

  talks: {
    15: {
      title: 0.25,
      why: 2,
      how: 2.5,
      'demo-onboarding': 0.5,
      'demo-declaration': 2.5,
      'demo-clarifications': 0.75,
      'demo-actions': 0.5,
      'demo-form-m': 0.5,
      'demo-form-k-apply': 0.5,
      'demo-form-k-notify': 0.5,
      'demo-form-k-represent': 0.5,
      'demo-form-k-decide': 0.5,
      'demo-lea': 0.75,
      architecture: 1,
      'built-to-last': 1,
      closing: 0.75,
    },
    25: {
      title: 0.5,
      why: 4,
      how: 4.5,
      'demo-onboarding': 0.5,
      'demo-declaration': 4.5,
      'demo-clarifications': 1,
      'demo-actions': 0.5,
      'demo-form-m': 1,
      'demo-form-k-apply': 0.75,
      'demo-form-k-notify': 0.75,
      'demo-form-k-represent': 0.75,
      'demo-form-k-decide': 0.75,
      'demo-lea': 1,
      architecture: 1.5,
      'built-to-last': 1.5,
      closing: 1.5,
    },
  },

  /*
   * Where the apps are. Left null, they follow the page: on the demo host (the deck at
   * https://<host>/deck/) the portal is this origin and the console and verify are ports 3020 and
   * 3030; on localhost they are the dev servers (3010, 3020, 3030).
   */
  apps: { portal: null, console: null, verify: null },

  embeds: {
    'demo-onboarding': {
      app: 'portal',
      as: null,
      label: 'A new officer · signed out',
      path: '/get-started',
      fallback: 'shots/demo-onboarding.jpg',
    },
    'demo-declaration': {
      app: 'portal',
      as: 'wanjiku',
      label: 'Wanjiku Kamau · Declarant, KEMSA',
      path: '/declarations',
      fallback: 'shots/demo-declaration.jpg',
    },
    'demo-clarifications': {
      app: 'console',
      as: 'reviewer',
      label: 'Achieng Njeri · Reviewer, PSC',
      path: '/review',
      fallback: 'shots/demo-clarifications.jpg',
    },
    'demo-actions': {
      app: 'console',
      as: 'reviewer',
      label: 'Achieng Njeri · Reviewer, PSC',
      path: '/actions',
      fallback: 'shots/demo-actions.jpg',
    },
    'demo-form-m': {
      app: 'console',
      as: 'commission-admin',
      label: 'Mwangi Wairimu · Commission admin, PSC',
      path: '/form-m',
      fallback: 'shots/demo-form-m.jpg',
    },
    'demo-form-k-apply': {
      app: 'portal',
      as: 'applicant',
      label: 'Njoki Wambua · Applicant',
      path: '/access/requests',
      fallback: 'shots/demo-form-k-apply.jpg',
    },
    'demo-form-k-notify': {
      app: 'console',
      as: 'access-officer',
      label: 'Halima Yusuf · Access officer, PSC',
      path: '/access/requests',
      fallback: 'shots/demo-form-k-notify.jpg',
    },
    'demo-form-k-represent': {
      app: 'portal',
      as: 'wanjiku',
      label: 'Wanjiku Kamau · Declarant, KEMSA',
      path: '/access/notices',
      fallback: 'shots/demo-form-k-represent.jpg',
    },
    'demo-form-k-decide': {
      app: 'console',
      as: 'access-officer',
      label: 'Halima Yusuf · Access officer, PSC',
      path: '/access/requests',
      fallback: 'shots/demo-form-k-decide.jpg',
    },
    'demo-lea': {
      app: 'console',
      as: 'law-enforcement',
      label: 'Suleiman Ali · Law enforcement, DCI',
      path: '/lea/requests',
      fallback: 'shots/demo-lea.jpg',
    },
  },

  /* Seconds before a slide's time is up when its timer turns amber. */
  warnSeconds: 20,
  /* Seconds an app slide waits for the app before it shows the fallback screenshot. */
  embedTimeoutSeconds: 12,
};
