/* ============================================================
   Gridiron — NFL & College Football Game & Score Tracker
   Data source: ESPN public scoreboard APIs via backend proxy
   ============================================================ */
(() => {
  'use strict';

  const POLL_MS = 30000;
  const PHASE_LABEL = { 1: 'Preseason', 2: 'Regular', 3: 'Postseason' };
  const STATE_LABEL = { pre: 'Scheduled', in: 'Live', post: 'Final' };

  const NFL_DIVISIONS = {
    'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'],
    'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
    'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
    'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
    'NFC East': ['DAL', 'NYG', 'PHI', 'WSH'],
    'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
    'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
    'NFC West': ['ARI', 'LAR', 'SF', 'SEA']
  };

  const API = '';

  /* ---------------- State ---------------- */
  const state = {
    league: 'nfl', // 'nfl' | 'cfb'
    games: new Map(), // id -> game
    teams: [],
    teamMap: new Map(),
    selectedTeam: 'ALL',
    phase: 'all',
    view: 'calendar',
    cursor: startOfMonth(new Date()),
    lastUpdated: null,
    loading: true,
    error: false,
    pollTimer: null,
  };

  /* ---------------- Auth State ---------------- */
  let authToken = localStorage.getItem('gridiron_auth') || '';

  /* ---------------- DOM refs ---------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const el = {
    // Auth Elements
    loginScreen: $('#login-screen'),
    loginForm: $('#login-form'),
    loginInput: $('#login-password'),
    loginError: $('#login-error'),
    appContent: $('#app-content'),
    logoutBtn: $('[data-logout-btn]'),

    // App Elements
    liveGrid: $('[data-live-grid]'),
    livePlaceholder: $('[data-live-placeholder]'),
    teamFilter: $('[data-team-filter]'),
    viewPanels: {
      calendar: $('[data-view-panel="calendar"]'),
      list: $('[data-view-panel="list"]'),
      standings: $('[data-view-panel="standings"]'),
    },
    calGrid: $('[data-cal-grid]'),
    calTitle: $('[data-cal-title]'),
    calPrev: $('[data-cal-prev]'),
    calNext: $('[data-cal-next]'),
    calToday: $('[data-cal-today]'),
    listBody: $('[data-list-body]'),
    standingsBody: $('[data-standings-body]'),
    standingsTab: $('[data-standings-tab]'),
    phaseFilter: $('[data-phase-filter]'),
    phasePre: $('[data-phase-pre]'),
    updated: $('[data-updated]'),
    updatedText: $('[data-updated-text]'),
    modal: $('[data-game-modal]'),
    modalContent: $('[data-modal-content]'),
    cardTmpl: $('#game-card-tmpl'),
    leagueTabs: $$('[data-league-tab]'),
  };

  /* ---------------- Theme ---------------- */
  (() => {
    const root = document.documentElement;
    const toggle = $('[data-theme-toggle]');
    let mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.setAttribute('data-theme', mode);
    const icon = (m) =>
      m === 'dark'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    toggle.innerHTML = icon(mode);
    toggle.addEventListener('click', () => {
      mode = mode === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', mode);
      toggle.setAttribute('aria-label', 'Switch to ' + (mode === 'dark' ? 'light' : 'dark') + ' mode');
      toggle.innerHTML = icon(mode);
    });
  })();

  /* ---------------- Date helpers ---------------- */
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function fmtTime(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function fmtDate(d) { return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
  function relTime(date) {
    const s = Math.round((Date.now() - date) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.floor(m / 60) + 'h ago';
  }

  /* ---------------- Auth & API Data Fetching ---------------- */
  async function apiGet(path) {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Authorization': authToken },
      cache: 'no-store'
    });
    if (res.status === 401) {
      handleLogout();
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function handleLogout() {
    authToken = '';
    localStorage.removeItem('gridiron_auth');
    el.loginScreen.hidden = false;
    el.appContent.hidden = true;
    if (state.pollTimer) clearInterval(state.pollTimer);
  }

  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.loginError.hidden = true;
    const password = el.loginInput.value;
    
    try {
      const res = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      
      if (data.success) {
        authToken = data.token;
        localStorage.setItem('gridiron_auth', authToken);
        el.loginScreen.hidden = true;
        el.appContent.hidden = false;
        el.loginInput.value = '';
        boot(); // start the app
      } else {
        el.loginError.hidden = false;
      }
    } catch (err) {
      el.loginError.textContent = 'Connection error.';
      el.loginError.hidden = false;
    }
  });

  if (el.logoutBtn) el.logoutBtn.addEventListener('click', handleLogout);

  async function loadFullSchedule() {
    const data = await apiGet(`/api/schedule?league=${state.league}`);
    state.games.clear();
    for (const g of data.games) state.games.set(g.id, { ...g, date: new Date(g.date) });
    buildTeamList();
  }

  function buildTeamList() {
    const teamMap = new Map();
    for (const g of state.games.values()) {
      for (const t of [g.away, g.home]) {
        if (!t.abbr || t.abbr === 'TBD') continue;
        const existing = teamMap.get(t.abbr);
        if (!existing || g.date > existing.lastGameDate) {
          teamMap.set(t.abbr, { 
            abbr: t.abbr, name: t.name, color: t.color, logo: t.logo, 
            id: t.id, record: t.record, lastGameDate: g.date 
          });
        }
      }
    }
    
    const teams = Array.from(teamMap.values());
    teams.sort((a, b) => a.name.localeCompare(b.name));
    state.teams = teams;
    state.teamMap = new Map(teams.map((t) => [t.abbr, t]));

    const sel = el.teamFilter;
    const current = state.selectedTeam;
    sel.innerHTML = '<option value="ALL">All Teams</option>' +
      teams.map((t) => `<option value="${t.abbr}">${t.name}</option>`).join('');
    sel.value = teams.some((t) => t.abbr === current) ? current : 'ALL';
    state.selectedTeam = sel.value;
  }

  async function pollLive() {
    try {
      const data = await apiGet(`/api/live?league=${state.league}`);
      for (const g of data.games) state.games.set(g.id, { ...g, date: new Date(g.date) });
      markUpdated();
      buildTeamList();
      render();
    } catch {
      markUpdated();
    }
  }

  function markUpdated() {
    state.lastUpdated = new Date();
    el.updated.hidden = false;
    el.updatedText.textContent = 'Updated ' + relTime(state.lastUpdated);
  }

  /* ---------------- Filtering ---------------- */
  function visibleGames() {
    const team = state.selectedTeam;
    const phase = state.phase;
    let list = [...state.games.values()];
    if (phase !== 'all') list = list.filter((g) => g.phase === Number(phase));
    if (team !== 'ALL') {
      list = list.filter((g) => g.away.abbr === team || g.home.abbr === team);
    }
    list.sort((a, b) => a.date - b.date);
    return list;
  }

  function liveGames() {
    return visibleGames()
      .filter((g) => g.state === 'in' || (g.state === 'post' && recently(g)))
      .sort((a, b) => (a.state === 'in' ? -1 : 1) - (b.state === 'in' ? -1 : 1) || b.date - a.date);
  }
  function recently(g) {
    return Date.now() - g.date.getTime() < 6 * 3600 * 1000;
  }

  /* ---------------- Rendering: game card ---------------- */
  function renderGameCard(g) {
    const node = el.cardTmpl.content.firstElementChild.cloneNode(true);
    node.dataset.state = g.state;
    node.dataset.id = g.id;

    const awayWin = g.awayScore > g.homeScore;
    const homeWin = g.homeScore > g.awayScore;
    const showScores = g.state !== 'pre';

    const set = (sel, val, attr) => {
      const n = node.querySelector(sel);
      if (!n) return;
      if (attr) n.setAttribute(attr, val);
      else n.textContent = val;
    };

    set('[data-away-logo]', g.away.logo || '', 'src');
    set('[data-away-logo]', `${g.away.name} logo`, 'alt');
    set('[data-away-abbr]', g.away.abbr);
    set('[data-away-name]', g.away.name);
    set('[data-away-score]', showScores ? g.awayScore : '');
    
    set('[data-home-logo]', g.home.logo || '', 'src');
    set('[data-home-logo]', `${g.home.name} logo`, 'alt');
    set('[data-home-abbr]', g.home.abbr);
    set('[data-home-name]', g.home.name);
    set('[data-home-score]', showScores ? g.homeScore : '');

    const awayRow = node.querySelector('[data-away]');
    const homeRow = node.querySelector('[data-home]');
    if (g.state === 'post' && g.completed) {
      awayRow.classList.toggle('team-row--winner', awayWin);
      awayRow.classList.toggle('team-row--loser', !awayWin && homeWin);
      homeRow.classList.toggle('team-row--winner', homeWin);
      homeRow.classList.toggle('team-row--loser', !homeWin && awayWin);
    }

    const meta = node.querySelector('[data-meta]');
    meta.innerHTML = '';

    const line1 = document.createElement('div');
    line1.className = 'game-card__meta-line';
    const badge = document.createElement('span');
    badge.className = 'state-badge state-badge--' + (g.state === 'in' ? 'live' : g.state === 'post' ? 'final' : 'scheduled');
    badge.textContent = STATE_LABEL[g.state];
    line1.appendChild(badge);
    
    const detail = document.createElement('span');
    detail.className = 'meta-detail';
    detail.textContent = g.state === 'pre' ? fmtDate(g.date) + ' · ' + fmtTime(g.date) : g.shortDetail || STATE_LABEL[g.state];
    line1.appendChild(detail);
    meta.appendChild(line1);

    const venue = document.createElement('span');
    venue.className = 'meta-venue';
    venue.textContent = g.venueCity ? `${g.venueCity}${g.broadcast ? ' · ' + g.broadcast : ''}` : g.broadcast;
    meta.appendChild(venue);

    node.addEventListener('click', () => openModal(g.id));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(g.id); }
    });
    return node;
  }

  /* ---------------- Rendering: live grid ---------------- */
  function renderLive() {
    const games = liveGames();
    el.liveGrid.innerHTML = '';
    if (state.loading) {
      el.livePlaceholder.hidden = false;
      el.livePlaceholder.textContent = 'Loading live games…';
      el.liveGrid.appendChild(el.livePlaceholder);
      return;
    }
    if (!games.length) {
      const empty = document.createElement('p');
      empty.className = 'live-empty';
      empty.innerHTML = '<strong>No live games right now</strong>Check the schedule below for upcoming kickoffs.';
      el.liveGrid.appendChild(empty);
      return;
    }
    for (const g of games) el.liveGrid.appendChild(renderGameCard(g));
  }

  /* ---------------- Rendering: calendar ---------------- */
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  function renderCalendar() {
    const cur = state.cursor;
    el.calTitle.textContent = `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`;
    el.calGrid.innerHTML = '';

    const first = startOfMonth(cur);
    const startDow = first.getDay(); 
    const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    const today = new Date();

    const leadStart = new Date(cur.getFullYear(), cur.getMonth(), 0).getDate() - startDow + 1;
    for (let i = 0; i < startDow; i++) {
      el.calGrid.appendChild(calCell(new Date(cur.getFullYear(), cur.getMonth() - 1, leadStart + i), true, today));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      el.calGrid.appendChild(calCell(new Date(cur.getFullYear(), cur.getMonth(), d), false, today));
    }
    const filled = startDow + daysInMonth;
    const trail = (7 - (filled % 7)) % 7;
    for (let i = 1; i <= trail; i++) {
      el.calGrid.appendChild(calCell(new Date(cur.getFullYear(), cur.getMonth() + 1, i), true, today));
    }
  }

  function calCell(date, out, today) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (out ? ' cal-cell--out' : '');
    if (sameDay(date, today)) cell.classList.add('cal-cell--today');

    const dateLabel = document.createElement('span');
    dateLabel.className = 'cal-cell__date';
    dateLabel.textContent = date.getDate();
    cell.appendChild(dateLabel);

    const dayGames = visibleGames().filter((g) => sameDay(g.date, date));
    dayGames.sort((a, b) => a.date - b.date);
    for (const g of dayGames) cell.appendChild(calChip(g));

    return cell;
  }

  function calChip(g) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cal-game' + (g.state === 'in' ? ' cal-game--live' : '');
    const teamForColor = state.selectedTeam !== 'ALL' ? state.selectedTeam : g.home.abbr;
    const tm = state.teamMap.get(teamForColor) || { color: g.home.color };
    chip.style.setProperty('--team-color', tm.color || g.home.color);

    const time = document.createElement('span');
    time.className = 'cal-game__time';
    time.textContent = fmtTime(g.date);
    chip.appendChild(time);

    const abbr = document.createElement('span');
    abbr.className = 'cal-game__abbr';
    abbr.textContent = g.state === 'pre'
        ? `${g.away.abbr} @ ${g.home.abbr}`
        : `${g.away.abbr} ${g.awayScore}-${g.homeScore} ${g.home.abbr}`;
    chip.appendChild(abbr);

    chip.addEventListener('click', () => openModal(g.id));
    return chip;
  }

  /* ---------------- Rendering: list ---------------- */
  function renderList() {
    const games = visibleGames();
    el.listBody.innerHTML = '';
    if (!games.length) {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = 'No games match this filter.';
      el.listBody.appendChild(empty);
      return;
    }

    const groups = new Map();
    for (const g of games) {
      const key = `${g.phase}-${g.week}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      const [pa, wa] = a.split('-').map(Number);
      const [pb, wb] = b.split('-').map(Number);
      return pa - pb || wa - wb;
    });
    for (const key of keys) {
      const [phase, week] = key.split('-').map(Number);
      const grp = groups.get(key);
      const wrap = document.createElement('div');
      wrap.className = 'week-group';
      const head = document.createElement('div');
      head.className = 'week-group__head';
      head.innerHTML = `<h3 class="week-group__title">${PHASE_LABEL[phase] || 'Season'} · Week ${week}</h3><span class="week-group__count">${grp.length} game${grp.length > 1 ? 's' : ''}</span>`;
      wrap.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'week-grid';
      for (const g of grp) grid.appendChild(renderGameCard(g));
      wrap.appendChild(grid);
      el.listBody.appendChild(wrap);
    }
  }

  /* ---------------- Rendering: standings ---------------- */
  function calculateWinPct(recordStr) {
    if (!recordStr) return 0;
    const [w, l, t] = recordStr.split('-').map(Number);
    const wins = w || 0;
    const losses = l || 0;
    const ties = t || 0;
    const total = wins + losses + ties;
    if (total === 0) return 0;
    return (wins + (ties * 0.5)) / total;
  }

  function renderStandings() {
    el.standingsBody.innerHTML = '';
    if (state.league === 'cfb') {
      const note = document.createElement('p');
      note.className = 'list-empty';
      note.textContent = 'Division standings view is available for NFL games.';
      el.standingsBody.appendChild(note);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'standings-grid';

    for (const [divName, abbrs] of Object.entries(NFL_DIVISIONS)) {
      const divTeams = abbrs.map(abbr => state.teamMap.get(abbr) || { abbr, name: abbr, record: '0-0', logo: '' });
      
      divTeams.sort((a, b) => {
         const pctA = calculateWinPct(a.record);
         const pctB = calculateWinPct(b.record);
         if (pctA !== pctB) return pctB - pctA;
         const wA = parseInt((a.record||'0').split('-')[0]) || 0;
         const wB = parseInt((b.record||'0').split('-')[0]) || 0;
         if (wA !== wB) return wB - wA;
         return a.name.localeCompare(b.name);
      });

      const card = document.createElement('div');
      card.className = 'standings-card';
      
      let rowsHtml = '';
      divTeams.forEach((t, i) => {
        rowsHtml += `
          <div class="standings-row">
            <span class="standings-rank">${i + 1}</span>
            ${t.logo ? `<img class="standings-logo" src="${t.logo}" alt="${t.name} logo">` : `<div class="standings-logo-fallback"></div>`}
            <span class="standings-team">${t.name}</span>
            <span class="standings-record">${t.record || '0-0'}</span>
          </div>
        `;
      });

      card.innerHTML = `
        <h3 class="standings-div-title">${divName}</h3>
        <div class="standings-list">${rowsHtml}</div>
      `;
      wrap.appendChild(card);
    }
    el.standingsBody.appendChild(wrap);
  }

  /* ---------------- Modal ---------------- */
  function openModal(id) {
    const g = state.games.get(id);
    if (!g) return;
    const showScores = g.state !== 'pre';
    const awayWin = g.awayScore > g.homeScore;
    const homeWin = g.homeScore > g.awayScore;

    el.modalContent.innerHTML = `
      <div class="modal-status state-badge state-badge--${g.state === 'in' ? 'live' : g.state === 'post' ? 'final' : 'scheduled'}">${STATE_LABEL[g.state]}${g.state !== 'pre' ? ' · ' + (g.shortDetail || '') : ''}</div>
      <h2 class="modal-title">${g.shortName}</h2>
      <p class="modal-kickoff">${fmtDate(g.date)} · ${fmtTime(g.date)}</p>
      <div class="modal-teams">
        ${modalTeam(g.away, g.awayScore, showScores, awayWin)}
        <div class="modal-vs">at</div>
        ${modalTeam(g.home, g.homeScore, showScores, homeWin)}
      </div>
      <dl class="modal-details">
        ${g.venue ? `<dt>Venue</dt><dd>${g.venue}${g.venueCity ? ', ' + g.venueCity : ''}</dd>` : ''}
        ${g.broadcast ? `<dt>Broadcast</dt><dd>${g.broadcast}</dd>` : ''}
        <dt>Phase</dt><dd>${PHASE_LABEL[g.phase] || 'Season'} · Week ${g.week}</dd>
      </dl>
    `;
    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    el.modalContent.querySelector('[data-modal-close-btn]')?.focus();
  }
  function modalTeam(t, score, show, isWinner) {
    return `
      <div class="modal-team ${isWinner && show ? 'modal-team--winner' : ''}">
        ${t.logo ? `<img class="modal-team__logo" src="${t.logo}" alt="${t.name} logo" />` : ''}
        <span class="modal-team__abbr">${t.abbr}</span>
        <span class="modal-team__name">${t.name}</span>
        ${show ? `<span class="modal-team__score">${score}</span>` : ''}
      </div>`;
  }
  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------------- Main render ---------------- */
  function render() {
    renderLive();
    if (state.view === 'calendar') renderCalendar();
    else if (state.view === 'list') renderList();
    else if (state.view === 'standings') renderStandings();
  }

  /* ---------------- Skeleton ---------------- */
  function renderSkeleton() {
    el.livePlaceholder.hidden = true;
    el.calGrid.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('div');
      c.className = 'skeleton-card';
      c.innerHTML = '<div class="skeleton-line" style="width:40%"></div><div class="skeleton-line" style="width:80%"></div><div class="skeleton-line" style="width:60%"></div>';
      el.liveGrid.appendChild(c);
    }
  }

  /* ---------------- League Switch ---------------- */
  async function switchLeague(league) {
    if (state.league === league) return;
    state.league = league;
    state.loading = true;
    state.selectedTeam = 'ALL';
    state.phase = 'all';

    el.leagueTabs.forEach((btn) => {
      const active = btn.dataset.leagueTab === league;
      btn.classList.toggle('is-active', active);
    });

    if (el.phasePre) el.phasePre.hidden = league === 'cfb';

    if (league === 'cfb' && state.view === 'standings') {
      state.view = 'calendar';
      $$('[data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'calendar'));
      Object.entries(el.viewPanels).forEach(([name, panel]) =>
        panel.classList.toggle('is-active', name === 'calendar')
      );
    }

    renderSkeleton();
    try {
      await loadFullSchedule();
      state.loading = false;
      markUpdated();
      render();
      pollLive();
    } catch (err) {
      state.loading = false;
      state.error = true;
    }
  }

  /* ---------------- Events ---------------- */
  el.leagueTabs.forEach((btn) =>
    btn.addEventListener('click', () => switchLeague(btn.dataset.leagueTab))
  );

  el.teamFilter.addEventListener('change', (e) => {
    state.selectedTeam = e.target.value;
    render();
  });

  $$('[data-view]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      $$('[data-view]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      Object.entries(el.viewPanels).forEach(([name, panel]) =>
        panel.classList.toggle('is-active', name === state.view)
      );
      render();
    })
  );

  el.calPrev.addEventListener('click', () => {
    state.cursor = addMonths(state.cursor, -1);
    renderCalendar();
  });
  el.calNext.addEventListener('click', () => {
    state.cursor = addMonths(state.cursor, 1);
    renderCalendar();
  });
  el.calToday.addEventListener('click', () => {
    state.cursor = startOfMonth(new Date());
    renderCalendar();
  });

  $$('[data-phase]').forEach((chip) =>
    chip.addEventListener('click', () => {
      $$('[data-phase]').forEach((c) => c.classList.toggle('is-active', c === chip));
      state.phase = chip.dataset.phase;
      render();
    })
  );

  $$('[data-modal-close]').forEach((n) => n.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
  });

  /* ---------------- Boot ---------------- */
  async function boot() {
    el.phaseFilter.hidden = false;
    renderSkeleton();
    try {
      await loadFullSchedule();
      state.loading = false;
      markUpdated();
      render();
      pollLive();
      if(state.pollTimer) clearInterval(state.pollTimer);
      state.pollTimer = setInterval(pollLive, POLL_MS);
      setInterval(() => {
        if (state.lastUpdated) el.updatedText.textContent = 'Updated ' + relTime(state.lastUpdated);
      }, 15000);
    } catch (err) {
      state.loading = false;
      state.error = true;
      el.liveGrid.innerHTML = '';
      const errEl = document.createElement('p');
      errEl.className = 'live-empty';
      errEl.innerHTML = '<strong>Couldn’t load games</strong>Please try refreshing the page.';
      el.liveGrid.appendChild(errEl);
    }
  }

  // Check auth and boot
  if (authToken) {
    el.loginScreen.hidden = true;
    el.appContent.hidden = false;
    boot();
  } else {
    el.loginScreen.hidden = false;
    el.appContent.hidden = true;
  }

})();
