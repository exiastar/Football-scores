#!/usr/bin/env node
/**
 * Gridiron backend — proxies ESPN's NFL & College Football scoreboard APIs
 */
const express = require('express');
const path = require('path');

const PORT = 8000;
const SEASON = 2026;
const SCHEDULE_TTL = 6 * 3600 * 1000; // 6h
const LIVE_WINDOW = 36 * 3600 * 1000; // +/- 36h defines "active" weeks

// --- Security ---
const APP_PASSWORD = process.env.APP_PASSWORD || 'touchdown';
const AUTH_TOKEN = 'gridiron-auth-token-123';

const LEAGUES = {
  nfl: {
    endpoint: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    phases: [
      { type: 1, weeks: 4 },
      { type: 2, weeks: 18 },
      { type: 3, weeks: 4 },
    ],
  },
  cfb: {
    endpoint: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80',
    phases: [
      { type: 2, weeks: 16 },
      { type: 3, weeks: 4 },
    ],
  },
};

const app = express();
app.use(express.json()); // Allow reading JSON body for login
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');
  next();
});

/* ---------------- Auth Routes & Middleware ---------------- */
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    res.json({ success: true, token: AUTH_TOKEN });
  } else {
    res.status(401).json({ success: false, error: 'Invalid passcode' });
  }
});

function requireAuth(req, res, next) {
  const token = req.headers['authorization'];
  if (token === AUTH_TOKEN) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

/* ---------------- ESPN fetch + parse ---------------- */
async function fetchWeek(leagueKey, phaseType, week) {
  const config = LEAGUES[leagueKey] || LEAGUES.nfl;
  const separator = config.endpoint.includes('?') ? '&' : '?';
  const url = `${config.endpoint}${separator}season=${SEASON}&seasontype=${phaseType}&week=${week}`;
  
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${leagueKey} ${phaseType}/${week}`);
  return res.json();
}

function normalizeColor(hex) {
  if (!hex) return '#34d27c';
  hex = String(hex).trim();
  if (hex.length === 6) return '#' + hex;
  if (hex.length === 3) return '#' + hex.split('').map((x) => x + x).join('');
  return hex;
}

function teamFromComp(c) {
  const t = c.team || {};
  return {
    id: t.id,
    abbr: t.abbreviation || t.name,
    name: t.displayName || t.name,
    color: normalizeColor(t.color),
    altColor: normalizeColor(t.alternateColor),
    logo: t.logo || '',
    record: c.records?.[0]?.summary || '',
  };
}

function parseGame(event) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const comps = comp.competitors || [];
  const home = comps.find((c) => c.homeAway === 'home') || comps[0];
  const away = comps.find((c) => c.homeAway === 'away') || comps[1];
  if (!home || !away) return null;
  const st = event.status?.type || {};
  const venue = comp.venue || {};
  return {
    id: event.id,
    date: event.date,
    shortName: event.shortName || event.name,
    name: event.name,
    phase: event.season?.type ?? 2,
    week: event.week?.number ?? 0,
    state: st.state || 'pre',
    completed: !!st.completed,
    shortDetail: st.shortDetail || st.detail || '',
    clock: st.displayClock || '',
    period: st.period || 0,
    venue: venue.fullName || '',
    venueCity: venue.address?.city || '',
    broadcast: comp.broadcasts?.[0]?.names?.[0] || '',
    home: teamFromComp(home),
    away: teamFromComp(away),
    homeScore: Number(home.score) || 0,
    awayScore: Number(away.score) || 0,
  };
}

async function fetchAllWeeks(leagueKey) {
  const config = LEAGUES[leagueKey] || LEAGUES.nfl;
  const tasks = [];
  for (const phase of config.phases) {
    for (let w = 1; w <= phase.weeks; w++) {
      tasks.push(
        fetchWeek(leagueKey, phase.type, w)
          .then((data) => (data.events || []).map(parseGame).filter(Boolean))
          .catch(() => [])
      );
    }
  }
  const results = await Promise.all(tasks);
  const games = [];
  const seen = new Set();
  for (const list of results) {
    for (const g of list) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      games.push(g);
    }
  }
  games.sort((a, b) => new Date(a.date) - new Date(b.date));
  return games;
}

/* ---------------- Cache ---------------- */
const scheduleCaches = {
  nfl: null,
  cfb: null,
};

async function getSchedule(leagueKey) {
  const now = Date.now();
  const cache = scheduleCaches[leagueKey];
  if (cache && now - cache.at < SCHEDULE_TTL) {
    return cache.games;
  }
  const games = await fetchAllWeeks(leagueKey);
  scheduleCaches[leagueKey] = { games, at: now };
  return games;
}

function computeActiveWeeks(games) {
  const now = Date.now();
  const set = new Set();
  for (const g of games) {
    const t = new Date(g.date).getTime();
    if (g.state === 'in' || Math.abs(t - now) < LIVE_WINDOW) {
      set.add(`${g.phase}:${g.week}`);
    }
  }
  return [...set].map((s) => s.split(':').map(Number));
}

/* ---------------- Protected Routes ---------------- */
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/api/schedule', requireAuth, async (req, res) => {
  try {
    const league = req.query.league === 'cfb' ? 'cfb' : 'nfl';
    const games = await getSchedule(league);
    res.json({ league, season: SEASON, count: games.length, games });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/live', requireAuth, async (req, res) => {
  try {
    const league = req.query.league === 'cfb' ? 'cfb' : 'nfl';
    const games = await getSchedule(league);
    const weeks = computeActiveWeeks(games);
    const out = [];
    if (weeks.length) {
      const results = await Promise.all(
        weeks.map(([p, w]) => fetchWeek(league, p, w).catch(() => null))
      );
      for (const data of results) {
        if (!data?.events) continue;
        for (const ev of data.events) {
          const g = parseGame(ev);
          if (g) out.push(g);
        }
      }
    }
    res.json({ league, count: out.length, games: out, updated: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Gridiron backend listening on ${PORT}`));
