/*
 * The presentation deck's engine: navigation, per-slide timers, live app slides and the
 * presenter view. Settings live in deck.config.js; slides are the <section>s in index.html.
 *
 * Keys (audience window): → / Space / PageDown next, ← / PageUp back, T start or pause the
 * timers, R reset them, H hide or show the audience timer, E app full screen, S presenter view,
 * F full screen. The presenter view drives the same deck from another window. ?offline shows
 * every app slide's fallback screenshot instead of the live app.
 */
(() => {
  const CONFIG = window.DECK_CONFIG;
  const params = new URLSearchParams(location.search);
  const isPresenter = params.has('presenter');
  const channel = new BroadcastChannel('adili-deck');
  const stage = document.getElementById('stage');
  const slides = [...document.querySelectorAll('section.slide')];

  /* ---------- Timing ---------- */

  const sum = (values) => values.reduce((total, value) => total + value, 0);

  /** Minutes per slide id for a talk length: its table, or the default table scaled to fit. */
  function budgetsFor(talk) {
    if (CONFIG.talks[talk]) return { table: CONFIG.talks[talk], scaled: false };
    const base = CONFIG.talks[CONFIG.defaultTalk];
    const minutes = Number(talk);
    if (!Number.isFinite(minutes) || minutes <= 0) return { table: base, scaled: false };
    const factor = minutes / sum(Object.values(base));
    const table = Object.fromEntries(
      Object.entries(base).map(([id, value]) => [id, value * factor]),
    );
    return { table, scaled: true };
  }

  const state = {
    talk: params.get('talk') || CONFIG.defaultTalk,
    index: 0,
    running: false,
    spent: {},
    timerHidden: params.has('notimer'),
  };
  let lastTick = performance.now();

  const ids = slides.map((slide) => slide.dataset.id);
  const budgetMs = () => {
    const { table } = budgetsFor(state.talk);
    return Object.fromEntries(ids.map((id) => [id, (table[id] ?? 0) * 60000]));
  };

  /** What the timers show for the current slide; the last slide counts down the whole talk. */
  function timing() {
    const budgets = budgetMs();
    const id = ids[state.index];
    const spentHere = state.spent[id] ?? 0;
    const total = sum(Object.values(budgets));
    const spentTotal = sum(Object.values(state.spent));
    const last = state.index === slides.length - 1;
    // Time saved (or lost) on the slides already left behind.
    const bank = sum(
      ids
        .slice(0, state.index)
        .filter((slideId) => state.spent[slideId] !== undefined)
        .map((slideId) => budgets[slideId] - state.spent[slideId]),
    );
    const budget = last ? total - (spentTotal - spentHere) : budgets[id];
    return {
      budget,
      remaining: budget - spentHere,
      fraction: budget > 0 ? Math.min(1, spentHere / budget) : 1,
      bank,
      total,
      talkRemaining: total - spentTotal,
      last,
      planned: budgets[id],
    };
  }

  function tick() {
    const now = performance.now();
    if (state.running) {
      const id = ids[state.index];
      state.spent[id] = (state.spent[id] ?? 0) + (now - lastTick);
    }
    lastTick = now;
    renderTimer();
    broadcast();
  }

  const fmt = (ms) => {
    const sign = ms < 0 ? '-' : '';
    const seconds = Math.round(Math.abs(ms) / 1000);
    return `${sign}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const signed = (ms) => (ms >= 0 ? `+${fmt(ms)}` : fmt(ms));

  function renderTimer() {
    if (isPresenter) return;
    const t = timing();
    const bar = document.getElementById('timerBar');
    const text = document.getElementById('timerText');
    bar.style.width = `${(state.running || t.fraction > 0 ? t.fraction : 0) * 100}%`;
    // Before the talk starts the slide's planned time shows; the last slide adds what was saved.
    const shown = state.running || state.spent[ids[state.index]] !== undefined;
    const saved =
      t.last && shown && Math.abs(t.bank) >= 1000
        ? `<small>${signed(t.bank)} carried over</small>`
        : '';
    text.innerHTML = `${fmt(shown ? t.remaining : t.budget)}${saved}`;
    document.body.classList.toggle(
      'warn',
      t.remaining <= CONFIG.warnSeconds * 1000 && t.remaining > 0 && state.running,
    );
    document.body.classList.toggle('late', t.remaining <= 0 && state.running);
    document.body.classList.toggle('timer-hidden', state.timerHidden);
  }

  /* ---------- Navigation ---------- */

  function fit() {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.setProperty('--s', scale);
  }

  function show(index) {
    // Credit the time so far to the slide being left, before the new one becomes current.
    tick();
    state.index = Math.max(0, Math.min(slides.length - 1, index));
    if (state.running) state.spent[ids[state.index]] ??= 0;
    slides.forEach((slide, i) => slide.classList.toggle('active', i === state.index));
    if (location.hash !== `#${state.index + 1}`) {
      history.replaceState(null, '', `${location.search}#${state.index + 1}`);
    }
    embeds.enter(state.index);
    tick();
  }

  function next() {
    if (!state.running && sum(Object.values(state.spent)) === 0) start();
    show(state.index + 1);
  }

  const prev = () => show(state.index - 1);

  function start() {
    lastTick = performance.now();
    state.running = true;
    state.spent[ids[state.index]] ??= 0;
    tick();
  }

  function toggle() {
    if (state.running) {
      tick();
      state.running = false;
    } else {
      start();
    }
    tick();
  }

  function reset() {
    state.spent = {};
    state.running = false;
    tick();
  }

  function setTalk(talk) {
    state.talk = String(talk);
    const url = new URL(location.href);
    url.searchParams.set('talk', state.talk);
    history.replaceState(null, '', url);
    tick();
  }

  /* ---------- Live app slides ---------- */

  const embeds = (() => {
    /** Origin of each app, from the config or from this page's address. */
    function appOrigin(app) {
      // ?portal=…&console=… point a rehearsal at other app servers.
      const override = params.get(app) || CONFIG.apps[app];
      if (override) return override.replace(/\/$/, '');
      const { protocol, hostname, port } = location;
      const devPorts = { portal: 3010, console: 3020, verify: 3030 };
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return `${protocol}//${hostname}:${devPorts[app]}`;
      }
      // The demo host: the deck is on the portal's origin; the console and verify have ports.
      if (app === 'portal') return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
      return `${protocol}//${hostname}:${devPorts[app]}`;
    }

    const appNames = { portal: 'Portal', console: 'Console', verify: 'Verify' };
    /** The demo account each app's session was last switched to by the deck. */
    const signedIn = {};
    const views = new Map();

    function build(slide, index) {
      const host = slide.querySelector('[data-embed]');
      if (!host) return;
      const spec = CONFIG.embeds[host.dataset.embed];
      if (!spec) {
        host.innerHTML = `<div class="placeholder">No embed called <b>${host.dataset.embed}</b> in deck.config.js</div>`;
        return;
      }
      host.classList.add('embed');
      host.innerHTML = `
        <div class="embed-bar">
          <span class="dots"><i></i><i></i><i></i></span>
          <span class="app">${appNames[spec.app] ?? spec.app}</span>
          <span class="who">${spec.label ?? spec.as}</span>
          <span class="spacer"></span>
          <button type="button" data-act="reload">Reload</button>
          <button type="button" data-act="full">Full screen</button>
        </div>
        <div class="embed-view">
          <iframe title="${appNames[spec.app] ?? spec.app} as ${spec.label ?? spec.as}" allow="fullscreen; clipboard-write"></iframe>
          <div class="embed-veil">Opening the ${appNames[spec.app] ?? spec.app} as ${spec.label ?? spec.as}</div>
          <div class="embed-fallback"${spec.fallback ? ` style="background-image:url('${spec.fallback}')"` : ''}><span>Offline copy</span></div>
        </div>`;
      const iframe = host.querySelector('iframe');
      const view = { host, spec, iframe, loadedAs: null, timer: null };
      iframe.addEventListener('load', () => {
        if (!iframe.src) return;
        clearTimeout(view.timer);
        setTimeout(() => host.classList.remove('loading'), 250);
      });
      host.querySelector('[data-act="reload"]').addEventListener('click', () => load(view, true));
      host.querySelector('[data-act="full"]').addEventListener('click', () => fullscreen(view));
      // A clicker's keys go to whatever has focus: take it back from the app when the pointer
      // leaves it, so the next click still moves the deck on.
      host.addEventListener('mouseleave', () => document.getElementById('focusSink').focus());
      views.set(index, view);
    }

    function target(spec) {
      const url = new URL('/auth/demo-enter', appOrigin(spec.app));
      url.searchParams.set('as', spec.as);
      url.searchParams.set('next', spec.path ?? '/');
      return url.toString();
    }

    /** Opens the view; the app's session is switched to the slide's account on the way. */
    function load(view, force = false) {
      const { spec, host, iframe } = view;
      // ?offline: the backup copy for a venue without the demo host; every app slide shows its
      // fallback screenshot and nothing is loaded.
      if (params.has('offline')) {
        host.classList.add('offline');
        return;
      }
      const fresh = view.loadedAs === spec.as && signedIn[spec.app] === spec.as;
      if (fresh && !force) return;
      host.classList.remove('offline');
      host.classList.add('loading');
      clearTimeout(view.timer);
      view.timer = setTimeout(() => {
        host.classList.remove('loading');
        if (spec.fallback) host.classList.add('offline');
      }, CONFIG.embedTimeoutSeconds * 1000);
      signedIn[spec.app] = spec.as;
      view.loadedAs = spec.as;
      iframe.src = target(spec);
    }

    function fullscreen(view) {
      if (document.fullscreenElement) document.exitFullscreen();
      else view.host.requestFullscreen?.();
    }

    document.addEventListener('fullscreenchange', () => {
      views.forEach(({ host }) => {
        host.querySelector('[data-act="full"]').textContent =
          document.fullscreenElement === host ? 'Exit full screen' : 'Full screen';
      });
    });

    return {
      init() {
        slides.forEach(build);
      },
      /** Loads the slide's view, and the next slide's if that cannot disturb this one. */
      enter(index) {
        const current = views.get(index);
        if (current) load(current);
        const following = views.get(index + 1);
        if (!following) return;
        const sameAppOtherAccount =
          current &&
          current.spec.app === following.spec.app &&
          current.spec.as !== following.spec.as;
        // One browser holds one session per app: preloading another account would sign the
        // visible view out from under the presenter.
        if (!sameAppOtherAccount) load(following);
      },
      fullscreenCurrent() {
        const view = views.get(state.index);
        if (view) fullscreen(view);
      },
    };
  })();

  /* ---------- Presenter view ---------- */

  function broadcast() {
    if (isPresenter) return;
    const t = timing();
    const slide = slides[state.index];
    channel.postMessage({
      type: 'state',
      talk: state.talk,
      talks: Object.keys(CONFIG.talks),
      scaled: budgetsFor(state.talk).scaled,
      index: state.index,
      count: slides.length,
      running: state.running,
      title: slide.dataset.title,
      nextTitle: slides[state.index + 1]?.dataset.title ?? 'End',
      notes: slide.querySelector('.notes')?.innerHTML ?? '',
      timing: t,
      plan: slides.map((s, i) => ({
        title: s.dataset.title,
        planned: budgetMs()[s.dataset.id],
        spent: state.spent[s.dataset.id] ?? null,
        current: i === state.index,
      })),
    });
  }

  function renderPresenter(message) {
    const root = document.getElementById('presenter');
    const t = message.timing;
    const clockClass =
      t.remaining <= 0 ? 'late' : t.remaining <= CONFIG.warnSeconds * 1000 ? 'warn' : '';
    const unbudgeted = message.plan.filter((row) => !row.planned).map((row) => row.title);
    root.querySelector('.slidename').textContent =
      `${message.index + 1}/${message.count} · ${message.title}`;
    const clock = root.querySelector('.clock');
    clock.textContent = fmt(t.remaining);
    clock.className = `clock ${clockClass}`;
    root.querySelector('.clock-cap').textContent = t.last
      ? `Last slide: the rest of the talk (${fmt(t.planned)} planned ${signed(t.bank)} carried over)`
      : `This slide (${fmt(t.planned)} planned)${message.running ? '' : ' · paused'}`;
    root.querySelector('.pills').innerHTML = `
      <div class="pill">Talk left<b>${fmt(t.talkRemaining)}</b></div>
      <div class="pill ${t.bank >= 0 ? 'good' : 'bad'}">Carried over<b>${signed(t.bank)}</b></div>
      <div class="pill">Talk<b>${message.talk} min${message.scaled ? ' (scaled)' : ''}</b></div>`;
    root.querySelector('.next').textContent = `Next: ${message.nextTitle}`;
    root.querySelector('.notes-view').innerHTML = message.notes || '<p>No notes.</p>';
    root.querySelector('.warning').textContent = unbudgeted.length
      ? `No time set for: ${unbudgeted.join(', ')}`
      : '';
    root.querySelector('.plan tbody').innerHTML = message.plan
      .map(
        (row) =>
          `<tr class="${row.current ? 'current' : ''}"><td>${row.title}</td><td class="num">${fmt(row.planned ?? 0)}</td><td class="num">${row.spent === null ? '' : fmt(row.spent)}</td></tr>`,
      )
      .join('');
    const select = root.querySelector('select');
    const options = [...new Set([...message.talks, message.talk])];
    if (select.dataset.options !== options.join(',')) {
      select.innerHTML = options
        .map((talk) => `<option value="${talk}">${talk} min</option>`)
        .join('');
      select.dataset.options = options.join(',');
    }
    select.value = message.talk;
    root.querySelector('[data-cmd="toggle"]').textContent = message.running ? 'Pause' : 'Start';
  }

  const send = (cmd, value) => channel.postMessage({ type: 'cmd', cmd, value });

  /* ---------- Wiring ---------- */

  function onKey(event) {
    const key = event.key;
    const act = (fn) => {
      event.preventDefault();
      fn();
    };
    const run = (cmd) => (isPresenter ? send(cmd) : commands[cmd]());
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(key)) act(() => run('next'));
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(key)) act(() => run('prev'));
    else if (key === 't' || key === 'T') act(() => run('toggle'));
    else if (key === 'r' || key === 'R') act(() => confirm('Reset the timers?') && run('reset'));
    else if ((key === 'h' || key === 'H') && !isPresenter) act(() => commands.hide());
    else if ((key === 'e' || key === 'E') && !isPresenter) act(() => embeds.fullscreenCurrent());
    else if ((key === 's' || key === 'S') && !isPresenter) {
      act(() =>
        window.open(
          `${location.pathname}?presenter`,
          'adili-deck-presenter',
          'width=1300,height=840',
        ),
      );
    } else if ((key === 'f' || key === 'F') && !isPresenter) {
      act(() =>
        document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen(),
      );
    }
  }

  const commands = {
    next,
    prev,
    toggle,
    reset,
    hide() {
      state.timerHidden = !state.timerHidden;
      renderTimer();
    },
    talk: setTalk,
    hello: broadcast,
  };

  document.addEventListener('keydown', onKey);

  if (isPresenter) {
    document.body.classList.add('presenter');
    const root = document.getElementById('presenter');
    root.querySelectorAll('[data-cmd]').forEach((button) =>
      button.addEventListener('click', () => {
        if (button.dataset.cmd === 'reset' && !confirm('Reset the timers?')) return;
        send(button.dataset.cmd);
      }),
    );
    root
      .querySelector('select')
      .addEventListener('change', (event) => send('talk', event.target.value));
    channel.onmessage = ({ data }) => {
      if (data.type === 'state') renderPresenter(data);
    };
    send('hello');
    return;
  }

  channel.onmessage = ({ data }) => {
    if (data.type === 'cmd' && commands[data.cmd]) commands[data.cmd](data.value);
  };

  embeds.init();
  window.addEventListener('resize', fit);
  document.fonts.ready.then(fit);
  fit();
  const fromHash = parseInt(location.hash.slice(1), 10);
  show(Number.isFinite(fromHash) ? fromHash - 1 : 0);
  setInterval(tick, 250);
})();
