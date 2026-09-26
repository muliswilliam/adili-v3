/*
 * PROTOTYPE KIT - throwaway. Shared script for the clickable HTML prototypes under apps/<app>/prototype.
 * Not production code. Exposes a global `Kit`.
 *
 * Usage in a prototype file:
 *   <link rel="stylesheet" href="../../../packages/ui/prototype/kit.css" />
 *   <script src="../../../packages/ui/prototype/kit.js"></script>
 *   <script>
 *     const S = Kit.state({ ...your state });            // S is the single in-memory state object
 *     Kit.mount({ screens, modals, actions, jumps, coverage, app: 'console', start: 'home' });
 *   </script>
 *
 * Conventions:
 *   data-act="name" data-arg="x"  -> actions[name](arg, el, event) on click (built-ins: go, closeModal, toast, modal, copy, menu)
 *   data-bind="a.b.c"             -> two-way binds an input/select/textarea/checkbox/radio to S.a.b.c
 *   data-rerender                 -> re-render after a bound change (radios always re-render)
 *   data-live                     -> re-render on every keystroke (use sparingly, e.g. search boxes)
 *   data-act-change="name"        -> actions[name](el, event) on change (file inputs)
 *   Kit.otp('path', 'actionName') -> 6-box code input; calls actions[actionName]() when complete
 *   Screens receive no args and read S. Modals are rendered from S.modal = { kind, ... } via modals[kind]().
 *   Kit.go('screen', params) sets S.screen and S.params and updates location.hash (#screen), so files can deep-link each other.
 */
(function () {
  const I = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    building:
      '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    shield:
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    finger:
      '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12a10 10 0 0 1 18-6M2 16h.01M21.8 16c.2-2 .131-5.354 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2"/>',
    user: '<circle cx="12" cy="8" r="4.5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
    msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    wallet:
      '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    pin: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    trend: '<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>',
    banknote:
      '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    arrowIn: '<path d="M17 7 7 17M17 17H7V7"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    sparkles:
      '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    trash:
      '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    pencil:
      '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
    heart:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    globe:
      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
    cloud:
      '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 14 2 2 4-4"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.02l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.02.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
    baby: '<path d="M9 12h.01M15 12h.01M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
    laptop:
      '<path d="M18 5a2 2 0 0 1 2 2v8.53a2 2 0 0 0 .21.9l1.07 2.14A1 1 0 0 1 20.38 20H3.62a1 1 0 0 1-.9-1.43l1.07-2.14a2 2 0 0 0 .21-.9V7a2 2 0 0 1 2-2z"/><path d="M20.05 15.95H3.95"/>',
    table:
      '<path d="M12 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    moreV:
      '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
    refresh:
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    pause:
      '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    play: '<path d="m6 3 14 9-14 9z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    external:
      '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    settings:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    inbox:
      '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    gavel:
      '<path d="m14.5 12.5-8 8a2.12 2.12 0 1 1-3-3l8-8"/><path d="m16 16 6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
    scale:
      '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    compare:
      '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    listCheck: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    server:
      '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    userPlus:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    userX:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5M22 8l-5 5"/>',
    userCheck:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
    swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
    eyeOff:
      '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    pieChart: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    sort: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
    arrowUp: '<path d="m5 12 7-7 7 7M12 19V5"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    minus: '<path d="M5 12h14"/>',
    dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
    stamp:
      '<path d="M5 22h14M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/>',
    briefcase:
      '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    coins:
      '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
    timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    archive:
      '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"/>',
    printer:
      '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    wifiOff:
      '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M2 2l20 20"/>',
  };
  const icon = (n, s = 18, sw = 1.8) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`;
  const logo = (h = 24, act = 'goHome') =>
    `<a class="logo" ${act ? `data-act="${act}"` : ''} aria-label="Dials home" style="font-size:${h}px"><svg width="${h * 0.95}" height="${h}" viewBox="0 0 19 20"><path fill="currentColor" d="M0 2.5A2.5 2.5 0 0 1 2.5 0H9a10 10 0 0 1 0 20H2.5A2.5 2.5 0 0 1 0 17.5V13h5V7H0Z"/><rect x="7.5" y="7" width="5" height="6" rx="1" fill="#fff"/></svg><span style="line-height:1;margin-top:-0.08em">ials</span></a>`;

  /* ---------- helpers ---------- */
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const fmtDate = (d) => {
    if (!d) return '-';
    const x = new Date(d);
    return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
  };
  const fmtDateTime = (d) => {
    const x = new Date(d);
    return `${fmtDate(x)}, ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  };
  const num = (n) => Number(n || 0).toLocaleString('en-KE');
  const money = (n, cur = 'KES') => `${cur} ${num(n)}`;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const TODAY = new Date('2026-09-26T10:30:00');
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const relDays = (d) => {
    const n = daysBetween(TODAY, d);
    return n === 0
      ? 'today'
      : n > 0
        ? `in ${n} day${n > 1 ? 's' : ''}`
        : `${-n} day${n < -1 ? 's' : ''} ago`;
  };
  const setPath = (obj, path, val) => {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  };
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  let uid = 1000;
  const id = (p = 'x') => p + uid++;
  function qr(seed = 7, size = 112, alt = 'QR code') {
    if (typeof seed === 'string')
      seed = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 233280, 7) || 7;
    let s = seed;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const n = 25;
    let cells = '';
    const finder = (x, y) =>
      `<rect x="${x}" y="${y}" width="7" height="7" fill="#1a1a1a"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#1a1a1a"/>`;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
        if (!inF && rnd() > 0.52) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="${esc(alt)}"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><g fill="#1a1a1a">${cells}</g>${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
  }

  /* ---------- state ---------- */
  let S = null;
  const fid = (bind) => 'f-' + bind.replace(/[^a-zA-Z0-9]/g, '-');

  /* ---------- form templates ---------- */
  const field = (label, control, { hint = '', opt = false, id: forId = '', error = '' } = {}) => {
    if (forId && (hint || error) && control.includes(`id="${forId}"`))
      control = control.replace(
        `id="${forId}"`,
        `id="${forId}" aria-describedby="${forId}-hint"${error ? ' aria-invalid="true"' : ''}`,
      );
    return `<div class="field"><label class="label" ${forId ? `for="${forId}"` : ''}><span>${label}</span>${opt ? '<span class="opt">Optional</span>' : ''}</label>${control}${error ? `<div class="hint" id="${forId}-hint" role="alert" style="color:var(--danger);font-weight:500">${error}</div>` : hint ? `<div class="hint" id="${forId}-hint">${hint}</div>` : ''}</div>`;
  };
  const input = (bind, { ph = '', type = 'text', cls = '', extra = '', val } = {}) => {
    const v = val !== undefined ? val : getPath(S, bind);
    return `<input id="${fid(bind)}" class="input ${cls}" type="${type}" data-bind="${bind}" value="${esc(v)}" placeholder="${esc(ph)}" ${extra}/>`;
  };
  const textarea = (bind, { ph = '', rows = 5, cls = '', extra = '' } = {}) =>
    `<textarea id="${fid(bind)}" class="textarea ${cls}" rows="${rows}" data-bind="${bind}" placeholder="${esc(ph)}" ${extra}>${esc(getPath(S, bind))}</textarea>`;
  const select = (
    bind,
    options,
    { ph = 'Select', cls = '', rerender = false, extra = '' } = {},
  ) => {
    const v = getPath(S, bind);
    const opts = options.map((o) => (typeof o === 'string' ? { v: o, l: o } : o));
    return `<select id="${fid(bind)}" class="select ${cls}" data-bind="${bind}" ${rerender ? 'data-rerender' : ''} ${extra}>${ph ? `<option value="" ${!v ? 'selected' : ''} disabled>${esc(ph)}</option>` : ''}${opts.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
  };
  const choices = (bind, options, cols = 'c3', { tiles = false, rerender = true } = {}) => {
    const v = getPath(S, bind);
    return `<div class="choices ${cols}" role="radiogroup">${options
      .map((o) => {
        const val = typeof o === 'string' ? o : o.k;
        const lab = typeof o === 'string' ? o : o.label;
        return `<label class="choice ${tiles ? 'tile' : ''}"><input type="radio" name="${bind}" value="${esc(val)}" data-bind="${bind}" ${rerender ? 'data-rerender' : ''} ${val === v ? 'checked' : ''}/>${tiles ? `<span class="tile-ico">${icon(o.icon, 17)}</span>` : '<span class="dot"></span>'}<span>${esc(lab)}${o.sub ? `<div class="hint" style="font-weight:400;margin-top:2px">${esc(o.sub)}</div>` : ''}</span></label>`;
      })
      .join('')}</div>`;
  };
  const checkbox = (bind, label, { disabled = false, sub = '' } = {}) =>
    `<label class="check"><input type="checkbox" data-bind="${bind}" data-rerender ${getPath(S, bind) ? 'checked' : ''} ${disabled ? 'disabled' : ''}/><span class="box">${icon('check', 14, 3)}</span><span>${label}${sub ? `<div class="hint" style="margin-top:2px">${sub}</div>` : ''}</span></label>`;
  const otp = (bind, done) => {
    const vals = getPath(S, bind);
    return `<div class="otp" role="group" aria-label="6-digit code" data-otp="${bind}" data-done="${done}">${vals.map((v, i) => `${i === 3 ? '<span class="sep"></span>' : ''}<input id="${fid(bind)}-${i}" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Digit ${i + 1} of 6" data-otp-i="${i}" value="${esc(v)}"/>`).join('')}</div>`;
  };
  const badge = (text, kind = '') =>
    `<span class="badge ${kind ? 'badge-' + kind : ''}">${text}</span>`;
  const empty = (title, text, { icon: ic = 'inbox', action = '' } = {}) =>
    `<div class="empty" style="padding:40px 20px"><div class="art" style="grid-template-columns:30px"><span style="background:var(--sunken);color:var(--muted)">${icon(ic, 16)}</span></div><h4>${title}</h4><p>${text}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
  const skeletonRows = (n = 5, cols = 5) =>
    Array.from(
      { length: n },
      () =>
        `<tr>${Array.from({ length: cols }, (_, i) => `<td><span class="skeleton" style="width:${[70, 55, 40, 60, 35][i % 5]}%"></span></td>`).join('')}</tr>`,
    ).join('');
  const dialog = ({
    title,
    sub = '',
    icon: ic = null,
    tint = ['var(--sunken)', 'var(--ink)'],
    body,
    foot,
    wide = false,
  }) =>
    `<div class="overlay" data-act="closeModalBg"><div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${wide ? 'style="max-width:720px"' : ''}><div class="grabber"></div><div class="dialog-head">${ic ? `<span class="avatar" style="border-radius:10px;background:${tint[0]};color:${tint[1]}">${icon(ic, 18)}</span>` : ''}<div style="flex:1"><h3>${title}</h3>${sub ? `<p class="small muted" style="margin-top:3px">${sub}</p>` : ''}</div><button class="btn btn-ghost icon-btn" data-act="closeModal" aria-label="Close">${icon('x', 18)}</button></div><div class="dialog-body">${body}</div>${foot ? `<div class="dialog-foot">${foot}</div>` : ''}</div></div>`;
  const drawer = ({ title, sub = '', body, foot = '', wide = false, head = '' }) =>
    `<div class="drawer-ov" data-act="closeModalBg"><aside class="drawer ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="drawer-head"><div style="flex:1;min-width:0"><h3>${title}</h3>${sub ? `<p class="small muted" style="margin-top:3px">${sub}</p>` : ''}${head}</div><button class="btn btn-ghost icon-btn" data-act="closeModal" aria-label="Close">${icon('x', 18)}</button></div><div class="drawer-body">${body}</div>${foot ? `<div class="drawer-foot">${foot}</div>` : ''}</aside></div>`;

  /* ---------- tooltip ----------
   * Kit.tip(text, { icon: 'info' }) -> small info icon with a native + styled tooltip (keyboard focusable).
   */
  const tip = (text, { icon: ic = 'info', label = 'More information' } = {}) =>
    `<span class="kit-tip" tabindex="0" role="img" aria-label="${esc(label)}: ${esc(text)}" data-tip="${esc(text)}">${icon(ic, 14)}</span>`;

  /* ---------- pagination ----------
   * Kit.pager({ page, pageSize, total, act, sizes, sizeBind, label, hasNext })
   *   page: 1-based current page; total: item count (omit/null for cursor lists -> Previous/Next only)
   *   act: action name called with the target page number as its arg (actions[act](page))
   *   sizes + sizeBind: optional rows-per-page select bound to a state path (e.g. 'q.pageSize'); re-renders on change
   *   label: noun for the cursor range text (default 'items'); hasNext: cursor lists only, false disables Next
   *   count: cursor lists only, rows on this page (clamps the range end on a short last page)
   *   key: optional list key for screens with several pagers; the action then receives 'key|page'
   * Slice your data yourself: rows.slice((page - 1) * pageSize, page * pageSize).
   */
  function pager({
    page = 1,
    pageSize = 20,
    total = null,
    act = 'page',
    sizes = null,
    sizeBind = '',
    label = 'items',
    hasNext = null,
    count = null,
    key = '',
  } = {}) {
    page = Number(page) || 1;
    pageSize = Number(pageSize) || 20;
    const cursor = total == null;
    const pages = cursor ? null : Math.max(1, Math.ceil(total / pageSize));
    const from = !cursor && total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = cursor
      ? count != null
        ? (page - 1) * pageSize + count
        : page * pageSize
      : Math.min(total, page * pageSize);
    const next = cursor ? hasNext !== false : page < pages;
    const range = cursor
      ? `Showing ${num(from)}-${num(to)} ${label}`
      : `${num(from)}-${num(to)} of ${num(total)}`;
    const btn = (p, lab, aria, on = false, dis = false) =>
      `<button class="pg ${on ? 'on' : ''}" ${dis ? 'disabled' : `data-act="${act}" data-arg="${key ? key + '|' : ''}${p}"`} ${on ? 'aria-current="page"' : ''} aria-label="${aria}">${lab}</button>`;
    let nums = '';
    if (!cursor && pages > 1) {
      const set = new Set([1, pages, page - 1, page, page + 1].filter((x) => x >= 1 && x <= pages));
      if (page <= 3) [2, 3, 4].forEach((x) => x <= pages && set.add(x));
      if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((x) => x >= 1 && set.add(x));
      let prev = 0;
      nums = [...set]
        .sort((a, b) => a - b)
        .map((x) => {
          const gap = x - prev > 1 ? '<span class="pg-gap" aria-hidden="true">…</span>' : '';
          prev = x;
          return gap + btn(x, num(x), `Page ${x}`, x === page);
        })
        .join('');
    }
    const sizeSel =
      sizes && sizeBind
        ? `<label class="pg-size"><span>Rows</span><select class="select" data-bind="${sizeBind}" data-rerender aria-label="Rows per page">${sizes.map((z) => `<option ${z === pageSize ? 'selected' : ''}>${z}</option>`).join('')}</select></label>`
        : '';
    return `<nav class="pager" aria-label="Pagination"><span class="pg-range">${range}</span><span class="spacer"></span>${sizeSel}${btn(page - 1, icon('left', 16), 'Previous page', false, page <= 1)}<span class="pg-nums">${nums}</span>${!cursor && pages > 1 ? `<span class="pg-compact">Page ${num(page)} of ${num(pages)}</span>` : ''}${btn(page + 1, icon('right', 16), 'Next page', false, !next)}</nav>`;
  }

  /* ---------- console shell ---------- */
  // Personas for the staff console. Persisted across files in localStorage.
  const PERSONAS = {
    'platform-admin': {
      name: 'Amina Wanjiru',
      role: 'Platform administrator',
      org: 'EACC · Platform',
      code: 'EACC',
      initials: 'AW',
    },
    'eacc-analyst': {
      name: 'Brian Otieno',
      role: 'EACC analyst',
      org: 'Ethics and Anti-Corruption Commission',
      code: 'EACC',
      initials: 'BO',
    },
    'eacc-supervisor': {
      name: 'Esther Chebet',
      role: 'EACC supervisor',
      org: 'Ethics and Anti-Corruption Commission',
      code: 'EACC',
      initials: 'EC',
    },
    'reporting-officer': {
      name: 'Grace Muthoni',
      role: 'Reporting officer',
      org: 'Public Service Commission',
      code: 'PSC',
      initials: 'GM',
    },
    'commission-admin': {
      name: 'Daniel Kiprop',
      role: 'Commission administrator',
      org: 'Public Service Commission',
      code: 'PSC',
      initials: 'DK',
    },
    reviewer: {
      name: 'Faith Achieng',
      role: 'Reviewer',
      org: 'Public Service Commission',
      code: 'PSC',
      initials: 'FA',
    },
    supervisor: {
      name: 'Samuel Njoroge',
      role: 'Supervisor',
      org: 'Public Service Commission',
      code: 'PSC',
      initials: 'SN',
    },
  };
  // Console navigation. href = '<file>#<screen>'. Files live in apps/console/prototype/.
  const CONSOLE_NAV = [
    {
      group: 'Platform',
      items: [
        {
          label: 'Commissions',
          icon: 'building',
          href: '01-commissions.prototype.html#commissions',
          roles: ['platform-admin', 'eacc-analyst', 'eacc-supervisor'],
        },
        {
          label: 'National obligations',
          icon: 'chart',
          href: '04-obligations.prototype.html#national',
          roles: ['platform-admin', 'eacc-analyst', 'eacc-supervisor'],
        },
        {
          label: 'Integrations',
          icon: 'plug',
          href: '07b-registry.prototype.html#integrations',
          roles: ['platform-admin'],
        },
      ],
    },
    {
      group: 'EACC',
      items: [
        {
          label: 'Compliance reports',
          icon: 'inbox',
          href: '09-form-m.prototype.html#intake',
          roles: ['eacc-analyst', 'eacc-supervisor'],
        },
        {
          label: 'Referrals received',
          icon: 'flag',
          href: '09-form-m.prototype.html#referrals',
          roles: ['eacc-analyst', 'eacc-supervisor'],
        },
      ],
    },
    {
      group: 'Commission',
      items: [
        {
          label: 'Overview',
          icon: 'home',
          href: '01-commissions.prototype.html#my-commission',
          roles: ['reporting-officer', 'commission-admin', 'reviewer', 'supervisor'],
        },
        {
          label: 'Roster',
          icon: 'users',
          href: '02-roster.prototype.html#overview',
          roles: ['reporting-officer', 'commission-admin'],
        },
        {
          label: 'API access',
          icon: 'key',
          href: '02-roster.prototype.html#api-access',
          roles: ['reporting-officer', 'commission-admin'],
        },
        {
          label: 'Obligations',
          icon: 'calendar',
          href: '04-obligations.prototype.html#obligations',
          roles: ['reporting-officer', 'commission-admin', 'reviewer', 'supervisor'],
        },
      ],
    },
    {
      group: 'Review',
      items: [
        {
          label: 'Review queue',
          icon: 'listCheck',
          href: '07a-review.prototype.html#queue',
          roles: ['reviewer', 'supervisor'],
        },
        {
          label: 'Clarifications',
          icon: 'msg',
          href: '07a-review.prototype.html#clarifications',
          roles: ['reviewer', 'supervisor'],
        },
        {
          label: 'Approvals',
          icon: 'stamp',
          href: '08-determinations.prototype.html#approvals',
          roles: ['reviewer', 'supervisor'],
        },
        {
          label: 'Actions',
          icon: 'gavel',
          href: '08-determinations.prototype.html#actions',
          roles: ['reviewer', 'supervisor'],
        },
        {
          label: 'Bulk closure',
          icon: 'archive',
          href: '08-determinations.prototype.html#bulk',
          roles: ['supervisor'],
        },
        {
          label: 'Referrals',
          icon: 'flag',
          href: '08-determinations.prototype.html#referrals',
          roles: ['reviewer', 'supervisor'],
        },
      ],
    },
    {
      group: 'Reporting',
      items: [
        {
          label: 'Form M',
          icon: 'file',
          href: '09-form-m.prototype.html#form-m',
          roles: ['supervisor', 'commission-admin', 'reporting-officer'],
        },
      ],
    },
  ];
  const persona = () =>
    localStorage.getItem('dials-proto-persona') || Kit.cfg.defaultPersona || 'reporting-officer';
  function consoleShell(body, { active = '', crumbs = [], actions = '' } = {}) {
    const p = PERSONAS[persona()] || PERSONAS['reporting-officer'];
    const file = location.pathname.split('/').pop();
    const groups = CONSOLE_NAV.map((g) => ({
      ...g,
      items: g.items.filter((it) => it.roles.includes(persona())),
    })).filter((g) => g.items.length);
    const nav = groups
      .map(
        (g) =>
          `<div class="cnav-group">${g.group}</div><nav class="cnav">${g.items
            .map((it) => {
              const [f, h] = it.href.split('#');
              const on = active ? active === it.label : f === file && h === S.screen;
              const count = Kit.cfg.navCounts?.[it.label];
              return `<a class="${on ? 'on' : ''}" href="${f === file ? '#' + h : it.href}" ${f === file ? `data-act="go" data-arg="${h}"` : ''}>${icon(it.icon, 17)}<span>${it.label}</span>${count ? `<span class="count">${count}</span>` : ''}</a>`;
            })
            .join('')}</nav>`,
      )
      .join('');
    const side = `<aside class="cside ${S.navOpen ? 'open' : ''}">
      <div style="padding:4px 8px 0">${logo(22, '')}<span class="badge" style="margin-left:8px;vertical-align:4px;height:20px;font-size:11px">Console</span></div>
      <div class="tenant"><span class="mono-badge">${p.code}</span><div style="min-width:0"><div class="t truncate">${p.org}</div><div class="s">${p.role}</div></div></div>
      ${nav}
      <div class="cside-foot"><a class="cside-me" href="${file === 'profile.prototype.html' ? '#profile' : 'profile.prototype.html#profile'}" ${file === 'profile.prototype.html' ? 'data-act="go" data-arg="profile"' : ''} title="Your profile"><span class="avatar sm">${p.initials}</span><div style="min-width:0;flex:1"><div style="font-weight:500" class="truncate">${p.name}</div><div class="muted" style="font-size:12px">${p.role}</div></div></a><button class="btn btn-ghost icon-btn" title="Sign out" data-act="toast" data-arg="Signed out (prototype)">${icon('logout', 17)}</button></div>
    </aside>${S.navOpen ? '<div class="cside-scrim" data-act="toggleNav"></div>' : ''}`;
    const cr = crumbs.length
      ? `<div class="crumbs">${crumbs.map((c, i) => (i === crumbs.length - 1 ? `<span class="cur truncate">${c[0]}</span>` : `<a data-act="go" data-arg="${c[1]}">${c[0]}</a>${icon('right', 14)}`)).join('')}</div>`
      : '';
    return `<div class="cshell">${side}<div class="cmain"><header class="ctop"><button class="btn btn-ghost icon-btn menu-btn" data-act="toggleNav" aria-label="Menu">${icon('menu', 19)}</button><span class="ctop-logo">${logo(20, '')}</span>${cr}<span class="spacer"></span>${actions}<button class="btn btn-ghost icon-btn" data-act="toast" data-arg="Notifications would open here" aria-label="Notifications">${icon('bell', 18)}</button></header>${body}</div></div>`;
  }

  /* ---------- portal shell (declarant) ---------- */
  // Portal files live in apps/portal/prototype/.
  const PORTAL_NAV = [
    ['Home', 'home', 'declarant-journey.prototype.html#home'],
    ['Declarations', 'file', 'declarant-journey.prototype.html#declarations'],
    ['Clarifications', 'msg', 'declarant-after-submission.prototype.html#clarifications'],
    ['Notices', 'bell', 'declarant-after-submission.prototype.html#notices'],
  ];
  function portalShell(body, { active = 'Home', tabbar = true, counts = {} } = {}) {
    const file = location.pathname.split('/').pop();
    const link = ([l, ic, href], cls) => {
      const [f, h] = href.split('#');
      return `<a class="${active === l ? 'on' : ''} ${cls || ''}" href="${f === file ? '#' + h : href}" ${f === file ? `data-act="go" data-arg="${h}"` : ''}>${icon(ic, cls ? 21 : 17)}${cls ? `<span>${l}</span>` : ` ${l}`}${counts[l] ? `<span class="count">${counts[l]}</span>` : ''}</a>`;
    };
    return `<div class="pshell"><header class="topbar">${logo(22, '')}<nav class="nav">${PORTAL_NAV.map((n) => link(n)).join('')}</nav><div class="spacer"></div><div class="lang row" style="gap:4px"><button class="btn btn-ghost btn-sm" data-act="toast" data-arg="Kiswahili would switch the whole portal">${icon('globe', 16)} English</button></div><button class="btn btn-ghost icon-btn" data-act="toast" data-arg="Help centre would open here" aria-label="Help">${icon('help', 19)}</button>${(() => {
      const f = 'declarant-profile.prototype.html';
      const here = location.pathname.split('/').pop() === f;
      return `<a class="avatar" style="margin-left:4px;text-decoration:none" href="${here ? '#profile' : f + '#profile'}" ${here ? 'data-act="go" data-arg="profile"' : ''} aria-label="Your profile" title="Your profile">JK</a>`;
    })()}</header><div class="pbody">${body}</div>${tabbar ? `<nav class="tabbar" style="grid-template-columns:repeat(${PORTAL_NAV.length},1fr)">${PORTAL_NAV.map((n) => link(n, 'tab')).join('')}</nav>` : ''}</div>`;
  }

  /* ---------- mount / render ---------- */
  const Kit = {
    I,
    icon,
    logo,
    esc,
    fmtDate,
    fmtDateTime,
    num,
    money,
    pct,
    TODAY,
    daysBetween,
    relDays,
    setPath,
    getPath,
    id,
    qr,
    field,
    input,
    textarea,
    select,
    choices,
    checkbox,
    otp,
    badge,
    empty,
    skeletonRows,
    pager,
    tip,
    dialog,
    drawer,
    PERSONAS,
    CONSOLE_NAV,
    PORTAL_NAV,
    persona,
    consoleShell,
    portalShell,
    cfg: {},
    state(obj) {
      S = Object.assign(
        {
          screen: null,
          params: {},
          modal: null,
          toast: null,
          toastErr: false,
          menu: null,
          navOpen: false,
        },
        obj,
      );
      Kit.S = S;
      return S;
    },
    get S() {
      return S;
    },
  };
  Object.defineProperty(Kit, 'S', {
    get: () => S,
    set: (v) => {
      S = v;
    },
    configurable: true,
  });
  let view, layer, cfg;

  let rendering = false;
  function render() {
    if (rendering) {
      queueMicrotask(render);
      return;
    }
    rendering = true;
    try {
      renderNow();
    } finally {
      rendering = false;
    }
  }
  function renderNow() {
    const scroll = view.scrollTop;
    const ae = document.activeElement;
    const focusId = ae?.id;
    let sel = null;
    try {
      sel = ae?.selectionStart;
    } catch (e) {}
    const scr = cfg.screens[S.screen] || cfg.screens[cfg.start];
    view.innerHTML = scr();
    const modal = S.modal && cfg.modals?.[S.modal.kind] ? cfg.modals[S.modal.kind]() : '';
    const mk = S.modal ? S.modal.kind : null;
    if (mk && mk === renderNow.lastKind) layer.setAttribute('data-stay', '');
    else layer.removeAttribute('data-stay');
    renderNow.lastKind = mk;
    layer.innerHTML =
      modal +
      (S.toast
        ? `<div class="toast" role="status" aria-live="polite">${S.toastErr ? `<span style="color:#ffb48f;display:flex">${icon('alert', 16, 2.2)}</span>` : icon('check', 16, 2.4)} ${esc(S.toast)}</div>`
        : '');
    view.scrollTop = scroll;
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        try {
          if (sel != null && el.setSelectionRange && !['number', 'email', 'date'].includes(el.type))
            el.setSelectionRange(sel, sel);
        } catch (e) {}
      }
    }
    renderProto();
    cfg.afterRender?.();
  }
  function go(screen, params = {}) {
    S.screen = screen;
    S.params = params || {};
    S.modal = null;
    S.menu = null;
    S.navOpen = false;
    S._jump = Kit._jumping || null;
    history.replaceState(null, '', '#' + screen);
    render();
    view.scrollTop = 0;
    const first = document.querySelector('#view .otp input');
    if (first) first.focus();
  }
  function toast(msg, err) {
    S.toastErr =
      err ??
      /^(Enter|Wait|That file|Could not|Cannot|Can't|Failed|Error|Select|Choose|Add at least|\d+ files? (is|are) over)/.test(
        msg,
      );
    S.toast = msg;
    render();
    clearTimeout(toast.t);
    toast.t = setTimeout(() => {
      S.toast = null;
      render();
    }, 2400);
  }
  const builtins = {
    go: (a) => {
      const [scr, p] = String(a).split('|');
      go(scr, p ? { id: p } : {});
    },
    goHome: () => {
      if (cfg.home) go(cfg.home);
    },
    closeModal: () => {
      if (S.modal?.busy) return;
      S.modal = null;
      render();
    },
    closeModalBg: (a, el, e) => {
      if (e.target === el) builtins.closeModal();
    },
    modal: (a) => {
      const [kind, p] = String(a).split('|');
      S.modal = { kind, id: p };
      render();
    },
    toast: (a) => toast(a),
    copy: (a) => {
      navigator.clipboard?.writeText(a).catch(() => {});
      toast('Copied');
    },
    menu: (a) => {
      S.menu = S.menu === a ? null : a;
      render();
    },
    toggleNav: () => {
      S.navOpen = !S.navOpen;
      render();
    },
  };

  function onOtp(e) {
    const el = e.target;
    const wrap = el.closest('[data-otp]');
    const arr = getPath(S, wrap.dataset.otp);
    const i = +el.dataset.otpI;
    const digits = el.value.replace(/\D/g, '');
    if (digits.length > 1)
      digits
        .slice(0, 6 - i)
        .split('')
        .forEach((d, k) => (arr[i + k] = d));
    else arr[i] = digits;
    const inputs = wrap.querySelectorAll('input');
    inputs.forEach((inp, k) => (inp.value = arr[k] || ''));
    const nextEmpty = arr.findIndex((x) => !x);
    if (nextEmpty === -1) {
      inputs[5].blur();
      const done = wrap.dataset.done;
      setTimeout(() => {
        const code = arr.join('');
        arr.fill('');
        (cfg.actions[done] || builtins[done])?.(code);
      }, 220);
    } else if (digits) inputs[Math.min(nextEmpty, 5)].focus();
  }

  function mount(c) {
    cfg = c;
    Kit.cfg = c;
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div id="app"><div id="view"></div><div id="layer"></div></div><div id="proto" class="proto"></div>',
    );
    view = document.getElementById('view');
    layer = document.getElementById('layer');
    const app = document.getElementById('app');
    if (localStorage.getItem('dials-proto-mobile') === '1') document.body.classList.add('mobile');
    const hash = location.hash.slice(1);
    S.screen = hash && c.screens[hash] ? hash : c.start;
    const act = (name) => c.actions?.[name] || builtins[name];
    app.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) {
        if (S.menu && !e.target.closest('.menu')) {
          S.menu = null;
          render();
        }
        return;
      }
      if (el.disabled || el.classList.contains('is-disabled')) return;
      if (el.tagName === 'A' && el.dataset.act) e.preventDefault();
      if (S.menu && el.dataset.act !== 'menu') S.menu = null;
      act(el.dataset.act)?.(el.dataset.arg, el, e);
    });
    app.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.otpI !== undefined) return onOtp(e);
      if (!el.dataset.bind || el.type === 'radio' || el.type === 'checkbox') return;
      let v = el.value;
      if (el.dataset.money !== undefined) {
        // Keep up to 2 decimals: "1,250,000.50" -> "1250000.50".
        const clean = v.replace(/[^\d.]/g, '');
        const [whole, ...rest] = clean.split('.');
        const dec = rest.length ? '.' + rest.join('').slice(0, 2) : '';
        v = whole + dec;
        const pos = el.selectionStart;
        const before = el.value.length;
        el.value = whole || dec ? (whole ? Number(whole).toLocaleString('en-KE') : '0') + dec : '';
        const p = Math.max(0, pos + (el.value.length - before));
        el.setSelectionRange(p, p);
      }
      setPath(S, el.dataset.bind, v);
      c.onBind?.(el.dataset.bind, v);
      if (el.dataset.live !== undefined) render();
      else renderProto();
    });
    app.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.actChange) return act(el.dataset.actChange)?.(el, e);
      if (!el.dataset.bind) return;
      const v = el.type === 'checkbox' ? el.checked : el.value;
      setPath(S, el.dataset.bind, v);
      c.onBind?.(el.dataset.bind, v);
      if (el.hasAttribute('data-rerender') || el.type === 'radio') render();
      else renderProto();
    });
    app.addEventListener('keydown', (e) => {
      const el = e.target;
      if (el.dataset?.otpI !== undefined && e.key === 'Backspace' && !el.value) {
        const prev = el.parentElement.querySelectorAll('input')[+el.dataset.otpI - 1];
        if (prev) {
          prev.focus();
          prev.value = '';
        }
      }
      if (e.key === 'Escape') {
        if (S.modal) builtins.closeModal();
        else if (S.menu) {
          S.menu = null;
          render();
        }
      }
      if (e.key === 'Tab' && S.modal) {
        const box = layer.querySelector('[role=dialog]');
        if (!box) return;
        const f = [
          ...box.querySelectorAll(
            'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
          ),
        ].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (!box.contains(document.activeElement)) {
          e.preventDefault();
          f[0].focus();
          return;
        }
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    });
    // Fixed-position tooltip for Kit.tip (never clipped by scrolling panes). Files with their own tooltip set cfg.ownTooltips.
    if (!c.ownTooltips) {
      const box = document.createElement('div');
      box.id = 'kit-tipbox';
      box.setAttribute('aria-hidden', 'true');
      document.body.appendChild(box);
      const show = (t) => {
        box.textContent = t.dataset.tip;
        box.classList.add('show');
        const r = t.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        let x = r.left + r.width / 2 - b.width / 2;
        x = Math.max(8, Math.min(x, window.innerWidth - b.width - 8));
        let y = r.top - b.height - 8;
        if (y < 8) y = r.bottom + 8;
        box.style.left = x + 'px';
        box.style.top = y + 'px';
      };
      const hide = () => box.classList.remove('show');
      document.addEventListener('mouseover', (e) => {
        const t = e.target.closest?.('.kit-tip');
        if (t) show(t);
      });
      document.addEventListener('mouseout', (e) => {
        if (e.target.closest?.('.kit-tip')) hide();
      });
      document.addEventListener('focusin', (e) => {
        const t = e.target.closest?.('.kit-tip');
        if (t) show(t);
        else hide();
      });
      document.addEventListener('focusout', hide);
      document.addEventListener('scroll', hide, true);
    }
    document.getElementById('proto').addEventListener('change', (e) => {
      if (e.target.id === 'jump') {
        const v = e.target.value;
        const j = (c.jumps || []).find((x) => x[0] === v);
        Kit._jumping = v;
        try {
          if (j && j[2]) j[2]();
          else go(v);
        } finally {
          Kit._jumping = null;
        }
        S._jump = v;
        renderProto();
      }
      if (e.target.id === 'persona') {
        localStorage.setItem('dials-proto-persona', e.target.value);
        c.onPersona?.(e.target.value);
        render();
      }
    });
    document.getElementById('proto').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const p = b.dataset.p;
      if (p === 'desktop' || p === 'mobile') {
        document.body.classList.toggle('mobile', p === 'mobile');
        localStorage.setItem('dials-proto-mobile', p === 'mobile' ? '1' : '0');
        render();
      }
      if (p === 'state') {
        S._panel = S._panel === 'state' ? null : 'state';
        renderProto();
      }
      if (p === 'cov') {
        S._panel = S._panel === 'cov' ? null : 'cov';
        renderProto();
      }
      if (p === 'reset') {
        c.reset ? c.reset() : location.reload();
      }
      if (p === 'jumpcov') {
        S._panel = null;
        const v = b.dataset.arg;
        const j = (c.jumps || []).find((x) => x[0] === v);
        Kit._jumping = v;
        try {
          if (j && j[2]) j[2]();
          else go(v);
        } finally {
          Kit._jumping = null;
        }
        S._jump = v;
        renderProto();
      }
    });
    render();
  }
  function renderProto() {
    const el = document.getElementById('proto');
    if (!el) return;
    const jumps = cfg.jumps || [];
    const mobile = document.body.classList.contains('mobile');
    const cov = cfg.coverage || [];
    const stateDump = () => {
      const { modal, toast: t, _panel, _jump, ...rest } = S;
      return esc(
        JSON.stringify({ ...rest, modal }, (k, v) => (k === 'toastErr' ? undefined : v), 2),
      );
    };
    el.innerHTML = `<span class="tag">PROTOTYPE</span>
      <a href="../../../packages/ui/prototype/index.html" title="All prototypes">All</a>
      ${
        cfg.app === 'console'
          ? `<select id="persona" aria-label="Persona">${Object.entries(PERSONAS)
              .map(
                ([k, v]) =>
                  `<option value="${k}" ${k === persona() ? 'selected' : ''}>${v.role}</option>`,
              )
              .join('')}</select>`
          : ''
      }
      <select id="jump" aria-label="Jump to screen">${jumps.map(([k, l]) => `<option value="${k}" ${k === (S._jump || S.screen) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <button data-p="desktop" class="${mobile ? '' : 'on'}">Desktop</button><button data-p="mobile" class="${mobile ? 'on' : ''}">Mobile</button>
      ${cov.length ? `<button data-p="cov" class="${S._panel === 'cov' ? 'on' : ''}">Tickets</button>` : ''}
      <button data-p="state" class="${S._panel === 'state' ? 'on' : ''}">State</button><button data-p="reset">Reset</button>
      ${S._panel === 'state' ? `<pre class="panel">${stateDump()}</pre>` : ''}
      ${
        S._panel === 'cov'
          ? `<div class="panel"><h4>Tickets covered in this file</h4><div class="cov">${cov
              .map(
                (t) =>
                  `<div><b>#${t.ticket}</b> ${esc(t.title)}<div>${(t.screens || [])
                    .map((s) => {
                      const j = jumps.find((x) => x[0] === s);
                      return `<a data-p="jumpcov" data-arg="${s}">${esc(j ? j[1] : s)}</a>`;
                    })
                    .join(
                      '',
                    )}</div>${t.note ? `<div style="color:#aaa;margin-top:4px">${esc(t.note)}</div>` : ''}</div>`,
              )
              .join('')}</div></div>`
          : ''
      }`;
  }
  Object.assign(Kit, { mount, render, go, toast, builtins });
  window.Kit = Kit;
})();
