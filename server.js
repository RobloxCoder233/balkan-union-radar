'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

function loadEnvFile() {
  try {
    fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach(function (line) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] != null) return;
      let value = match[2];
      if ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'")) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    });
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('env file load failed:', err.message);
  }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 4173);
const PANEL_KEY = process.env.PANEL_KEY || 'balkan-command';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'bu_session';
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.join(ROOT, '.data');
const STATE_FILE = path.join(DATA_DIR, 'panel-state.json');
const CSB_API_KEY = process.env.CSB_API_KEY || '';
const CSB_API_BASE = (process.env.CSB_API_BASE || 'https://csb-air-alert.onrender.com/api/v1').replace(/\/+$/, '');
const CSB_RESOURCES = new Set([
  'snapshot', 'state', 'stats', 'zones', 'alerts', 'threats', 'strikes',
  'history', 'weapons', 'launch-sites', 'frontline', 'territories', 'geometry'
]);
const CSB_QUERY_KEYS = new Set([
  'side', 'type', 'weapon', 'zone', 'group', 'origin_kind', 'include', 'limit', 'since', 'status'
]);
const CSB_TTL = {
  snapshot: 2000,
  stats: 2000,
  alerts: 3000,
  threats: 3000,
  strikes: 3000,
  history: 5000,
  zones: 30000,
  weapons: 60000,
  'launch-sites': 30000,
  state: 10000,
  frontline: 15000,
  territories: 60000,
  geometry: 60000
};
const csbCache = new Map();

if (IS_PROD && !process.env.PANEL_KEY) {
  console.error('PANEL_KEY must be set in production. Refusing to start with the development key.');
  process.exit(1);
}
if (IS_PROD && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

const state = {
  radar: {
    updatedAt: 0,
    condition: 'GREEN',
    silenced: false,
    source: null,
    air: { total: 0, hostile: 0, unknown: 0, friendly: 0, contacts: [] },
    naval: { total: 0, hostile: 0, unknown: 0, friendly: 0, contacts: [] }
  },
  meetings: [],
  alliances: [],
  deliveries: [],
  messages: [],
  orders: [],
  seq: 1
};

const sseClients = new Set();
const loginHits = new Map();
let saveTimer = null;

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    ['meetings', 'alliances', 'deliveries', 'messages', 'orders'].forEach(function (key) {
      if (Array.isArray(raw[key])) state[key] = raw[key];
    });
    if (Number.isFinite(raw.seq)) state.seq = raw.seq;
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('panel state load failed:', err.message);
  }
}

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        meetings: state.meetings,
        alliances: state.alliances,
        deliveries: state.deliveries,
        messages: state.messages,
        orders: state.orders,
        seq: state.seq
      }, null, 2));
    } catch (err) {
      console.warn('panel state save failed:', err.message);
    }
  }, 400);
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(function (part) {
    const index = part.indexOf('=');
    if (index < 0) return;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return out;
}

function hasSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return false;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return false;
  const exp = Number(raw.slice(0, dot));
  const sig = raw.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

function sessionCookie() {
  const exp = Date.now() + SESSION_MS;
  return COOKIE + '=' + exp + '.' + sign(exp) +
    '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + Math.floor(SESSION_MS / 1000) +
    (IS_PROD ? '; Secure' : '');
}

function clearCookie() {
  return COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (IS_PROD ? '; Secure' : '');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function readJson(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > (limit || 96 * 1024)) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(Object.assign(new Error('invalid json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function text(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 160);
}

function number(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch (err) { return false; }
}

function requirePanel(req, res) {
  if (hasSession(req)) return true;
  json(res, 401, { error: 'panel session required' });
  return false;
}

function csbCacheKey(resource, searchParams) {
  const pairs = [];
  searchParams.forEach(function (value, key) {
    if (CSB_QUERY_KEYS.has(key)) pairs.push([key, String(value).slice(0, 120)]);
  });
  pairs.sort(function (a, b) { return a[0].localeCompare(b[0]); });
  return resource + '?' + new URLSearchParams(pairs).toString();
}

async function fetchCsb(resource, searchParams) {
  const cacheKey = csbCacheKey(resource, searchParams);
  const cached = csbCache.get(cacheKey);
  const ttl = CSB_TTL[resource.split('/')[0]] || 5000;
  if (cached && Date.now() - cached.at < ttl) {
    return { body: cached.body, at: cached.at, stale: false };
  }

  const path = resource.split('/').map(encodeURIComponent).join('/');
  const url = new URL(CSB_API_BASE + '/' + path);
  if (url.protocol !== 'https:') throw new Error('CSB uplink must use HTTPS');
  searchParams.forEach(function (value, key) {
    if (CSB_QUERY_KEYS.has(key)) url.searchParams.set(key, String(value).slice(0, 120));
  });
  url.searchParams.set('api_key', CSB_API_KEY);

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 20000);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: 'application/json', 'user-agent': 'BalkanUnion-Control/1.0' }
    });
    if (!upstream.ok) throw new Error('CSB upstream status ' + upstream.status);
    const text = await upstream.text();
    if (text.length > 4000000) throw new Error('CSB payload too large');
    JSON.parse(text);
    const at = Date.now();
    csbCache.set(cacheKey, { at: at, body: text });
    if (csbCache.size > 32) {
      const oldest = Array.from(csbCache.entries()).sort(function (a, b) { return a[1].at - b[1].at; })[0];
      if (oldest) csbCache.delete(oldest[0]);
    }
    return { body: text, at: at, stale: false };
  } catch (err) {
    if (cached) return { body: cached.body, at: cached.at, stale: true };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function handleCsbProxy(req, res, resource, url) {
  if (!CSB_API_KEY) {
    return json(res, 503, { configured: false, error: 'CSB uplink is not configured' });
  }
  const parts = String(resource).split('/').filter(Boolean);
  const head = parts[0];
  const validPart = parts.every(function (part) { return /^[A-Za-z0-9_-]{1,60}$/.test(part); });
  const nestedAllowed = parts.length === 1 ||
    (parts.length === 2 && (head === 'alerts' || head === 'threats') && validPart);
  if (!validPart || !CSB_RESOURCES.has(head) || !nestedAllowed) {
    return json(res, 404, { error: 'unknown CSB resource' });
  }

  try {
    const result = await fetchCsb(parts.join('/'), url.searchParams);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-CSB-Age': String(Math.max(0, Math.round((Date.now() - result.at) / 1000)))
    };
    if (result.stale) headers['X-CSB-Stale'] = '1';
    res.writeHead(200, headers);
    res.end(result.body);
  } catch (err) {
    json(res, 502, { configured: true, error: 'CSB uplink unreachable' });
  }
}

function strikeFields(item) {
  return {
    id: item.id,
    side: item.side,
    status: item.status,
    type: item.type,
    weapon: item.weapon ? item.weapon.name : '',
    alert_class: item.alert_class || '',
    progress: item.progress,
    eta_seconds: item.eta_seconds,
    position: item.current_position || null,
    origin: item.origin ? { lat: item.origin.lat, lng: item.origin.lng, name: item.origin.name, kind: item.origin.kind } : null,
    target: item.target ? { lat: item.target.lat, lng: item.target.lng, name: item.target.name } : null
  };
}

async function handlePublicStrikes(req, res) {
  const base = { configured: !!CSB_API_KEY, at: Date.now(), strikes: [], threats: [] };
  if (!CSB_API_KEY) return json(res, 200, base);
  const params = new URLSearchParams({ limit: '60' });
  try {
    const results = await Promise.all([
      fetchCsb('strikes', params),
      fetchCsb('threats', params)
    ]);
    const strikes = (JSON.parse(results[0].body).strikes || []).slice(0, 60).map(strikeFields);
    const threats = (JSON.parse(results[1].body).threats || []).slice(0, 60).map(strikeFields);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(JSON.stringify({ configured: true, at: Date.now(), strikes: strikes, threats: threats }));
  } catch (err) {
    json(res, 200, Object.assign({}, base, { error: 'uplink unreachable' }));
  }
}

function publicRadarState() {
  const radar = state.radar;
  return {
    updatedAt: radar.updatedAt,
    condition: radar.condition,
    silenced: radar.silenced,
    source: radar.source,
    air: radar.air,
    naval: radar.naval,
    orders: state.orders.slice(-24),
    messages: state.messages.slice(-4)
  };
}

function panelState() {
  return {
    radar: state.radar,
    meetings: state.meetings,
    alliances: state.alliances,
    deliveries: state.deliveries,
    messages: state.messages,
    orders: state.orders.slice(-40)
  };
}

function pushOrder(type, payload) {
  const order = { id: ++state.seq, type: type, payload: payload || {}, at: Date.now() };
  state.orders.push(order);
  if (state.orders.length > 80) state.orders = state.orders.slice(-80);
  persist();
  broadcast();
  return order;
}

function broadcast() {
  if (!sseClients.size) return;
  const payload = 'event: state\ndata: ' + JSON.stringify(publicRadarState()) + '\n\n';
  sseClients.forEach(function (res) {
    try { res.write(payload); } catch (err) { sseClients.delete(res); }
  });
}

const TICK_MS = 2000;

const SIM_CONFIG = {
  air: { range: 250, max: 9 },
  naval: { range: 300, max: 7 }
};

const AIR_PROFILES = {
  hostile: [
    { cls: 'Iskander-M', kind: 'ballistic', speed: 4200, alt: 38 },
    { cls: 'Kalibr', kind: 'cruise', speed: 900, alt: 1 },
    { cls: 'Shahed-136', kind: 'drone', speed: 185, alt: 2 },
    { cls: 'Su-34', kind: 'jet', speed: 1200, alt: 28 },
    { cls: 'MiG-31', kind: 'jet', speed: 2500, alt: 40 }
  ],
  unknown: [
    { cls: 'Global Hawk', kind: 'uav', speed: 575, alt: 52 },
    { cls: 'P-8 Poseidon', kind: 'mpa', speed: 780, alt: 24 },
    { cls: 'Fast Mover', kind: 'unknown', speed: 1600, alt: 30 }
  ],
  friendly: [
    { cls: 'MiG-29', kind: 'jet', speed: 980, alt: 22 },
    { cls: 'Rafale', kind: 'jet', speed: 1050, alt: 25 },
    { cls: 'E-3 AWACS', kind: 'awacs', speed: 650, alt: 30 },
    { cls: 'Patrol UAV', kind: 'uav', speed: 300, alt: 12 }
  ],
  civil: [
    { cls: 'A320', kind: 'civil', speed: 840, alt: 34 },
    { cls: 'B738', kind: 'civil', speed: 820, alt: 36 },
    { cls: 'Cargo 747', kind: 'civil', speed: 880, alt: 32 }
  ]
};

const NAVAL_PROFILES = {
  hostile: [
    { cls: 'Frigate', kind: 'frigate', speed: 55, alt: 0 },
    { cls: 'Destroyer', kind: 'destroyer', speed: 60, alt: 0 },
    { cls: 'Submarine', kind: 'sub', speed: 38, alt: 0 },
    { cls: 'Missile Boat', kind: 'patrol', speed: 70, alt: 0 }
  ],
  unknown: [
    { cls: 'Corvette', kind: 'corvette', speed: 45, alt: 0 },
    { cls: 'Sub contact', kind: 'sub', speed: 30, alt: 0 },
    { cls: 'Unaligned DDG', kind: 'destroyer', speed: 52, alt: 0 }
  ],
  friendly: [
    { cls: 'FFG Kotor', kind: 'frigate', speed: 54, alt: 0 },
    { cls: 'HSV Bar', kind: 'patrol', speed: 65, alt: 0 },
    { cls: 'SSK Una', kind: 'sub', speed: 36, alt: 0 }
  ],
  civil: [
    { cls: 'Merchant', kind: 'merchant', speed: 28, alt: 0 },
    { cls: 'Ferry', kind: 'ferry', speed: 32, alt: 0 },
    { cls: 'Tanker', kind: 'merchant', speed: 25, alt: 0 }
  ]
};

const CALLSIGNS = {
  air: {
    hostile: ['RAVEN', 'VIPER', 'SABLE', 'KORSUN', 'TALON', 'ORION'],
    unknown: ['KILO', 'XRAY', 'TANGO', 'ZULU', 'ECHO', 'NOMAD'],
    friendly: ['BORA', 'GRIFFIN', 'ORAO', 'DANUBE', 'SOKOL', 'ADRIA'],
    civil: ['AUA214', 'DLH9', 'THY6', 'WZZ11', 'ASY77', 'BCS3']
  },
  naval: {
    hostile: ['SHADOW', 'KRASNIK', 'VECTOR', 'SPECTRE', 'K-91'],
    unknown: ['TRACK-7', 'CONTACT', 'NOMAD', 'KILO-2'],
    friendly: ['KOTOR', 'BAR', 'UNA', 'ADRIA', 'SOKOL-2'],
    civil: ['MERIDIAN', 'AEGEAN', 'TANKER 9', 'FERRY 4']
  }
};

let simCounter = 0;
let conditionOverride = null;

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function norm(value) {
  return ((value % 360) + 360) % 360;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomAffinity() {
  const roll = Math.random();
  if (roll < 0.34) return 'unknown';
  if (roll < 0.78) return 'friendly';
  return 'civil';
}

function makeContact(side, affinity, range, bearing) {
  const table = side === 'air' ? AIR_PROFILES : NAVAL_PROFILES;
  const base = pick(table[affinity] || table.unknown);
  let callsign = pick(CALLSIGNS[side][affinity] || CALLSIGNS[side].unknown);
  if (affinity !== 'civil') callsign += ' ' + (10 + Math.floor(Math.random() * 89));
  const inbound = affinity === 'hostile';
  return {
    id: (side === 'air' ? 'A' : 'N') + (++simCounter),
    callsign: callsign,
    cls: base.cls,
    kind: base.kind,
    aff: affinity,
    range: Math.round(range * 10) / 10,
    bearing: Math.round(norm(bearing) * 10) / 10,
    alt: side === 'air' ? Math.max(0, Math.round(base.alt + Math.random() * 3 - 1)) : 0,
    speed: Math.round(base.speed * (0.85 + Math.random() * 0.3)),
    heading: Math.round(norm(inbound ? bearing + 180 + Math.random() * 24 - 12 : Math.random() * 360)),
    depth: base.kind === 'sub' ? Math.round(40 + Math.random() * 220) : 0
  };
}

function spawnContact(side, affinity) {
  const cfg = SIM_CONFIG[side];
  const contact = makeContact(
    side,
    affinity,
    cfg.range * (0.35 + Math.random() * 0.6),
    Math.random() * 360
  );
  state.radar[side].contacts.push(contact);
  return contact;
}

function updateCounts(side) {
  const contacts = state.radar[side].contacts;
  state.radar[side].total = contacts.length;
  state.radar[side].hostile = contacts.filter(function (c) { return c.aff === 'hostile'; }).length;
  state.radar[side].unknown = contacts.filter(function (c) { return c.aff === 'unknown'; }).length;
  state.radar[side].friendly = contacts.filter(function (c) { return c.aff === 'friendly'; }).length;
}

function computeCondition() {
  const hostiles = state.radar.air.hostile + state.radar.naval.hostile;
  const unknowns = state.radar.air.unknown + state.radar.naval.unknown;
  if (hostiles >= 3) return 'RED';
  if (hostiles >= 1 || unknowns >= 6) return 'AMBER';
  return 'GREEN';
}

function seedRadar() {
  ['unknown', 'unknown', 'friendly', 'unknown', 'civil'].forEach(function (affinity) {
    spawnContact('air', affinity);
  });
  ['unknown', 'friendly', 'unknown', 'civil'].forEach(function (affinity) {
    spawnContact('naval', affinity);
  });
  updateCounts('air');
  updateCounts('naval');
  state.radar.condition = computeCondition();
  state.radar.updatedAt = Date.now();
}

function tickRadar() {
  ['air', 'naval'].forEach(function (side) {
    const cfg = SIM_CONFIG[side];
    const sideState = state.radar[side];
    let contacts = sideState.contacts;

    if (contacts.length < 3) spawnContact(side, randomAffinity());
    if (contacts.length < cfg.max && Math.random() < 0.13) spawnContact(side, randomAffinity());

    contacts = sideState.contacts;
    contacts.forEach(function (contact) {
      const step = (Math.max(0, contact.speed) / 3600) * (TICK_MS / 1000);
      const rel = (contact.heading - contact.bearing) * Math.PI / 180;
      contact.range += step * Math.cos(rel);
      contact.bearing = norm(contact.bearing +
        (step / Math.max(contact.range, 14)) * Math.sin(rel) * (180 / Math.PI));
      contact.heading = norm(contact.heading + Math.random() * 4 - 2);
      if (side === 'air' && Math.random() < 0.03) {
        contact.alt = clampNumber(contact.alt + Math.random() * 2 - 1, 0, 60);
      }
      if (contact.kind === 'sub') {
        contact.depth = clampNumber(contact.depth + Math.random() * 6 - 3, 20, 400);
      }
      contact.range = Math.round(contact.range * 10) / 10;
      contact.bearing = Math.round(contact.bearing * 10) / 10;
      contact.heading = Math.round(contact.heading);
      contact.alt = Math.round(contact.alt * 10) / 10;
    });

    sideState.contacts = contacts.filter(function (contact) {
      return contact.range < cfg.range + 50 && contact.range > 7;
    });
    updateCounts(side);
  });

  if (!conditionOverride || Date.now() > conditionOverride.until) {
    conditionOverride = null;
    state.radar.condition = computeCondition();
  }
  state.radar.updatedAt = Date.now();
  broadcast();
}

function handleLogin(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin rejected' });
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const hits = (loginHits.get(ip) || []).filter(function (t) { return now - t < 60000; });
  if (hits.length >= 12) return json(res, 429, { error: 'too many attempts, wait a minute' });
  hits.push(now);
  loginHits.set(ip, hits);

  readJson(req, 4096).then(function (body) {
    if (!safeEqual(text(body.key, 200), PANEL_KEY)) {
      return json(res, 401, { error: 'invalid command key' });
    }
    res.setHeader('Set-Cookie', sessionCookie());
    json(res, 200, { ok: true });
  }).catch(function (err) {
    json(res, err.status || 400, { error: err.message });
  });
}

function panelAction(req, res, handler) {
  if (!requirePanel(req, res)) return;
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin rejected' });
  readJson(req).then(function (body) {
    const result = handler(body);
    if (result && result.error) return json(res, 400, result);
    persist();
    broadcast();
    json(res, 200, { ok: true, result: result || null });
  }).catch(function (err) {
    json(res, err.status || 400, { error: err.message });
  });
}

function handlePanelAction(req, res, action) {
  if (action === 'meeting') {
    return panelAction(req, res, function (body) {
      const title = text(body.title, 90);
      if (!title) return { error: 'meeting title required' };
      const meeting = {
        id: id(),
        title: title,
        when: text(body.when, 40),
        agenda: text(body.agenda, 500),
        attendees: text(body.attendees, 160),
        status: 'planned',
        createdAt: Date.now()
      };
      state.meetings.unshift(meeting);
      state.meetings = state.meetings.slice(0, 40);
      pushOrder('message', { text: 'COUNCIL: ' + title + (meeting.when ? ' · ' + meeting.when : '') });
      return meeting;
    });
  }
  if (action === 'meeting-status') {
    return panelAction(req, res, function (body) {
      const meeting = state.meetings.find(function (m) { return m.id === text(body.id, 40); });
      if (!meeting) return { error: 'meeting not found' };
      const status = ['planned', 'confirmed', 'done', 'cancelled'].indexOf(body.status) >= 0 ? body.status : 'planned';
      meeting.status = status;
      return meeting;
    });
  }
  if (action === 'alliance') {
    return panelAction(req, res, function (body) {
      const countryId = text(body.countryId, 40);
      if (!countryId) return { error: 'country required' };
      const status = ['allied', 'neutral', 'hostile'].indexOf(body.status) >= 0 ? body.status : 'neutral';
      let row = state.alliances.find(function (a) { return a.countryId === countryId; });
      if (!row) {
        row = { id: id(), countryId: countryId, status: status, since: Date.now() };
        state.alliances.push(row);
      } else {
        row.status = status;
        row.since = Date.now();
      }
      return row;
    });
  }
  if (action === 'delivery') {
    return panelAction(req, res, function (body) {
      const destination = text(body.destination, 40);
      if (!destination) return { error: 'destination required' };
      const delivery = {
        id: id(),
        cargo: text(body.cargo, 40) || 'supplies',
        qty: number(body.qty, 1, 1000000, 1),
        destination: destination,
        status: 'planned',
        etaHours: number(body.etaHours, 1, 240, 12),
        createdAt: Date.now()
      };
      state.deliveries.unshift(delivery);
      state.deliveries = state.deliveries.slice(0, 40);
      pushOrder('convoy', {
        id: delivery.id,
        cargo: delivery.cargo,
        destination: delivery.destination,
        etaHours: delivery.etaHours
      });
      return delivery;
    });
  }
  if (action === 'delivery-status') {
    return panelAction(req, res, function (body) {
      const delivery = state.deliveries.find(function (d) { return d.id === text(body.id, 40); });
      if (!delivery) return { error: 'delivery not found' };
      const status = ['planned', 'transit', 'delivered', 'lost'].indexOf(body.status) >= 0 ? body.status : 'planned';
      delivery.status = status;
      pushOrder('convoy-end', { id: delivery.id, status: status });
      return delivery;
    });
  }
  if (action === 'order') {
    return panelAction(req, res, function (body) {
      const type = ['condition', 'message', 'drill', 'silence'].indexOf(body.type) >= 0 ? body.type : '';
      if (!type) return { error: 'unknown order' };
      if (type === 'condition') {
        const requested = body.payload && body.payload.condition;
        if (requested === 'AUTO') {
          conditionOverride = null;
          state.radar.condition = computeCondition();
          pushOrder('condition', { condition: 'AUTO' });
          return { condition: 'AUTO' };
        }
        const condition = ['GREEN', 'AMBER', 'RED'].indexOf(requested) >= 0 ? requested : 'GREEN';
        conditionOverride = { condition: condition, until: Date.now() + 30 * 60 * 1000 };
        state.radar.condition = condition;
        pushOrder('condition', { condition: condition });
        return { condition: condition };
      }
      if (type === 'message') {
        const msg = text(body.payload && body.payload.text, 200);
        if (!msg) return { error: 'message required' };
        state.messages.push({ id: id(), text: msg, at: Date.now() });
        state.messages = state.messages.slice(-20);
        pushOrder('message', { text: msg });
        return { text: msg };
      }
      if (type === 'drill') {
        const scope = body.payload && body.payload.scope === 'naval' ? 'naval' : 'air';
        for (let i = 0; i < 3; i++) spawnContact(scope, 'unknown');
        updateCounts(scope);
        pushOrder('drill', { scope: scope });
        return { scope: scope };
      }
      const silenced = !!(body.payload && body.payload.silenced);
      pushOrder('silence', { silenced: silenced });
      state.radar.silenced = silenced;
      return { silenced: silenced };
    });
  }
  return json(res, 404, { error: 'unknown panel action' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const PUBLIC_DIRS = ['/css/', '/js/', '/data/', '/assets/'];
const PUBLIC_FILES = ['/index.html', '/login.html'];

function serveStatic(req, res, pathname) {
  if (pathname === '/control.html') return redirect(res, '/control');
  const allowed = PUBLIC_FILES.indexOf(pathname) >= 0 ||
    PUBLIC_DIRS.some(function (prefix) { return pathname.indexOf(prefix) === 0; });
  if (!allowed) return json(res, 404, { error: 'not found' });

  const relative = pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'forbidden' });
  if (pathname.indexOf('/.') >= 0) return json(res, 404, { error: 'not found' });

  fs.stat(file, function (statErr, stat) {
    if (statErr || !stat.isFile()) return json(res, 404, { error: 'not found' });
    const etag = 'W/"' + stat.size.toString(16) + '-' + Math.round(stat.mtimeMs).toString(16) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    fs.readFile(file, function (err, data) {
      if (err) return json(res, 404, { error: 'not found' });
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
        'ETag': etag,
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    });
  });
}

const server = http.createServer(function (req, res) {
  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (err) { return json(res, 400, { error: 'bad request' }); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch (err) { return json(res, 400, { error: 'bad path' }); }
  const method = req.method;

  if (pathname === '/api/health') return json(res, 200, { ok: true, now: Date.now() });
  if (pathname === '/api/login' && method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', clearCookie());
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/radar' && method === 'POST') {
    return json(res, 404, { error: 'radar is server-simulated' });
  }
  if (pathname === '/api/state' && method === 'GET') {
    return json(res, 200, publicRadarState());
  }
  if (pathname === '/api/public-strikes' && method === 'GET') {
    return handlePublicStrikes(req, res);
  }
  if (pathname === '/api/orders' && method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    return json(res, 200, { orders: state.orders.filter(function (o) { return o.id > since; }) });
  }
  if (pathname === '/api/stream' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    res.write('event: state\ndata: ' + JSON.stringify(publicRadarState()) + '\n\n');
    sseClients.add(res);
    const heartbeat = setInterval(function () { res.write(': keep-alive\n\n'); }, 25000);
    req.on('close', function () {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }
  if (pathname === '/api/csb/config' && method === 'GET') {
    if (!requirePanel(req, res)) return;
    let host = '';
    try { host = new URL(CSB_API_BASE).host; } catch (err) { host = ''; }
    return json(res, 200, { configured: !!CSB_API_KEY, host: host, simulation: true });
  }
  if (pathname.indexOf('/api/csb/') === 0 && method === 'GET') {
    if (!requirePanel(req, res)) return;
    return handleCsbProxy(req, res, pathname.slice('/api/csb/'.length), url);
  }
  if (pathname === '/api/panel/state' && method === 'GET') {
    if (!requirePanel(req, res)) return;
    return json(res, 200, panelState());
  }
  if (pathname.indexOf('/api/panel/') === 0 && method === 'POST') {
    return handlePanelAction(req, res, pathname.slice('/api/panel/'.length));
  }

  if (pathname === '/control') {
    if (!hasSession(req)) return redirect(res, '/login?next=%2Fcontrol');
    const file = path.join(ROOT, 'control.html');
    return fs.readFile(file, function (err, data) {
      if (err) return json(res, 404, { error: 'control panel not built' });
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }
  if (pathname === '/' || pathname === '/radar') {
    const file = path.join(ROOT, 'index.html');
    return fs.readFile(file, function (err, data) {
      if (err) return json(res, 500, { error: 'radar not built' });
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }
  if (pathname === '/login') {
    if (hasSession(req)) return redirect(res, '/control');
    const file = path.join(ROOT, 'login.html');
    return fs.readFile(file, function (err, data) {
      if (err) return json(res, 404, { error: 'login not built' });
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }
  if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, pathname);
  return json(res, 405, { error: 'method not allowed' });
});

loadState();
seedRadar();
setInterval(tickRadar, TICK_MS);
server.listen(PORT, function () {
  console.log('Balkan Union radar/control listening on http://127.0.0.1:' + PORT);
  if (!process.env.PANEL_KEY) {
    console.warn('PANEL_KEY is not set; using the development key "' + PANEL_KEY + '". Set PANEL_KEY in production.');
  }
});

function shutdown() {
  sseClients.forEach(function (res) { try { res.end(); } catch (err) {} });
  server.close(function () { process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
