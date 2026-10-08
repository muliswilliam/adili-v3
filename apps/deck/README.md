# Presentation deck

A static deck served by the demo host at `https://<host>/deck/` (Caddy, `infra/azure/Caddyfile.cloudapp`). It sits on the portal's origin so its live app slides share the apps' sign-in; the apps and Keycloak let only that origin frame them (`DEMO_FRAME_ANCESTORS`).

| File | What to change there |
|---|---|
| `index.html` | Slides: one `<section class="slide" data-id="…" data-title="…">` each, with presenter notes in `<aside class="notes">` |
| `deck.config.js` | Minutes per slide for each talk length, and what each live app slide shows |
| `deck.css`, `deck.js` | Look and engine; no need to touch for content |

## Retiming

`talks` in `deck.config.js` has a table of minutes per slide id for each length (15 and 25 today). Open the deck with `?talk=25`, or switch in the presenter view. A length without a table scales the default one (`?talk=20`).

Each slide counts down its own minutes. The last slide counts down the rest of the talk, so time saved earlier is there to use and overruns come off it. The audience sees only a hairline at the bottom and a faint time in the corner (H hides both); the presenter view (S) shows the full picture.

## Live app slides

```html
<div data-embed="demo-declaration"></div>
```

```js
'demo-declaration': { app: 'portal', as: 'wanjiku', label: 'Wanjiku Kamau · Declarant, KEMSA', path: '/declarations', fallback: 'shots/declarations.jpg' },
```

`as: null` opens a public page (onboarding) as is. Otherwise the frame opens `<app>/auth/demo-enter?as=<demo key>&next=<path>`, which signs in as that demo account (recorded in the audit trail like any demo switch) and lands on the view. A browser holds one session per app, so the deck preloads the next slide's view only when that cannot sign out the one on screen. If the app does not load within `embedTimeoutSeconds`, the fallback screenshot shows. `?offline` shows every fallback without loading anything: the backup when the venue cannot reach the demo host.

On stage: E (or the button) puts the app full screen. After clicking into an app, move the pointer off it before using a clicker: the deck takes focus back when the pointer leaves the app.

## Rehearsing locally

Serve this folder and point it at your app servers:

```
python3 -m http.server 3140 -d apps/deck
open 'http://localhost:3140/?portal=http://localhost:3010&console=http://localhost:3020'
```

The apps need `DEMO_MODE=true` and `DEMO_FRAME_ANCESTORS=http://localhost:3140`; Keycloak needs the same origin (`DEMO_FRAME_ANCESTORS=http://localhost:3140 pnpm keycloak:demo-sign-in`).
