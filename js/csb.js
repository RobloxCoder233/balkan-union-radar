(function () {
  'use strict';

  var POLL_MS = 3000;
  var AUX_MS = 30000;
  var SITE_MS = 60000;
  var ENDPOINTS = [
    { path: 'snapshot', label: 'snapshot' },
    { path: 'stats', label: 'stats' },
    { path: 'state', label: 'state' },
    { path: 'alerts', label: 'alerts' },
    { path: 'alerts/{zone}', label: 'alerts/{zone}' },
    { path: 'threats', label: 'threats' },
    { path: 'threats/{id}', label: 'threats/{id}' },
    { path: 'strikes', label: 'strikes' },
    { path: 'history', label: 'history' },
    { path: 'zones', label: 'zones' },
    { path: 'weapons', label: 'weapons' },
    { path: 'launch-sites', label: 'launch-sites' },
    { path: 'frontline', label: 'frontline' },
    { path: 'territories', label: 'territories' },
    { path: 'geometry', label: 'geometry' }
  ];

  var state = {
    snapshot: null,
    sites: null,
    weapons: null,
    frontline: null,
    configured: true,
    firstSnapshot: true
  };
  var seenStrikes = {};
  var seenOutcomes = {};
  var lastAttempt = 0;
  var snapshotLoading = false;
  var overlayOn = true;
  var overlayGroup = null;
  var timer = null;
  var auxTimer = null;
  var siteTimer = null;
  var redirecting = false;

  function byId(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function fmtInt(value) {
    try { return num(value).toLocaleString('en-GB'); }
    catch (err) { return String(value); }
  }

  function fmtEta(seconds) {
    var total = Math.max(0, Math.round(num(seconds)));
    if (total <= 0) return 'IMPACT';
    var m = Math.floor(total / 60);
    var s = total % 60;
    if (m < 60) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    var h = Math.floor(m / 60);
    return h + 'h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + 'm';
  }

  function fmtClock(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    try {
      return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (err) {
      return date.toISOString().slice(11, 16);
    }
  }

  function isActive(strike) {
    if (!strike) return false;
    if (strike.ended_at) return false;
    return strike.status === 'launched' || strike.status === 'inbound';
  }

  function isEnded(strike) {
    return !!strike && !isActive(strike) && (strike.status === 'intercepted' ||
      strike.status === 'impact' || strike.status === 'miss' || strike.status === 'missed');
  }

  function strikesOf(snapshot) {
    return snapshot && Array.isArray(snapshot.strikes) ? snapshot.strikes : [];
  }

  function activeStrikes() {
    return strikesOf(state.snapshot).filter(isActive).sort(function (a, b) {
      return num(a.eta_seconds) - num(b.eta_seconds);
    });
  }

  function setLink(kind, text, note) {
    var link = byId('csbLink');
    var label = byId('csbLinkText');
    if (!link || !label) return;
    link.dataset.state = kind;
    link.title = note || '';
    label.textContent = text;
  }

  function sessionLost() {
    if (redirecting) return;
    redirecting = true;
    window.location.href = '/login?next=%2Fcontrol';
  }

  function api(path) {
    var safe = String(path).split('/').map(encodeURIComponent).join('/');
    return fetch('/api/csb/' + safe, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    }).then(function (response) {
      if (response.status === 401) {
        sessionLost();
        throw new Error('session expired');
      }
      if (response.status === 503) {
        state.configured = false;
        setLink('error', 'NOT CONFIGURED', 'Add CSB_API_KEY to the server environment.');
        throw new Error('csb not configured');
      }
      if (!response.ok) throw new Error('CSB proxy status ' + response.status);
      var stale = response.headers.get('X-CSB-Stale') === '1';
      return response.json().then(function (data) {
        return { data: data, stale: stale };
      });
    });
  }

  function toast(mark, title, sub, color) {
    var host = byId('toasts');
    if (!host) return;
    var node = document.createElement('div');
    node.className = 'toast';
    node.style.setProperty('--c', color || '#e879f9');
    node.innerHTML = '<span class="toast-mark">' + esc(mark) + '</span>' +
      '<div class="toast-body"><div class="toast-title">' + esc(title) + '</div>' +
      (sub ? '<div class="toast-sub">' + esc(sub) + '</div>' : '') + '</div>';
    host.appendChild(node);
    while (host.children.length > 3) host.removeChild(host.firstElementChild);
    window.setTimeout(function () {
      node.classList.add('is-out');
      window.setTimeout(function () { node.remove(); }, 260);
    }, 4800);
  }

  function purge(map, now) {
    Object.keys(map).forEach(function (key) {
      if (now - map[key] > 1800000) delete map[key];
    });
  }

  function trackEvents(snapshot) {
    var now = Date.now();
    var active = strikesOf(snapshot).filter(isActive);
    var ended = strikesOf(snapshot).filter(isEnded);
    var first = state.firstSnapshot;

    active.forEach(function (strike) {
      if (seenStrikes[strike.id]) return;
      seenStrikes[strike.id] = now;
      if (first || document.hidden) return;
      var target = strike.target || {};
      var weapon = strike.weapon || {};
      var origin = strike.origin || {};
      toast('CSB', 'Strike inbound · ' + (target.name || 'unknown target'),
        weapon.name + ' from ' + origin.name + ' · ETA ' + fmtEta(strike.eta_seconds), '#e879f9');
    });

    ended.forEach(function (strike) {
      if (seenOutcomes[strike.id]) return;
      seenOutcomes[strike.id] = now;
      if (first || document.hidden) return;
      var target = strike.target || {};
      var weapon = strike.weapon || {};
      if (strike.status === 'impact') {
        toast('IMPACT', 'CSB impact · ' + (target.name || 'unknown target'),
          weapon.name + ' hit the target area.', '#ef4444');
      } else {
        toast('INTERCEPT', 'CSB vector downed',
          weapon.name + ' intercepted before ' + (target.name || 'the target') + '.', '#22c55e');
      }
    });

    purge(seenStrikes, now);
    purge(seenOutcomes, now);
    state.firstSnapshot = false;
  }

  function targetRows(active) {
    var byKey = {};
    active.forEach(function (strike) {
      var target = strike.target || {};
      var key = (target.name || 'Unknown') + '|' + (target.group || '');
      var row = byKey[key];
      if (!row) {
        row = {
          name: target.name || 'Unknown target',
          zone: target.zone_name || '',
          group: target.group || '',
          count: 0,
          eta: Infinity,
          progress: 0,
          weapons: {}
        };
        byKey[key] = row;
      }
      row.count++;
      row.eta = Math.min(row.eta, num(strike.eta_seconds));
      row.progress = Math.max(row.progress, num(strike.progress));
      if (strike.weapon && strike.weapon.name) row.weapons[strike.weapon.name] = true;
    });
    return Object.keys(byKey).map(function (key) { return byKey[key]; }).sort(function (a, b) {
      return a.eta - b.eta;
    });
  }

  function weaponSummary(row) {
    var names = Object.keys(row.weapons);
    if (!names.length) return 'Unknown weapon';
    if (names.length <= 2) return names.join(', ');
    return names.slice(0, 2).join(', ') + ' +' + (names.length - 2);
  }

  function render() {
    var snapshot = state.snapshot;
    if (!snapshot) return;
    var stats = snapshot.stats || {};
    var active = activeStrikes();
    var ended = strikesOf(snapshot).filter(isEnded).sort(function (a, b) {
      return new Date(b.ended_at || 0) - new Date(a.ended_at || 0);
    });
    var targets = targetRows(active);

    var count = stats.active_csb_strikes != null ? num(stats.active_csb_strikes) : active.length;
    var tabCount = byId('tabCsbCount');
    if (tabCount) {
      tabCount.textContent = fmtInt(count);
      tabCount.classList.toggle('is-muted', count === 0);
    }

    var kpis = byId('csbKpis');
    if (kpis) {
      var impacts = stats.csb_last_15min ? num(stats.csb_last_15min.impacts) : 0;
      var losses = stats.csb_last_15min ? num(stats.csb_last_15min.intercepted) : 0;
      kpis.innerHTML =
        kpi('Active CSB vectors', fmtInt(count), count ? 'is-danger' : 'is-good') +
        kpi('Dutch targets', fmtInt(targets.length), targets.length ? 'is-danger' : 'is-good') +
        kpi('CSB impacts · 15m', fmtInt(impacts), impacts ? 'is-warn' : 'is-good') +
        kpi('CSB losses · 15m', fmtInt(losses), 'is-good');
    }

    var banner = byId('csbBanner');
    if (banner) {
      if (active.length) {
        var nearest = active[0];
        var target = nearest.target || {};
        var zones = num(stats.zones_under_alert);
        banner.hidden = false;
        banner.innerHTML = '<b>OFFENSIVE ACTIVE</b> · ' + active.length + ' CSB vector' +
          (active.length === 1 ? '' : 's') + ' inbound · ' + targets.length + ' Dutch target' +
          (targets.length === 1 ? '' : 's') + ' · nearest impact ' + fmtEta(nearest.eta_seconds) +
          ' → ' + esc(target.name || 'unknown') +
          (zones ? ' · ' + fmtInt(zones) + ' CSB zones under alert' : '');
      } else {
        banner.hidden = true;
        banner.innerHTML = '';
      }
    }

    var targetHost = byId('csbTargets');
    if (targetHost) {
      targetHost.innerHTML = targets.length ? targets.slice(0, 8).map(function (row) {
        var meta = (row.group || 'Dutch Union') + (row.zone ? ' · ' + row.zone : '');
        return '<div class="csb-item is-inbound">' +
          '<div class="csb-item-head"><strong>' + esc(row.name) + '<small>' + esc(meta) + '</small></strong>' +
          '<span class="csb-chip is-inbound">' + row.count + ' VECTOR' + (row.count === 1 ? '' : 'S') + '</span></div>' +
          '<p class="csb-meta">next impact ' + fmtEta(row.eta) + ' · ' + esc(weaponSummary(row)) + '</p>' +
          '<div class="csb-bar"><i style="width:' + Math.min(100, Math.round(row.progress * 100)) + '%"></i></div>' +
          '</div>';
      }).join('') : '<p class="csb-empty">No CSB vectors currently airborne toward Dutch Union territory.</p>';
    }
    var targetMeta = byId('csbTargetMeta');
    if (targetMeta) targetMeta.textContent = targets.length + ' cities · ' + active.length + ' vectors';

    var incomingHost = byId('csbIncoming');
    if (incomingHost) {
      incomingHost.innerHTML = active.length ? active.slice(0, 8).map(function (strike) {
        var target = strike.target || {};
        var weapon = strike.weapon || {};
        var origin = strike.origin || {};
        var progress = Math.min(100, Math.round(num(strike.progress) * 100));
        return '<div class="csb-item is-inbound">' +
          '<div class="csb-item-head"><strong>' + esc(target.name || 'Unknown target') +
          '<small>' + esc(weapon.name || strike.type) + ' · ' + esc(target.group || '') + '</small></strong>' +
          '<span class="csb-chip is-launched">' + fmtEta(strike.eta_seconds) + '</span></div>' +
          '<p class="csb-meta">from ' + esc(origin.name || 'unknown site') + ' · ' +
          esc(strike.status) + ' · ' + fmtInt(strike.distance_km) + ' km</p>' +
          '<div class="csb-bar"><i style="width:' + progress + '%"></i></div>' +
          '</div>';
      }).join('') : '<p class="csb-empty">No active CSB vectors in the current feed.</p>';
    }
    var incomingMeta = byId('csbIncomingMeta');
    if (incomingMeta) incomingMeta.textContent = active.length ? fmtEta(active[0].eta_seconds) + ' nearest' : 'clear';

    var recentHost = byId('csbRecent');
    if (recentHost) {
      recentHost.innerHTML = ended.length ? ended.slice(0, 8).map(function (strike) {
        var target = strike.target || {};
        var weapon = strike.weapon || {};
        var impact = strike.status === 'impact';
        return '<div class="csb-item ' + (impact ? 'is-impact' : 'is-intercepted') + '">' +
          '<div class="csb-item-head"><strong>' + esc(target.name || 'Unknown target') +
          '<small>' + esc(weapon.name || strike.type) + ' · ' + esc(target.group || '') + '</small></strong>' +
          '<span class="csb-chip ' + (impact ? 'is-impact' : 'is-intercepted') + '">' +
          esc(strike.status) + '</span></div>' +
          '<p class="csb-meta">' + esc(fmtClock(strike.ended_at)) + ' · from ' +
          esc((strike.origin && strike.origin.name) || 'unknown site') + '</p>' +
          '</div>';
      }).join('') : '<p class="csb-empty">No completed CSB strikes in the current feed.</p>';
    }
    var recentMeta = byId('csbRecentMeta');
    if (recentMeta) recentMeta.textContent = ended.length + ' logged';

    renderSites();
    renderWeapons();
    drawOverlay();
  }

  function kpi(label, value, cls) {
    return '<div class="csb-kpi ' + cls + '"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  }

  function siteList() {
    return state.sites ? state.sites.filter(function (site) { return site.side === 'csb'; }) : [];
  }

  function renderSites() {
    var host = byId('csbSites');
    if (!host) return;
    var sites = siteList();
    var weaponNames = {};
    if (state.weapons) {
      state.weapons.forEach(function (weapon) { weaponNames[weapon.id] = weapon.name; });
    }
    host.innerHTML = sites.length ? sites.map(function (site) {
      var kit = Array.isArray(site.weapons) ? site.weapons.map(function (id) {
        return weaponNames[id] || id;
      }) : [];
      return '<div class="csb-item is-csb">' +
        '<div class="csb-item-head"><strong>' + esc(site.name || site.id) +
        '<small>' + esc(site.kind || 'site') + ' · ' + num(site.lat).toFixed(2) + ', ' +
        num(site.lng).toFixed(2) + '</small></strong>' +
        '<span class="csb-chip is-csb">' + esc(site.confidence || 'known') + '</span></div>' +
        '<p class="csb-meta">' + (kit.length ? esc(kit.join(' · ')) : 'No weapons listed') + '</p>' +
        '</div>';
    }).join('') : '<p class="csb-empty">No CSB launch batteries reported.</p>';
    var meta = byId('csbSitesMeta');
    if (meta) meta.textContent = sites.length + ' known';
  }

  function renderWeapons() {
    var host = byId('csbWeapons');
    if (!host) return;
    var weapons = state.weapons ? state.weapons.filter(function (weapon) { return weapon.owner === 'csb'; }) : [];
    host.innerHTML = weapons.length ? weapons.map(function (weapon) {
      return '<div class="csb-item is-csb">' +
        '<div class="csb-item-head"><strong>' + esc(weapon.name || weapon.id) +
        '<small>' + esc(weapon['class'] || weapon.category || '') + '</small></strong>' +
        '<span class="csb-chip is-csb">' + esc(weapon.category || 'weapon') + '</span></div>' +
        '<p class="csb-meta">' + fmtInt(weapon.speed_kmh) + ' km/h · range ' +
        fmtInt(weapon.range_km) + ' km · intercept ' +
        Math.round(num(weapon.intercept_chance) * 100) + '%</p>' +
        '</div>';
    }).join('') : '<p class="csb-empty">No CSB weapons reported.</p>';
    var meta = byId('csbWeaponsMeta');
    if (meta) meta.textContent = weapons.length + ' systems';
  }

  function paneName() {
    var map = window.BU_MAP;
    if (!map || !window.L) return null;
    if (!map.getPane('csbPane')) {
      var pane = map.createPane('csbPane');
      pane.style.zIndex = '450';
      pane.style.pointerEvents = 'none';
    }
    return 'csbPane';
  }

  function tooltip(layer, html) {
    layer.bindTooltip(html, { className: 'csb-map-tip', direction: 'top', offset: [0, -6] });
    return layer;
  }

  function drawOverlay() {
    if (!overlayOn) return;
    var map = window.BU_MAP;
    var pane = paneName();
    if (!map || !pane || !window.L) return;
    if (!overlayGroup) overlayGroup = L.layerGroup().addTo(map);
    overlayGroup.clearLayers();

    if (state.frontline && state.frontline.type === 'FeatureCollection') {
      L.geoJSON(state.frontline, {
        pane: pane,
        interactive: false,
        style: {
          color: '#c084fc', weight: 1.3, opacity: 0.65, dashArray: '4 5',
          fillColor: '#a855f7', fillOpacity: 0.05
        }
      }).addTo(overlayGroup);
    }

    siteList().forEach(function (site) {
      if (!isFinite(Number(site.lat)) || !isFinite(Number(site.lng))) return;
      var marker = L.marker([Number(site.lat), Number(site.lng)], {
        pane: pane,
        interactive: true,
        keyboard: false,
        icon: L.divIcon({ className: 'csb-site-mark', iconSize: [7, 7], iconAnchor: [3.5, 3.5] })
      });
      tooltip(marker, 'CSB battery · ' + esc(site.name || site.id)).addTo(overlayGroup);
    });

    var snapshot = state.snapshot;
    if (!snapshot) return;
    var ringed = {};
    var active = activeStrikes();

    active.forEach(function (strike) {
      var origin = strike.origin;
      var current = strike.current_position;
      var target = strike.target;
      if (!origin || !target) return;
      var from = [Number(origin.lat), Number(origin.lng)];
      var to = [Number(target.lat), Number(target.lng)];
      if (!isFinite(from[0]) || !isFinite(from[1]) || !isFinite(to[0]) || !isFinite(to[1])) return;
      var now = current && isFinite(Number(current.lat)) && isFinite(Number(current.lng)) ?
        [Number(current.lat), Number(current.lng)] : null;

      L.polyline([from, now || to], {
        pane: pane, color: '#f0abfc', weight: 1, opacity: 0.5, dashArray: '2 5', interactive: false
      }).addTo(overlayGroup);
      L.polyline([now || from, to], {
        pane: pane, color: '#fb7185', weight: 1.5, opacity: 0.82, interactive: false
      }).addTo(overlayGroup);
      L.circleMarker(now || from, {
        pane: pane, radius: 2.8, color: '#fff1f2', weight: 1,
        fillColor: '#f43f5e', fillOpacity: 1, interactive: false
      }).addTo(overlayGroup);

      var key = String(target.name) + '|' + target.lat + ',' + target.lng;
      if (!ringed[key]) {
        ringed[key] = true;
        var ring = L.marker([to[0], to[1]], {
          pane: pane, interactive: true, keyboard: false,
          icon: L.divIcon({ className: 'csb-target-ring', iconSize: [16, 16], iconAnchor: [8, 8] })
        });
        tooltip(ring, 'CSB target · ' + esc(target.name) +
          '<br>' + esc((strike.weapon && strike.weapon.name) || strike.type) +
          ' · ' + fmtEta(strike.eta_seconds)).addTo(overlayGroup);
      }
    });

    var cutoff = Date.now() - 900000;
    strikesOf(snapshot).filter(isEnded).slice(0, 12).forEach(function (strike) {
      var target = strike.target;
      if (!target) return;
      var ended = new Date(strike.ended_at || 0).getTime();
      if (!isFinite(ended) || ended < cutoff) return;
      var key = 'done|' + String(target.name) + '|' + target.lat + ',' + target.lng;
      if (ringed[key]) return;
      ringed[key] = true;
      var impact = strike.status === 'impact';
      var mark = L.marker([Number(target.lat), Number(target.lng)], {
        pane: pane, interactive: true, keyboard: false,
        icon: L.divIcon({
          className: 'csb-target-ring ' + (impact ? 'is-impact' : 'is-intercepted'),
          iconSize: [16, 16], iconAnchor: [8, 8]
        })
      });
      tooltip(mark, (impact ? 'CSB impact · ' : 'CSB vector intercepted · ') +
        esc(target.name) + '<br>' + esc(fmtClock(strike.ended_at))).addTo(overlayGroup);
    });
  }

  function resolveEndpoint(path) {
    if (path === 'alerts/{zone}') {
      var alert = state.snapshot && Array.isArray(state.snapshot.alerts) ? state.snapshot.alerts[0] : null;
      return alert && alert.zone_id ? 'alerts/' + alert.zone_id : null;
    }
    if (path === 'threats/{id}') {
      var threat = state.snapshot && Array.isArray(state.snapshot.threats) ? state.snapshot.threats[0] : null;
      return threat && threat.id ? 'threats/' + threat.id : null;
    }
    return path;
  }

  function inspectEndpoint(path, button) {
    var resolved = resolveEndpoint(path);
    if (!resolved) {
      var meta = byId('csbJsonMeta');
      if (meta) meta.textContent = 'No record available for ' + path + ' yet.';
      return;
    }
    var buttons = document.querySelectorAll('.csb-ep');
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle('is-active', buttons[i] === button);
    var json = byId('csbJson');
    var meta = byId('csbJsonMeta');
    var raw = byId('csbRawLink');
    if (meta) meta.textContent = 'Loading /api/csb/' + resolved + ' …';
    if (raw) raw.href = '/api/csb/' + resolved.split('/').map(encodeURIComponent).join('/');

    api(resolved).then(function (result) {
      var text = JSON.stringify(result.data, null, 2);
      if (meta) {
        meta.textContent = '/api/csb/' + resolved + ' · ' + fmtInt(text.length) + ' bytes · ' +
          fmtClock(new Date()) + (result.stale ? ' · stale cache' : '');
      }
      if (text.length > 14000) text = text.slice(0, 14000) + '\n… truncated · open raw for the full payload';
      if (json) json.textContent = text;
      if (raw) raw.textContent = 'OPEN RAW';
    }).catch(function (err) {
      if (err && err.message === 'session expired') return;
      if (json) json.textContent = '…';
      if (meta) meta.textContent = err.message === 'csb not configured' ?
        'CSB_API_KEY is not configured on the server.' : 'Endpoint unavailable: ' + err.message;
    });
  }

  function buildEndpoints() {
    var host = byId('csbEndpoints');
    if (!host) return;
    host.innerHTML = ENDPOINTS.map(function (entry) {
      return '<button class="csb-ep" type="button" data-endpoint="' + esc(entry.path) + '">' +
        esc(entry.label) + '</button>';
    }).join('');
    host.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('.csb-ep') : null;
      if (!button) return;
      inspectEndpoint(button.getAttribute('data-endpoint'), button);
    });
  }

  function wireOverlay() {
    var button = byId('csbOverlayBtn');
    if (!button) return;
    button.addEventListener('click', function () {
      overlayOn = !overlayOn;
      button.textContent = overlayOn ? 'ON' : 'OFF';
      button.setAttribute('aria-pressed', String(overlayOn));
      if (!overlayOn && overlayGroup) overlayGroup.clearLayers();
      else drawOverlay();
    });
  }

  function showEmptyFeed(message) {
    ['csbTargets', 'csbIncoming', 'csbRecent'].forEach(function (id) {
      var host = byId(id);
      if (host) host.innerHTML = '<p class="csb-empty">' + esc(message) + '</p>';
    });
  }

  function showLoading() {
    var kpis = byId('csbKpis');
    if (kpis && !state.snapshot) {
      kpis.innerHTML = kpi('Active CSB vectors', '—', '') +
        kpi('Dutch targets', '—', '') +
        kpi('CSB impacts · 15m', '—', '') +
        kpi('CSB losses · 15m', '—', '');
    }
    showEmptyFeed('Connecting to CSB uplink…');
  }

  function loadConfig() {
    fetch('/api/csb/config', { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (response.status === 401) {
          sessionLost();
          throw new Error('session expired');
        }
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || 'config unavailable');
          return data;
        });
      })
      .then(function (config) {
        state.configured = !!config.configured;
        var host = byId('csbHost');
        if (host && config.host) host.textContent = config.host;
        if (!config.configured) {
          setLink('error', 'NOT CONFIGURED', 'Add CSB_API_KEY to the server environment.');
          showEmptyFeed('CSB uplink is not configured. Add CSB_API_KEY to the server environment.');
        }
      })
      .catch(function (err) {
        if (err && err.message === 'session expired') return;
        setLink('error', 'UPLINK LOST', err.message);
      });
  }

  function loadSnapshot() {
    if (document.hidden || snapshotLoading) return;
    if (!state.configured && Date.now() - lastAttempt < 15000) return;
    lastAttempt = Date.now();
    snapshotLoading = true;
    api('snapshot').then(function (result) {
      state.configured = true;
      state.snapshot = result.data;
      setLink(result.stale ? 'connecting' : 'live', result.stale ? 'CSB DELAYED' : 'CSB LIVE',
        'Updated ' + fmtClock(new Date()) + (result.stale ? ' · serving cached data' : ''));
      trackEvents(result.data);
      render();
    }).catch(function (err) {
      if (err && err.message === 'session expired') return;
      if (err && err.message === 'csb not configured') {
        showEmptyFeed('CSB uplink is not configured. Add CSB_API_KEY to the server environment.');
        return;
      }
      setLink('error', 'UPLINK LOST', err.message);
      if (!state.snapshot) showEmptyFeed('CSB uplink unreachable. Retrying automatic uplink…');
    }).then(function () {
      snapshotLoading = false;
    });
  }

  function loadSites() {
    api('launch-sites').then(function (result) {
      state.sites = Array.isArray(result.data.launch_sites) ? result.data.launch_sites : [];
      renderSites();
      drawOverlay();
    }).catch(function (err) {
      if (err && err.message === 'session expired') return;
      var meta = byId('csbSitesMeta');
      if (meta) meta.textContent = 'feed unavailable';
    });
  }

  function loadWeapons() {
    api('weapons').then(function (result) {
      state.weapons = Array.isArray(result.data.weapons) ? result.data.weapons : [];
      renderWeapons();
      renderSites();
    }).catch(function (err) {
      if (err && err.message === 'session expired') return;
      var meta = byId('csbWeaponsMeta');
      if (meta) meta.textContent = 'feed unavailable';
    });
  }

  function loadFrontline() {
    api('frontline').then(function (result) {
      var geo = result.data && result.data.geojson ? result.data.geojson : result.data;
      state.frontline = geo && geo.type === 'FeatureCollection' ? geo : null;
      drawOverlay();
    }).catch(function (err) {
      if (err && err.message === 'session expired') return;
    });
  }

  function init() {
    if (!byId('panel-csb')) return;
    buildEndpoints();
    wireOverlay();
    showLoading();
    loadConfig();
    loadSnapshot();
    loadFrontline();
    loadSites();
    loadWeapons();

    timer = window.setInterval(loadSnapshot, POLL_MS);
    auxTimer = window.setInterval(loadFrontline, AUX_MS);
    siteTimer = window.setInterval(function () {
      if (document.hidden) return;
      loadSites();
      loadWeapons();
    }, SITE_MS);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) loadSnapshot();
    });

    window.addEventListener('beforeunload', function () {
      window.clearInterval(timer);
      window.clearInterval(auxTimer);
      window.clearInterval(siteTimer);
    });

    if (location.hash === '#csb') {
      var tab = byId('tab-csb');
      if (tab) tab.click();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
