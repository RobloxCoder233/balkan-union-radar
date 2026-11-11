/* Balkan Union — air, border and war command console. */
(function () {
  'use strict';

  var BU = window.BU;
  if (!BU) return;

  var WORLD = window.BU_WORLD || { factions: {}, countries: [] };
  var FACTIONS = WORLD.factions;
  var COUNTRY_META = {};
  WORLD.countries.forEach(function (country) { COUNTRY_META[country.id] = country; });

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  var EUROPE_BOUNDS = [[34.0, -11.0], [60.0, 44.0]];
  var MINOR_LABELS = {
    andorra: true, malta: true, 'san-marino': true, liechtenstein: true, luxembourg: true,
    cyprus: true, 'northern-cyprus': true, kosovo: true, montenegro: true, slovenia: true,
    'north-macedonia': true, moldova: true, belgium: true
  };

  var FILTER_LABELS = {
    ballistic: 'Ballistic missiles',
    cruise: 'Cruise missiles',
    jet: 'Jet drones',
    shahed: 'Shahed drones'
  };

  var SEA_LABELS = [
    ['Adriatic Sea', [42.9, 15.55]],
    ['Ionian Sea', [37.75, 18.85]],
    ['Aegean Sea', [38.55, 25.15]],
    ['Black Sea', [43.05, 33.15]],
    ['Tyrrhenian Sea', [39.55, 13.05]],
    ['Mediterranean Sea', [34.95, 19.9]]
  ];

  var timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BU.META.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  var dateFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BU.META.timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtEta(seconds) {
    seconds = Math.max(0, Math.ceil(seconds));
    var minutes = Math.floor(seconds / 60);
    return minutes + ':' + String(seconds % 60).padStart(2, '0');
  }

  function fmtAlt(km) {
    if (km < 1) return Math.round(km * 1000).toLocaleString('en-GB') + ' m';
    return km.toFixed(1) + ' km';
  }

  function fmtAgo(timestamp) {
    var seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return seconds + 's ago';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's ago';
    return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm ago';
  }

  function fmtClock(timestamp) {
    return timeFormatter.format(new Date(timestamp));
  }

  function fmtCompact(value) {
    if (value >= 1000000) {
      var millions = value / 1000000;
      return (millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, '')) + 'M';
    }
    if (value >= 1000) return Math.round(value / 1000) + 'K';
    return String(value);
  }

  function shortenEta(alert) {
    return '<span class="alert-eta" data-eta>' + fmtEta(alert.eta) + '</span>';
  }

  function factionOf(id) {
    var meta = COUNTRY_META[id];
    return (meta && FACTIONS[meta.faction]) || FACTIONS.neutral || { color: '#64748b', fill: '#111823', line: '#2b3546', name: 'Non-aligned' };
  }

  function pointInRing(pt, ring) {
    var x = pt[0], y = pt[1], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function pointInGeometry(pt, geometry) {
    if (!geometry) return false;
    var polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (var i = 0; i < polys.length; i++) {
      var poly = polys[i];
      if (!pointInRing(pt, poly[0])) continue;
      var hole = false;
      for (var h = 1; h < poly.length; h++) if (pointInRing(pt, poly[h])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }

  function threatSvg(glyph) {
    var paths = {
      ballistic: '<path d="M0 -12C3 -8 4.2 -3 3.4 4L1.2 9H-1.2L-3.4 4C-4.2 -3 -3 -8 0 -12Z" fill="currentColor"/><path d="M-3.4 4 -7.6 10.2 -2.2 8.6Z" fill="currentColor" opacity=".75"/><path d="M3.4 4 7.6 10.2 2.2 8.6Z" fill="currentColor" opacity=".75"/>',
      cruise: '<path d="M0 -11C2 -10 2.4 -6 2.2 -2L10 4V6L2.2 4L2.6 9L5 11V12L0 11L-5 12V11L-2.6 9L-2.2 4L-10 6V4L-2.2 -2C-2.4 -6 -2 -10 0 -11Z" fill="currentColor"/>',
      jet: '<path d="M0 -11 2.2 -2 11 7 9.5 9 2 6 1.8 10 4 12 0 11 -4 12 -1.8 10 -2 6 -9.5 9 -11 7 -2.2 -2Z" fill="currentColor"/>',
      shahed: '<path d="M0 -11 3 -3 12 8 5 7 0 12 -5 7 -12 8 -3 -3Z" fill="currentColor"/><path d="M0 -6 1.4 0 0 6 -1.4 0Z" fill="#0a0d12" opacity=".55"/>'
    };
    return '<svg viewBox="-13 -13 26 26" aria-hidden="true">' + (paths[glyph] || paths.shahed) + '</svg>';
  }

  /* ---------------- Siren ---------------- */

  function Siren() {
    this.enabled = false;
    this.mode = 'idle';
    this.pendingMode = 'idle';
    this.timer = null;
    this.ctx = null;
    this.master = null;
  }

  Siren.prototype.ensureContext = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.075;
    this.master.connect(this.ctx.destination);
    return true;
  };

  Siren.prototype.toggle = function () {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.ensureContext();
      this.applyMode(this.pendingMode, true);
    } else {
      this.stop();
    }
    return this.enabled;
  };

  Siren.prototype.setMode = function (mode) {
    this.pendingMode = mode;
    if (!this.enabled) {
      this.mode = 'idle';
      return;
    }
    this.applyMode(mode, false);
  };

  Siren.prototype.applyMode = function (mode, force) {
    if (!this.enabled) { this.mode = 'idle'; return; }
    if (!force && this.mode === mode && this.timer) return;
    this.stop();
    this.mode = mode;
    if (mode === 'idle') return;
    this.beat();
    this.timer = window.setInterval(this.beat.bind(this), mode === 'wail' ? 3500 : 1200);
  };

  Siren.prototype.stop = function () {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    this.mode = 'idle';
  };

  Siren.prototype.beat = function () {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    var t = this.ctx.currentTime;

    if (this.mode === 'wail') {
      var osc = this.ctx.createOscillator();
      var gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(430, t);
      osc.frequency.linearRampToValueAtTime(920, t + 1.55);
      osc.frequency.linearRampToValueAtTime(430, t + 3.1);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
      gain.gain.setValueAtTime(0.5, t + 2.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 3.5);
    } else if (this.mode === 'beep') {
      [0, 0.2, 0.4].forEach(function (offset, index) {
        var osc = this.ctx.createOscillator();
        var gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = index === 1 ? 660 : 880;
        gain.gain.setValueAtTime(0.0001, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.4, t + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.14);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t + offset);
        osc.stop(t + offset + 0.16);
      }, this);
    }
  };

  /* ---------------- Map ---------------- */

  function MapView(sim) {
    this.sim = sim;
    this.war = null;
    this.ready = false;
    this.countryMeta = COUNTRY_META;
    this.adminToId = {};
    this.countryLayers = {};
    this.zoneLayers = {};
    this.zoneLabels = {};
    this.labels = {};
    this.capitalMarkers = {};
    this.capitalState = {};
    this.countyLayers = {};
    this.countyState = {};
    this.countyCls = {};
    this.countyZoom = null;
    this.countyById = {};
    this.cityCounty = {};
    this.alertCountyGroup = null;
    this.alertCountySig = '';
    this.warRevision = -1;
    this.captureMarkers = {};
    this.unitMarkers = {};
    this.unitIds = '';
    this.countyLayer = null;
    this.threats = {};
    this.alertMap = {};
    this.alertSig = '';
    this.borderSig = '';
    this.borderMarkers = {};
    this.threatLayer = null;
  }

  MapView.prototype.baseStyle = function (countryId) {
    var meta = this.countryMeta[countryId];
    var faction = meta ? FACTIONS[meta.faction] : null;
    if (!faction) {
      return { color: '#2b3546', weight: 0.7, opacity: 0.9, fillColor: '#111823', fillOpacity: 0.9 };
    }
    return {
      color: faction.line,
      weight: meta.faction === 'balkan' ? 1.1 : 0.65,
      opacity: 0.85,
      fillColor: faction.fill,
      fillOpacity: meta.faction === 'balkan' ? 0.62 : (meta.faction === 'neutral' ? 0.88 : 0.48)
    };
  };

  MapView.prototype.init = function () {
    if (!window.L || !window.BU_EUROPE) {
      var fallback = $('#mapFallback');
      if (fallback) fallback.hidden = false;
      return;
    }

    var self = this;
    WORLD.countries.forEach(function (country) {
      self.adminToId[country.admin] = country.id;
    });

    this.map = L.map('map', {
      zoomControl: false,
      minZoom: 4,
      maxZoom: 9,
      zoomSnap: 0.25,
      attributionControl: true
    });
    window.BU_MAP = this.map;

    L.control.zoom({ position: 'topleft' }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    this.map.attributionControl.addAttribution('Borders: Natural Earth · Fiction: Balkan Union');

    var params = new URLSearchParams(window.location.search);
    var view = (params.get('view') || '').split(',').map(Number);
    if (view.length === 3 && view.every(function (n) { return isFinite(n); })) {
      this.map.setView([view[0], view[1]], view[2], { animate: false });
    } else {
      this.map.fitBounds(EUROPE_BOUNDS, { padding: [18, 18], maxZoom: 5.25 });
    }

    L.geoJSON(window.BU_EUROPE, {
      style: function (feature) { return self.baseStyle(feature.properties.id); },
      onEachFeature: function (feature, layer) {
        var id = feature.properties.id;
        self.countryLayers[id] = layer;
        layer.on('click', function () { self.openCountryPopup(id); });
        if (feature.properties.union) {
          self.zoneLayers[feature.properties.admin] = { layer: layer, countryId: id };
        }
      }
    }).addTo(this.map);

    if (window.BU_UNION_OUTLINE) {
      L.geoJSON(window.BU_UNION_OUTLINE, {
        style: { color: '#ff3b3b', weight: 6, opacity: 0.07, interactive: false }
      }).addTo(this.map);
      L.geoJSON(window.BU_UNION_OUTLINE, {
        style: { color: '#ff4040', weight: 1.6, opacity: 0.85, interactive: false }
      }).addTo(this.map);
    }

    if (window.BU_COUNTIES) {
      var countyFeatures = window.BU_COUNTIES.features;
      countyFeatures.forEach(function (feature) {
        self.countyById[feature.properties.id] = feature;
      });
      this.countyLayer = L.geoJSON(window.BU_COUNTIES, {
        interactive: false,
        style: function (feature) {
          return {
            color: '#2f4a6c',
            weight: 0.6,
            opacity: 0.55,
            fillColor: factionOf(feature.properties.country).fill,
            fillOpacity: 0
          };
        },
        onEachFeature: function (feature, layer) {
          self.countyLayers[feature.properties.id] = layer;
        }
      }).addTo(this.map);

      BU.CITIES.forEach(function (city) {
        var point = [city.lon, city.lat];
        for (var i = 0; i < countyFeatures.length; i++) {
          if (pointInGeometry(point, countyFeatures[i].geometry)) {
            self.cityCounty[city.name] = countyFeatures[i].properties.id;
            break;
          }
        }
      });
    }

    this.alertCountyGroup = L.layerGroup().addTo(this.map);

    WORLD.countries.forEach(function (meta) {
      var point = meta.labelAt || meta.center;
      if (!point) return;
      var cls = 'country-label faction-' + meta.faction +
        (meta.union ? ' is-union' : '') +
        (MINOR_LABELS[meta.id] ? ' is-minor' : '') +
        (meta.faction === 'neutral' ? ' is-neighbour' : '');
      var marker = L.marker(point, {
        icon: L.divIcon({
          className: cls,
          html: '<span>' + escapeHtml(meta.short || meta.name) + '</span>',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        }),
        interactive: false,
        keyboard: false
      }).addTo(self.map);
      self.labels[meta.id] = marker;
      if (meta.union) self.zoneLabels[meta.admin] = marker;
    });

    WORLD.countries.forEach(function (meta) {
      if (!meta.capitalAt) return;
      var marker = L.marker(meta.capitalAt, {
        icon: L.divIcon({
          className: 'capital-icon' + (meta.union ? ' is-union' : ''),
          html: '<span class="cap-star"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 14.9 8.7 21.6 9.6 16.8 14.2 18 20.9 12 17.6 6 20.9 7.2 14.2 2.4 9.6 9.1 8.7Z" fill="currentColor"/></svg></span>',
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        }),
        interactive: false,
        keyboard: false
      }).addTo(self.map);
      marker.bindTooltip(escapeHtml(meta.capital) + ' · ' + escapeHtml(meta.name), { direction: 'top', offset: [0, -6] });
      self.capitalMarkers[meta.id] = marker;
    });

    SEA_LABELS.forEach(function (entry) {
      L.marker(entry[1], {
        icon: L.divIcon({
          className: 'country-label is-sea',
          html: '<span>' + escapeHtml(entry[0]) + '</span>',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        }),
        interactive: false,
        keyboard: false
      }).addTo(self.map);
    });

    BU.LAUNCH_SITES.forEach(function (site) {
      L.circleMarker([site.lat, site.lon], {
        radius: 3,
        color: '#65748b',
        weight: 1,
        opacity: 0.8,
        fillColor: '#65748b',
        fillOpacity: 0.5
      }).addTo(self.map).bindTooltip('Launch site · ' + site.name, { direction: 'top', offset: [0, -4] });
    });

    BU.BORDER_SECTORS.forEach(function (sector) {
      var marker = L.circleMarker([sector.lat, sector.lon], {
        radius: 4.5,
        color: '#34d399',
        weight: 1.5,
        opacity: 0.9,
        fillColor: '#34d399',
        fillOpacity: 0.45
      }).addTo(self.map);
      marker.bindTooltip(sector.name, { direction: 'top', offset: [0, -5] });
      marker.on('click', function () {
        self.focusSector(sector.id);
        activateTab('border');
      });
      self.borderMarkers[sector.id] = marker;
    });

    this.threatLayer = L.layerGroup().addTo(this.map);
    this.ready = true;

    var syncZoom = function () {
      var shell = $('.map-shell');
      if (shell) shell.classList.toggle('is-lowzoom', self.map.getZoom() < 5.75);
    };
    this.map.on('zoomend', function () {
      syncZoom();
      if (self.war) self.renderWar(self.war.getState());
    });
    syncZoom();

    window.addEventListener('resize', function () { self.map.invalidateSize(); });
    window.setTimeout(function () { self.map.invalidateSize(); }, 200);
  };

  MapView.prototype.render = function (state, filters) {
    if (!this.ready) return;
    this.renderAlerts(state);
    this.renderBorder(state);
    this.renderThreats(state, filters);
  };

  MapView.prototype.eachPath = function (layer, handler) {
    if (layer.eachLayer) layer.eachLayer(handler);
    else handler(layer);
  };

  MapView.prototype.resetView = function () {
    if (!this.map) return;
    this.map.fitBounds(EUROPE_BOUNDS, { padding: [18, 18], maxZoom: 5.25 });
  };

  MapView.prototype.countyStyleFor = function (county, highZoom) {
    var base = {
      color: highZoom ? '#456a97' : '#2f4a6c',
      weight: highZoom ? 0.8 : 0.6,
      opacity: highZoom ? 0.7 : 0.55,
      dashArray: null,
      fillColor: factionOf(county.owner).fill,
      fillOpacity: 0
    };
    if (county.capture) {
      var side = factionOf(county.capture.by === 'balkan' ? 'croatia' : county.capture.by);
      var p = Math.max(0, Math.min(1, county.capture.progress || 0));
      return {
        color: side.line || side.color,
        weight: 1.5,
        opacity: 0.95,
        dashArray: '5 3',
        fillColor: side.color,
        fillOpacity: 0.14 + p * 0.48
      };
    }
    if (county.controller !== county.owner) {
      var controller = factionOf(county.controller);
      return {
        color: controller.line,
        weight: 0.9,
        opacity: 0.95,
        dashArray: null,
        fillColor: controller.fill,
        fillOpacity: 0.78
      };
    }
    if (highZoom) {
      base.fillColor = factionOf(county.owner).fill;
      base.fillOpacity = 0.06;
    }
    return base;
  };

  MapView.prototype.renderWar = function (warState) {
    if (!this.ready || !warState) return;
    var self = this;
    var zoom = this.map.getZoom();
    var highZoom = zoom >= 5.25;

    if (warState.revision !== this.warRevision || highZoom !== this.countyZoom) {
      this.warRevision = warState.revision;
      this.countyZoom = highZoom;
      warState.counties.forEach(function (county) {
        var layer = self.countyLayers[county.id];
        if (!layer) return;
        var key = county.controller + '|' + county.owner + '|' + county.control + '|' +
          (county.capture ? county.capture.by + ':' + Math.round(county.capture.progress * 100) : '-') +
          '|' + (highZoom ? 1 : 0);
        if (self.countyState[county.id] === key) return;
        self.countyState[county.id] = key;
        layer.setStyle(self.countyStyleFor(county, highZoom));
        var capturing = !!county.capture;
        var occupied = county.controller !== county.owner;
        var cls = capturing ? 'capturing' : (occupied ? 'occupied' : '');
        if (self.countyCls[county.id] === cls) return;
        self.countyCls[county.id] = cls;
        self.eachPath(layer, function (sub) {
          var el = sub.getElement ? sub.getElement() : null;
          if (!el) return;
          el.classList.toggle('is-capturing', capturing);
          el.classList.toggle('is-occupied', occupied);
        });
      });
    }

    Object.keys(this.captureMarkers).forEach(function (id) {
      self.captureMarkers[id].active = false;
    });
    var nextCaptures = {};
    warState.counties.forEach(function (county) {
      if (!county.capture) return;
      var side = factionOf(county.capture.by === 'balkan' ? 'croatia' : county.capture.by);
      var color = county.capture.by === 'balkan' ? FACTIONS.balkan.color : side.color;
      var progress = Math.max(0, Math.min(1, county.capture.progress || 0));
      var record = self.captureMarkers[county.id];
      if (!record) {
        var marker = L.marker(county.center, {
          icon: L.divIcon({
            className: 'capture-icon',
            html: '<div class="capture-spike" style="--c:' + color + ';--p:' + progress.toFixed(2) + '">' +
              '<span class="spike-orbit"></span><span class="spike-star"></span><span class="spike-core"></span></div>',
            iconSize: [46, 46],
            iconAnchor: [23, 23]
          }),
          interactive: false,
          zIndexOffset: 900
        }).addTo(self.map);
        record = { marker: marker, active: true };
        self.captureMarkers[county.id] = record;
      }
      record.active = true;
      nextCaptures[county.id] = true;
      var el = record.marker.getElement ? record.marker.getElement() : null;
      var spike = el ? el.querySelector('.capture-spike') : null;
      if (spike) {
        var sig = color + ':' + Math.round(progress * 100);
        if (spike.dataset.sig !== sig) {
          spike.dataset.sig = sig;
          spike.style.setProperty('--c', color);
          spike.style.setProperty('--p', progress.toFixed(2));
        }
      }
    });
    Object.keys(this.captureMarkers).forEach(function (id) {
      if (!nextCaptures[id]) {
        self.captureMarkers[id].marker.remove();
        delete self.captureMarkers[id];
      }
    });

    this.renderUnits(warState);
    this.renderCapitals(warState);
  };

  MapView.prototype.renderUnits = function (warState) {
    var self = this;
    var ids = [];
    warState.units.forEach(function (unit) {
      ids.push(unit.id);
      var faction = FACTIONS[unit.side] || FACTIONS.neutral;
      var record = self.unitMarkers[unit.id];
      if (!record) {
        var marker = L.marker([unit.lat, unit.lon], {
          icon: L.divIcon({
            className: 'troop-icon',
            html: '<div class="troop-marker" style="--c:' + faction.color + '">' +
              '<span class="troop-chevron"><svg viewBox="-10 -10 20 20" aria-hidden="true">' +
              '<path d="M0 -8 6.4 8 0 4.2 -6.4 8Z" fill="currentColor"/></svg></span></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          }),
          interactive: false,
          zIndexOffset: 1100
        }).addTo(self.map);
        var trail = L.polyline([[unit.start[0], unit.start[1]], [unit.lat, unit.lon]], {
          color: faction.color, weight: 1, opacity: 0.35, dashArray: '2 4', interactive: false
        }).addTo(self.map);
        record = { marker: marker, trail: trail, glyph: marker.getElement() ? marker.getElement().querySelector('.troop-chevron') : null };
        self.unitMarkers[unit.id] = record;
      }
      record.marker.setLatLng([unit.lat, unit.lon]);
      record.trail.setLatLngs([[unit.start[0], unit.start[1]], [unit.lat, unit.lon]]);
      if (!record.glyph) {
        var markerEl = record.marker.getElement ? record.marker.getElement() : null;
        record.glyph = markerEl ? markerEl.querySelector('.troop-chevron') : null;
      }
      if (record.glyph) record.glyph.style.transform = 'rotate(' + unit.bearing.toFixed(1) + 'deg)';
    });

    var idSig = ids.join(',');
    if (idSig !== this.unitIds) {
      var wanted = {};
      ids.forEach(function (id) { wanted[id] = true; });
      Object.keys(this.unitMarkers).forEach(function (id) {
        if (wanted[id]) return;
        self.unitMarkers[id].marker.remove();
        self.unitMarkers[id].trail.remove();
        delete self.unitMarkers[id];
      });
      this.unitIds = idSig;
    }
  };

  MapView.prototype.renderCapitals = function (warState) {
    var self = this;
    Object.keys(this.capitalMarkers).forEach(function (id) {
      var country = warState.countries[id];
      var cooked = !!(country && (country.capitalCaptured || country.cooked));
      if (self.capitalState[id] === cooked) return;
      self.capitalState[id] = cooked;
      var el = self.capitalMarkers[id].getElement ? self.capitalMarkers[id].getElement() : null;
      if (el) el.classList.toggle('is-cooked', cooked);
    });
  };

  MapView.prototype.openCountryPopup = function (id) {
    var meta = this.countryMeta[id];
    if (!meta) return;
    var faction = factionOf(id);
    var country = this.war ? this.war.getCountry(id) : null;
    var alert = this.alertMap[meta.admin];
    var counties = this.war ? (this.war.countyByCountry[id] || []).length : meta.countyCount;
    var status = country && country.cooked ? '<span class="pop-alert" style="color:#ef4444">COOKED · CAPITAL LOST</span>' :
      country && country.status === 'at war' ? '<span class="pop-alert" style="color:#f59e0b">AT WAR</span>' :
      alert ? '<span class="pop-alert" style="color:' + alert.color + '">' +
        escapeHtml(alert.level.toUpperCase()) + ' · ' + fmtEta(alert.eta) + ' ETA</span>' :
      '<span class="pop-clear">' + (meta.union ? 'Union member · clear' : 'No active alert') + '</span>';
    var check = this.war ? this.war.canDeclareWar(id) : { ok: false, error: 'Command net offline.' };
    var action = check.ok ?
      '<button class="pop-declare" type="button" data-declare="' + escapeHtml(id) + '">Declare war</button>' :
      '<span class="pop-locked">' + escapeHtml(check.error) + '</span>';
    var html = '<div class="zone-pop">' +
      '<strong>' + escapeHtml(meta.name) + '</strong>' +
      '<span class="pop-meta">' + escapeHtml(faction.name) + ' · ' + escapeHtml(meta.capital || '') + '</span>' +
      '<span class="pop-meta">AI ' + escapeHtml(meta.leader ? meta.leader.name : '—') + ' · ' + counties + ' counties · power ' + meta.power + '</span>' +
      status + action +
      '</div>';
    L.popup({ className: 'zone-popup', closeButton: true, offset: [0, -2] })
      .setLatLng(meta.capitalAt || meta.center)
      .setContent(html)
      .openOn(this.map);
  };

  MapView.prototype.renderAlerts = function (state) {
    var self = this;
    var map = {};
    state.alerts.forEach(function (alert) { map[alert.zone] = alert; });
    var signature = state.alerts.map(function (alert) {
      return alert.zone + ':' + alert.level + ':' + alert.dominant + ':' + (alert.targets || []).join(',');
    }).join('|');

    this.alertMap = map;
    if (signature === this.alertSig) return;
    this.alertSig = signature;

    Object.keys(this.zoneLayers).forEach(function (key) {
      var entry = self.zoneLayers[key];
      var alert = map[key];
      var base = self.baseStyle(entry.countryId);
      var style = alert ? {
        color: alert.color,
        weight: alert.level === 'critical' ? 1.9 : 1.35,
        opacity: 1,
        dashArray: null,
        fillColor: base.fillColor,
        fillOpacity: Math.min(0.9, base.fillOpacity + (alert.level === 'critical' ? 0.08 : 0.05))
      } : base;
      entry.layer.setStyle(style);
      self.eachPath(entry.layer, function (sublayer) {
        var el = sublayer.getElement ? sublayer.getElement() : null;
        if (!el) return;
        el.classList.toggle('zone-hot', !!alert);
        el.classList.toggle('zone-critical', !!alert && alert.level === 'critical');
      });
    });

    Object.keys(this.zoneLabels).forEach(function (key) {
      var marker = self.zoneLabels[key];
      var el = marker.getElement ? marker.getElement() : null;
      if (!el) return;
      var alert = map[key];
      el.classList.toggle('is-hot', !!alert);
      el.classList.toggle('is-critical', !!alert && alert.level === 'critical');
      el.style.setProperty('--c', alert ? alert.color : 'transparent');
    });

    var chosen = {};
    state.alerts.forEach(function (alert) {
      var cities = (alert.targets || []).slice();
      if (alert.focus && alert.focus.city && cities.indexOf(alert.focus.city) < 0) cities.push(alert.focus.city);
      cities.forEach(function (name) {
        var id = self.cityCounty[name];
        if (!id) return;
        var prev = chosen[id];
        if (!prev || (prev.level !== 'critical' && alert.level === 'critical')) {
          chosen[id] = { level: alert.level, color: alert.color };
        }
      });
    });

    var ids = Object.keys(chosen);
    var countySig = ids.map(function (id) { return id + ':' + chosen[id].level + ':' + chosen[id].color; }).join('|');
    if (countySig === this.alertCountySig) return;
    this.alertCountySig = countySig;
    this.alertCountyGroup.clearLayers();
    Object.keys(this.labels).forEach(function (cid) {
      var el = self.labels[cid].getElement ? self.labels[cid].getElement() : null;
      if (el) el.style.display = '';
    });
    if (!ids.length) return;

    var features = ids.map(function (id) {
      return { type: 'Feature', properties: { id: id }, geometry: self.countyById[id].geometry };
    });
    L.geoJSON({ type: 'FeatureCollection', features: features }, {
      interactive: false,
      className: 'alert-county',
      style: function (feature) {
        var entry = chosen[feature.properties.id];
        return {
          color: entry.color,
          weight: entry.level === 'critical' ? 2.2 : 1.6,
          opacity: 0.98,
          dashArray: null,
          fillColor: entry.color,
          fillOpacity: entry.level === 'critical' ? 0.72 : 0.55
        };
      }
    }).addTo(this.alertCountyGroup);

    ids.forEach(function (id) {
      var entry = chosen[id];
      var county = self.countyById[id];
      if (!county) return;
      L.marker(county.properties.center, {
        icon: L.divIcon({
          className: 'alert-county-label',
          html: '<span style="--c:' + entry.color + '">' + escapeHtml(county.properties.name) + '</span>',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        }),
        interactive: false,
        keyboard: false
      }).addTo(self.alertCountyGroup);
    });

    var alertedCountries = {};
    ids.forEach(function (id) {
      alertedCountries[self.countyById[id].properties.country] = true;
    });
    Object.keys(alertedCountries).forEach(function (cid) {
      var marker = self.labels[cid];
      var el = marker && marker.getElement ? marker.getElement() : null;
      if (el) el.style.display = 'none';
    });
  };

  MapView.prototype.renderBorder = function (state) {
    var self = this;
    var signature = state.sectors.map(function (row) { return row.sector.id + ':' + row.level; }).join('|');
    if (signature === this.borderSig) return;
    this.borderSig = signature;

    state.sectors.forEach(function (row) {
      var marker = self.borderMarkers[row.sector.id];
      if (!marker) return;
      var meta = BU.BORDER_LEVELS[row.level];
      marker.setStyle({
        color: meta.color,
        fillColor: meta.color,
        fillOpacity: row.level === 'calm' ? 0.35 : 0.75,
        weight: row.level === 'critical' ? 2 : 1.5
      });
      var el = marker.getElement ? marker.getElement() : null;
      if (el) {
        el.classList.toggle('border-critical', row.level === 'critical');
        el.classList.toggle('border-elevated', row.level === 'elevated');
      }
      marker.setTooltipContent(escapeHtml(row.sector.name) + '\n' + meta.label + ' · ' + escapeHtml(row.sector.neighbour));
    });
  };

  MapView.prototype.threatSamples = function (threat) {
    var samples = [];
    for (var i = 0; i <= 32; i++) {
      var point = this.sim.positionAt(threat, i / 32);
      samples.push([point.lat, point.lon]);
    }
    return samples;
  };

  MapView.prototype.createThreat = function (threat) {
    var self = this;
    var color = threat.color;
    var icon = L.divIcon({
      className: 'threat-icon',
      html: '<div class="threat-halo" style="color:' + color + '"></div>' +
        '<div class="threat-glyph" style="color:' + color + '">' + threatSvg(BU.THREAT_CLASSES[threat.cls].glyph) + '</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    var marker = L.marker([threat.lat, threat.lon], {
      icon: icon,
      zIndexOffset: 1200,
      riseOnHover: true
    }).addTo(this.map);

    var samples = this.threatSamples(threat);
    var planned = L.polyline(samples, {
      color: color, weight: 1, opacity: 0.24, dashArray: '2 6', interactive: false
    }).addTo(this.map);
    var glow = L.polyline(samples.slice(0, 2), {
      color: color, weight: 6, opacity: 0.1, interactive: false
    }).addTo(this.map);
    var trail = L.polyline(samples.slice(0, 2), {
      color: color, weight: 1.8, opacity: 0.65, interactive: false
    }).addTo(this.map);

    var targetMarker = L.circleMarker([threat.target.lat, threat.target.lon], {
      radius: 3,
      color: '#f4f7fc',
      weight: 1,
      opacity: 0.75,
      fillColor: color,
      fillOpacity: 0.85,
      interactive: false
    }).addTo(this.map);

    var glyph = marker.getElement() ? marker.getElement().querySelector('.threat-glyph') : null;
    var record = {
      marker: marker,
      planned: planned,
      glow: glow,
      trail: trail,
      targetMarker: targetMarker,
      glyph: glyph,
      samples: samples
    };

    marker.on('click', function () {
      marker.openTooltip();
    });

    this.threats[threat.id] = record;
    return record;
  };

  MapView.prototype.renderThreats = function (state, filters) {
    var self = this;
    var active = {};
    state.threats.forEach(function (threat) {
      if (filters.has(threat.cls)) active[threat.id] = threat;
    });

    Object.keys(this.threats).forEach(function (id) {
      if (!active[id]) self.removeThreat(id);
    });

    state.threats.forEach(function (threat) {
      if (!filters.has(threat.cls)) return;
      var record = self.threats[threat.id] || self.createThreat(threat);
      record.marker.setLatLng([threat.lat, threat.lon]);

      if (record.glyph) record.glyph.style.transform = 'rotate(' + threat.heading.toFixed(1) + 'deg)';

      var index = Math.max(2, Math.round(threat.progress * record.samples.length));
      var traveled = record.samples.slice(0, Math.min(index, record.samples.length));
      record.trail.setLatLngs(traveled);
      record.glow.setLatLngs(traveled);

      record.marker.setTooltipContent(
        '<b>' + escapeHtml(threat.weapon) + '</b> · ' + escapeHtml(threat.label) + '\n' +
        '→ ' + escapeHtml(threat.target.city) + ' · ETA ' + fmtEta(threat.eta) + '\n' +
        'ALT ' + fmtAlt(threat.altitude) + ' · HDG ' + Math.round(threat.heading) + '°'
      );
    });
  };

  MapView.prototype.removeThreat = function (id) {
    var record = this.threats[id];
    if (!record) return;
    record.marker.remove();
    record.planned.remove();
    record.glow.remove();
    record.trail.remove();
    if (record.targetMarker) record.targetMarker.remove();
    delete this.threats[id];
  };

  MapView.prototype.flashLayer = function (layer) {
    var layers = [];
    this.eachPath(layer, function (sublayer) {
      var el = sublayer.getElement ? sublayer.getElement() : null;
      if (!el) return;
      el.classList.add('zone-focus');
      layers.push(el);
    });
    window.setTimeout(function () {
      layers.forEach(function (el) { el.classList.remove('zone-focus'); });
    }, 2200);
  };

  MapView.prototype.focusCountry = function (id) {
    if (!this.ready) return;
    var layer = this.countryLayers[id];
    if (!layer) return;
    this.map.flyToBounds(layer.getBounds(), { padding: [38, 38], maxZoom: 6.4, duration: 0.8 });
    this.flashLayer(layer);
  };

  MapView.prototype.focusCounty = function (id) {
    if (!this.ready) return;
    var layer = this.countyLayers[id];
    if (!layer) return;
    var bounds = layer.getBounds ? layer.getBounds() : null;
    if (bounds && bounds.isValid()) {
      this.map.flyToBounds(bounds, { padding: [55, 55], maxZoom: 7.4, duration: 0.65 });
    }
    this.flashLayer(layer);
  };

  MapView.prototype.focusZone = function (zoneKey) {
    if (!this.ready) return;
    var entry = this.zoneLayers[zoneKey];
    if (!entry) return;
    this.focusCountry(entry.countryId);
  };

  MapView.prototype.focusSector = function (sectorId) {
    if (!this.ready) return;
    var sector = BU.BORDER_SECTORS.filter(function (item) { return item.id === sectorId; })[0];
    if (!sector) return;
    this.map.flyTo([sector.lat, sector.lon], Math.max(this.map.getZoom(), 6.5), { duration: 0.7 });
    var marker = this.borderMarkers[sectorId];
    if (marker) {
      var el = marker.getElement ? marker.getElement() : null;
      if (el) {
        el.classList.add('border-focus');
        window.setTimeout(function () { el.classList.remove('border-focus'); }, 1800);
      }
    }
  };

  MapView.prototype.boom = function (point, kind) {
    if (!this.ready || !point) return;
    var color = kind === 'impact' ? '#ef4444' : '#22c55e';
    var icon = L.divIcon({
      className: 'boom-icon',
      html: '<div class="boom-ring" style="--c:' + color + '"></div>' +
        '<div class="boom-ring" style="--c:' + color + '"></div>' +
        '<div class="boom-core" style="--c:' + color + '"></div>',
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
    var marker = L.marker([point.lat, point.lon], { icon: icon, interactive: false, zIndexOffset: 2000 }).addTo(this.map);
    window.setTimeout(function () { marker.remove(); }, 1500);
  };

  /* ---------------- App ---------------- */

  var sim = new BU.Simulation();
  var warSim = new BU.WarSim();
  var mapView = new MapView(sim);
  mapView.war = warSim;
  var siren = new Siren();
  var filters = new Set(BU.CLASS_ORDER);
  var state = sim.getState(Date.now());
  var initialized = false;
  var lastStatus = null;
  var lastAlertSig = null;
  var lastThreatSig = null;
  var lastRecentSig = null;
  var lastBorderSig = null;
  var lastTitle = '';
  var seenZones = new Set();
  var seenIncidents = new Set();
  var seenRecent = new Set();
  var ui = {
    warSig: '',
    offerSig: '',
    feedSig: '',
    countrySig: ''
  };
  var pendingFocus = 0;

  function activateTab(name) {
    $$('.tab').forEach(function (tab) {
      var selected = tab.dataset.tab === name;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    $$('.panel').forEach(function (panel) {
      var selected = panel.id === 'panel-' + name;
      panel.classList.toggle('is-active', selected);
      panel.hidden = !selected;
    });
    var filtersHost = $('#filters');
    filtersHost.hidden = !(name === 'alerts' || name === 'threats');
  }

  function initTabs() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { activateTab(tab.dataset.tab); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        var tabs = $$('.tab');
        var index = tabs.indexOf(tab);
        var next = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        activateTab(tabs[next].dataset.tab);
      });
    });
  }

  function buildFilters() {
    var host = $('#filters');
    if (!host) return;
    host.innerHTML = BU.CLASS_ORDER.map(function (id) {
      var profile = BU.THREAT_CLASSES[id];
      return '<button type="button" class="filter" data-cls="' + id + '" aria-pressed="true" style="--c:' + profile.color + '">' +
        '<span class="dot"></span>' +
        '<span class="f-label">' + FILTER_LABELS[id] + '</span>' +
        '<span class="f-count" data-count="' + id + '">0</span>' +
        '</button>';
    }).join('');

    host.addEventListener('click', function (event) {
      var button = event.target.closest('.filter');
      if (!button) return;
      var id = button.dataset.cls;
      if (filters.has(id)) filters.delete(id);
      else filters.add(id);
      button.classList.toggle('is-off', !filters.has(id));
      button.setAttribute('aria-pressed', filters.has(id) ? 'true' : 'false');
      lastAlertSig = null;
      lastThreatSig = null;
      renderConsole(Date.now(), warSim.getState());
      mapView.render(state, filters);
    });
  }

  function toast(options) {
    var host = $('#toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--c', options.color || '#3b82f6');
    el.innerHTML = '<span class="toast-mark">' + escapeHtml(options.mark || 'ALERT') + '</span>' +
      '<div class="toast-body">' +
      '<div class="toast-title">' + escapeHtml(options.title) + '</div>' +
      (options.sub ? '<div class="toast-sub">' + escapeHtml(options.sub) + '</div>' : '') +
      '</div>';
    host.appendChild(el);
    while (host.children.length > 3) host.removeChild(host.firstElementChild);
    window.setTimeout(function () {
      el.classList.add('is-out');
      window.setTimeout(function () { el.remove(); }, 260);
    }, 4600);
  }

  function setStatusDisplay(now, ws) {
    var badge = $('#statusBadge');
    var text = $('#statusText');
    var statusClass;
    var label;
    var fronts = ws ? ws.activeWars.length : 0;

    if (fronts) {
      statusClass = 'is-war';
      label = 'WAR · ' + fronts + ' FRONT' + (fronts === 1 ? '' : 'S') +
        (state.alerts.length ? ' · AIR ' + state.alerts.length : '');
    } else if (state.status === 'air') {
      statusClass = 'is-air';
      label = 'AIR ALERT · ' + state.alerts.length + ' ZONE' + (state.alerts.length === 1 ? '' : 'S');
    } else if (state.status === 'border') {
      statusClass = 'is-border';
      label = 'BORDER ALERT';
    } else {
      statusClass = 'is-clear';
      label = 'ALL CLEAR';
    }
    badge.className = 'status-badge ' + statusClass;
    if (text.textContent !== label) text.textContent = label;

    var airCount = state.alerts.length;
    $('#hudAir').textContent = airCount;
    $('#hudBorder').textContent = state.activeBorderCount;
    $('#hudTracks').textContent = state.threats.length;
    $('#hudFronts').textContent = fronts;
    $('#hudCounties').textContent = ws ? ws.stats.countyTotal : 319;

    var alertTabCount = $('#tabAirCount');
    alertTabCount.textContent = airCount;
    alertTabCount.classList.toggle('is-zero', airCount === 0);

    var threatTabCount = $('#tabThreatCount');
    var visibleThreats = state.threats.filter(function (threat) { return filters.has(threat.cls); }).length;
    threatTabCount.textContent = visibleThreats;
    threatTabCount.classList.toggle('is-zero', visibleThreats === 0);

    var borderTabCount = $('#tabBorderCount');
    borderTabCount.textContent = state.incidents.length;
    borderTabCount.classList.toggle('is-border', state.incidents.length > 0);
    borderTabCount.classList.toggle('is-zero', state.incidents.length === 0);

    var warTabCount = $('#tabWarCount');
    warTabCount.textContent = fronts;
    warTabCount.classList.toggle('is-muted', fronts === 0);
    warTabCount.classList.toggle('is-border', fronts > 0);

    var title;
    if (fronts) title = 'WAR · ' + fronts + ' front' + (fronts === 1 ? '' : 's') + ' — Balkan Union';
    else if (state.status === 'air') title = 'AIR ALERT · ' + airCount + ' zones — Balkan Union';
    else if (state.status === 'border') title = 'BORDER ALERT — Balkan Union';
    else title = 'Balkan Union — Air, Border & War Command';
    if (title !== lastTitle) {
      document.title = title;
      lastTitle = title;
    }
  }

  function renderFilterCounts() {
    var counts = { ballistic: 0, cruise: 0, jet: 0, shahed: 0 };
    state.threats.forEach(function (threat) { counts[threat.cls] = (counts[threat.cls] || 0) + 1; });
    BU.CLASS_ORDER.forEach(function (id) {
      var el = $('[data-count="' + id + '"]');
      if (el) el.textContent = counts[id] || 0;
    });
  }

  function emptyHtml(icon, title, sub) {
    var icons = {
      shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 5 6v5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
      radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 12 19 5"/></svg>',
      border: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20V8l4-4 4 4v12"/><path d="M12 20V10l4-4 4 4v10"/></svg>'
    };
    return '<div class="empty"><div class="empty-icon">' + (icons[icon] || icons.shield) + '</div>' +
      '<strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(sub) + '</span></div>';
  }

  function alertCardHtml(alert) {
    var classTags = alert.classes.map(function (cls) {
      return '<span class="tag tag-class" style="--c:' + BU.THREAT_CLASSES[cls].color + '">' + BU.THREAT_CLASSES[cls].label + '</span>';
    }).join('');
    var weaponTags = alert.weapons.slice(0, 2).map(function (weapon) {
      return '<span class="tag tag-weapon">' + escapeHtml(weapon) + '</span>';
    }).join('');
    return '<button type="button" class="alert-card' + (alert.level === 'critical' ? ' is-critical' : '') + '"' +
      ' data-zone="' + escapeHtml(alert.zone) + '" style="--c:' + alert.color + '"' +
      ' aria-label="' + escapeHtml(alert.name + ' alert, ' + alert.level + ', ' + Math.round(alert.eta) + ' seconds') + '">' +
      '<span class="alert-head"><span class="alert-zone">' + escapeHtml(alert.name) + '</span>' + shortenEta(alert) + '</span>' +
      '<span class="alert-sub">' + escapeHtml(alert.group) + '<span class="sep">·</span>' +
        alert.trackCount + ' track' + (alert.trackCount === 1 ? '' : 's') + '</span>' +
      '<span class="alert-tags">' + classTags + weaponTags + '</span>' +
      (alert.level === 'critical' ? '<span class="shelter">TAKE SHELTER</span>' : '') +
      '<span class="alert-targets">TARGETS · ' + escapeHtml(alert.targets.join(', ')) + '</span>' +
      '</button>';
  }

  function renderAlerts() {
    var list = $('#alertList');
    if (!list) return;
    var alerts = state.alerts.filter(function (alert) {
      return alert.classes.some(function (cls) { return filters.has(cls); });
    });

    var signature = alerts.map(function (alert) {
      return alert.zone + ':' + alert.level + ':' + alert.dominant + ':' + alert.trackCount;
    }).join('|');

    if (signature !== lastAlertSig) {
      lastAlertSig = signature;
      list.innerHTML = alerts.length ?
        alerts.map(alertCardHtml).join('') :
        (state.alerts.length ?
          emptyHtml('radar', 'No alerts match filters', 'Re-enable a threat class to view alerts.') :
          emptyHtml('shield', 'No active alerts. Stay safe.', 'All monitored zones are clear.'));
    }

    var byZone = {};
    alerts.forEach(function (alert) { byZone[alert.zone] = alert; });
    $$('.alert-card', list).forEach(function (card) {
      var alert = byZone[card.dataset.zone];
      if (!alert) return;
      var eta = $('[data-eta]', card);
      if (eta) eta.textContent = fmtEta(alert.eta);
    });

    var meta = $('#alertsMeta');
    if (alerts.length) {
      meta.textContent = alerts.length + ' zone' + (alerts.length === 1 ? '' : 's') + ' under alert · ' +
        state.threats.length + ' track' + (state.threats.length === 1 ? '' : 's');
    } else {
      meta.textContent = 'Monitoring ' + BU.META.memberCount + ' member states';
    }

    var updated = $('#alertsUpdated');
    if (updated) updated.textContent = fmtClock(state.alertsUpdated);
  }

  function threatCardHtml(threat) {
    var profile = BU.THREAT_CLASSES[threat.cls];
    return '<div class="threat-card" data-threat="' + threat.id + '" style="--c:' + threat.color + '">' +
      '<div class="threat-head">' +
        '<div class="threat-name">' + threatSvg(profile.glyph) + '<span>' + escapeHtml(threat.weapon) + '</span></div>' +
        '<span class="threat-status">' + escapeHtml(threat.status) + '</span>' +
      '</div>' +
      '<div class="threat-route">' + escapeHtml(threat.origin.name) + '<span class="arrow">→</span><b>' + escapeHtml(threat.target.city) + '</b>' +
        '<span class="arrow">·</span>' + escapeHtml(profile.label) + '</div>' +
      '<div class="threat-bar-row"><span class="threat-bar"><i style="width:' + Math.round(threat.progress * 100) + '%"></i></span>' +
        '<span class="threat-eta" data-eta>' + fmtEta(threat.eta) + '</span></div>' +
      '<div class="threat-meta">' +
        '<span>ALT <b data-alt>' + fmtAlt(threat.altitude) + '</b></span>' +
        '<span>HDG <b data-hdg>' + Math.round(threat.heading) + '°</b></span>' +
        '<span><b data-speed>' + threat.speed.toLocaleString('en-GB') + '</b> km/h</span>' +
        '<span data-coords>' + threat.lat.toFixed(2) + 'N ' + threat.lon.toFixed(2) + 'E</span>' +
      '</div>' +
      '</div>';
  }

  function renderThreats() {
    var list = $('#threatList');
    if (!list) return;
    var active = state.threats.filter(function (threat) { return filters.has(threat.cls); });
    var signature = active.map(function (threat) { return threat.id; }).join(',');

    if (signature !== lastThreatSig) {
      lastThreatSig = signature;
      list.innerHTML = active.length ?
        active.map(threatCardHtml).join('') :
        emptyHtml('radar', 'No active tracks', filters.size < BU.CLASS_ORDER.length ? 'All remaining tracks are filtered out.' : 'The air picture is clear.');
    }

    var byId = {};
    active.forEach(function (threat) { byId[threat.id] = threat; });
    $$('.threat-card', list).forEach(function (card) {
      var threat = byId[card.dataset.threat];
      if (!threat) return;
      var bar = $('.threat-bar > i', card);
      var eta = $('[data-eta]', card);
      var alt = $('[data-alt]', card);
      var hdg = $('[data-hdg]', card);
      var speed = $('[data-speed]', card);
      var coords = $('[data-coords]', card);
      if (bar) bar.style.width = Math.round(threat.progress * 100) + '%';
      if (eta) eta.textContent = fmtEta(threat.eta);
      if (alt) alt.textContent = fmtAlt(threat.altitude);
      if (hdg) hdg.textContent = Math.round(threat.heading) + '°';
      if (speed) speed.textContent = threat.speed.toLocaleString('en-GB');
      if (coords) coords.textContent = threat.lat.toFixed(2) + 'N ' + threat.lon.toFixed(2) + 'E';
    });

    var meta = $('#threatsMeta');
    if (active.length) {
      meta.textContent = active.length + ' tracked · ' + (state.threats.length - active.length) + ' filtered';
    } else {
      meta.textContent = 'No tracked objects';
    }

    var recentHost = $('#recentList');
    var recentSig = state.recent.map(function (item) { return item.id; }).join(',');
    if (recentSig !== lastRecentSig) {
      lastRecentSig = recentSig;
      recentHost.innerHTML = state.recent.length ? state.recent.map(function (item) {
        var color = item.outcome === 'impact' ? '#ef4444' : '#22c55e';
        var label = item.outcome === 'impact' ? 'Impact' : 'Intercepted';
        return '<div class="recent-item" style="--c:' + color + '">' +
          '<span class="r-icon"></span>' +
          '<span class="r-label">' + label + '</span>' +
          '<span class="r-target">' + escapeHtml(item.weapon) + ' → ' + escapeHtml(item.city) + '</span>' +
          '<span class="r-time" data-since="' + item.at + '">' + fmtAgo(item.at) + '</span>' +
          '</div>';
      }).join('') : '<div class="recent-empty">No resolved tracks yet.</div>';
    }

    $$('.recent-item [data-since]', recentHost).forEach(function (el) {
      el.textContent = fmtAgo(Number(el.dataset.since));
    });
  }

  function renderBorder() {
    var summary = $('#borderSummary');
    var list = $('#borderList');
    if (!summary || !list) return;

    var counts = { calm: 0, elevated: 0, critical: 0 };
    state.sectors.forEach(function (row) { counts[row.level] = (counts[row.level] || 0) + 1; });

    var signature = state.incidents.map(function (incident) { return incident.id + ':' + incident.level; }).join('|') +
      '|' + state.sectors.map(function (row) { return row.level; }).join('');

    if (signature !== lastBorderSig) {
      lastBorderSig = signature;
      summary.innerHTML =
        '<div class="summary-cell" style="--c:#f59e0b"><strong>' + counts.elevated + '</strong><span>Elevated</span></div>' +
        '<div class="summary-cell" style="--c:#ef4444"><strong>' + counts.critical + '</strong><span>Critical</span></div>' +
        '<div class="summary-cell" style="--c:#34d399"><strong>' + counts.calm + '</strong><span>Calm</span></div>';

      var pills = state.sectors.map(function (row) {
        var meta = BU.BORDER_LEVELS[row.level];
        return '<div class="sector-pill" style="--c:' + meta.color + '"><i></i><span>' + escapeHtml(row.sector.name) + '</span></div>';
      }).join('');

      var cards = state.incidents.map(function (incident) {
        var meta = BU.BORDER_LEVELS[incident.level];
        return '<div class="border-card" data-sector="' + incident.sectorId + '" style="--c:' + meta.color + '" title="' + escapeHtml(incident.detail) + '">' +
          '<div class="border-head"><span class="border-name">' + escapeHtml(incident.sector.name) + '</span>' +
            '<span class="border-level">' + meta.label + '</span></div>' +
          '<div class="border-detail">' + escapeHtml(incident.label) + '</div>' +
          '<div class="border-foot"><span>' + escapeHtml(incident.code) + ' · ' + escapeHtml(incident.sector.neighbour) + '</span>' +
            '<span data-since="' + incident.createdAt + '">' + fmtAgo(incident.createdAt) + '</span></div>' +
          '</div>';
      }).join('');

      list.innerHTML = '<div class="sector-grid">' + pills + '</div>' +
        (cards || emptyHtml('border', 'No frontier incidents', 'All external sectors are reporting calm.'));
    }

    $$('#borderList [data-since]').forEach(function (el) {
      el.textContent = fmtAgo(Number(el.dataset.since));
    });

    var meta = $('#borderMeta');
    meta.textContent = state.activeBorderCount + ' sector' + (state.activeBorderCount === 1 ? '' : 's') +
      ' active · ' + state.incidents.length + ' report' + (state.incidents.length === 1 ? '' : 's');
  }

  function renderSiren() {
    var btn = $('#sirenBtn');
    var label = $('#sirenLabel');
    btn.setAttribute('aria-pressed', siren.enabled ? 'true' : 'false');
    var text = !siren.enabled ? 'Siren off' : siren.mode === 'idle' ? 'Siren armed' : 'Siren on';
    if (label.textContent !== text) label.textContent = text;

    var mode = 'idle';
    if (state.alerts.length) {
      var urgent = state.alerts.some(function (alert) {
        return alert.dominant === 'ballistic' || alert.dominant === 'cruise';
      });
      mode = urgent ? 'wail' : 'beep';
    }
    siren.setMode(mode);
  }

  function renderConsole(now, ws) {
    setStatusDisplay(now, ws);
    renderFilterCounts();
    renderAlerts();
    renderThreats();
    renderBorder();
    renderSiren();
  }

  /* ---------------- War Room UI ---------------- */

  function buildDeterrent() {
    var host = $('#deterrentGrid');
    if (!host) return;
    var pooled = (FACTIONS.balkan && FACTIONS.balkan.pooled) || { nukes: 250, missiles: 6000, troops: 3500000, tanks: 20000, jets: 8000, aa: 900 };
    var cells = [
      ['NUKES', pooled.nukes, 'is-nuke'],
      ['BALLISTIC', pooled.missiles, ''],
      ['TROOPS', pooled.troops, ''],
      ['TANKS', pooled.tanks, ''],
      ['JETS', pooled.jets, ''],
      ['AA GRID', pooled.aa, 'is-aa']
    ];
    host.innerHTML = cells.map(function (cell) {
      return '<div class="deterrent-cell ' + cell[2] + '"><strong>' + fmtCompact(cell[1]) + '</strong><span>' + cell[0] + '</span></div>';
    }).join('') +
      '<div class="deterrent-rank"><b>#1</b> theatre power <span>CSB #2 · 86</span></div>';
  }

  function buildCountryList() {
    var host = $('#warCountries');
    if (!host) return;
    var list = WORLD.countries.slice().sort(function (a, b) {
      var allyA = a.faction === 'balkan' ? 1 : 0;
      var allyB = b.faction === 'balkan' ? 1 : 0;
      if (allyA !== allyB) return allyA - allyB;
      if (b.power !== a.power) return b.power - a.power;
      if ((b.countyCount || 0) !== (a.countyCount || 0)) return (b.countyCount || 0) - (a.countyCount || 0);
      return a.name.localeCompare(b.name);
    });
    host.innerHTML = list.map(function (meta) {
      var faction = factionOf(meta.id);
      var search = (meta.name + ' ' + (meta.leader ? meta.leader.name : '') + ' ' + faction.name + ' ' + (meta.short || '')).toLowerCase();
      return '<div class="country-row" data-country="' + escapeHtml(meta.id) + '" data-search="' + escapeHtml(search) + '" style="--c:' + faction.color + '">' +
        '<button type="button" class="country-hit" data-focus-country="' + escapeHtml(meta.id) + '">' +
          '<span class="country-code">' + escapeHtml(meta.short || meta.name.slice(0, 3).toUpperCase()) + '</span>' +
          '<span class="country-info"><b>' + escapeHtml(meta.name) + '</b>' +
            '<i>' + escapeHtml(meta.leader ? meta.leader.name : 'AI') + ' · ' + escapeHtml(faction.name) + '</i></span>' +
          '<span class="country-stat"><b class="country-count">' + (meta.countyCount || 0) + '</b><i>counties</i></span>' +
        '</button>' +
        '<button type="button" class="declare-btn" data-declare="' + escapeHtml(meta.id) + '">Declare</button>' +
        '</div>';
    }).join('');
  }

  function countyName(id) {
    var county = warSim.countyMap[id];
    return county ? county.name : id;
  }

  function warListHtml(ws) {
    if (!ws.activeWars.length) {
      return '<div class="war-empty">No active fronts. Declare war on a state below.</div>';
    }
    return ws.activeWars.map(function (war) {
      var defender = COUNTRY_META[war.defender];
      var captured = war.captured.length;
      var total = war.totalCounties || 1;
      var front = war.front ? countyName(war.front) : null;
      var phase = war.capture ? (war.capture.phase === 'move' ? 'Advancing to ' + front : 'Capturing ' + front) : 'Consolidating';
      return '<div class="war-item" data-war="' + war.id + '" style="--c:' + (FACTIONS[war.defenderSide] ? FACTIONS[war.defenderSide].color : '#ef4444') + '">' +
        '<div class="war-item-head"><b>' + escapeHtml(war.attackerLabel) + ' → ' + escapeHtml(defender ? defender.name : war.defender) + '</b>' +
          '<span class="war-status">ACTIVE</span></div>' +
        '<div class="war-item-sub" data-war-phase="' + war.id + '">' + escapeHtml(phase) + ' · ' + captured + '/' + war.totalCounties + ' counties taken</div>' +
        '<div class="war-item-bar"><i data-war-bar="' + war.id + '" style="width:' + Math.round(captured / total * 100) + '%"></i></div>' +
        '<div class="war-item-actions">' +
          '<button type="button" class="mini-btn" data-war-focus="' + escapeHtml(war.defender) + '">Focus</button>' +
          '<button type="button" class="mini-btn is-danger" data-war-ceasefire="' + war.id + '">Ceasefire</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function offerCardHtml(offer) {
    var faction = FACTIONS[offer.faction] || FACTIONS.neutral;
    var meta = COUNTRY_META[offer.fromId] || { name: offer.fromId };
    var isTimer = offer.status === 'timer';
    var kind = offer.kind === 'ceasefire' ? 'CEASEFIRE' : 'LAND DEMAND';
    var counties = offer.counties.length ?
      '<div class="offer-counties">' + offer.counties.map(function (id) {
        return '<span>' + escapeHtml(countyName(id)) + '</span>';
      }).join('') + '</div>' : '';
    return '<div class="offer-card" data-offer="' + offer.id + '" style="--c:' + faction.color + '">' +
      '<div class="offer-head"><b>' + escapeHtml(offer.leader) + ' · ' + escapeHtml(meta.name) + '</b>' +
        '<span class="offer-kind">' + kind + '</span></div>' +
      '<p class="offer-text">' + escapeHtml(offer.text) + '</p>' + counties +
      '<div class="offer-actions">' +
        '<label class="offer-timer-label" title="Real-world hours — time to prepare the meeting before the treaty signs itself">Auto-sign in' +
          '<input class="offer-timer-input" type="number" min="0.01" max="168" step="1" value="' + (offer.timerHours || 6) + '" aria-label="Treaty auto-sign timer in real-world hours">h' +
        '</label>' +
        '<button type="button" class="mini-btn" data-offer-timer="' + offer.id + '">Arm timer</button>' +
        '<button type="button" class="mini-btn is-accept" data-offer-accept="' + offer.id + '">Accept</button>' +
        '<button type="button" class="mini-btn is-danger" data-offer-decline="' + offer.id + '">Refuse</button>' +
      '</div>' +
      '<div class="offer-clock" data-offer-clock="' + offer.id + '">' +
        (isTimer ? 'Auto-sign armed · real-world clock' : 'No timer set · treaty waits for your answer') +
      '</div>' +
      '</div>';
  }

  function renderOffers(ws) {
    var host = $('#offerList');
    if (!host) return;
    var pending = ws.offers.filter(function (offer) {
      return offer.status === 'open' || offer.status === 'timer';
    });
    var sig = 'offers:' + pending.map(function (offer) {
      return offer.id + ':' + offer.status + ':' + (offer.timerHours || 0);
    }).join('|');
    if (sig === ui.offerSig) return;
    ui.offerSig = sig;
    host.innerHTML = pending.length ? pending.map(offerCardHtml).join('') :
      '<div class="war-empty">No pending AI requests. Leaders will ask for land or a ceasefire as the clock advances.</div>';
    var count = $('#offerCount');
    if (count) count.textContent = pending.length ? pending.length + ' pending' : 'No offers';
  }

  function renderOfferClocks(ws) {
    ws.offers.forEach(function (offer) {
      if (offer.status !== 'timer') return;
      var el = $('[data-offer-clock="' + offer.id + '"]');
      if (!el) return;
      var remaining = Math.max(0, offer.acceptAt - Date.now());
      var total = Math.ceil(remaining / 1000);
      var hours = Math.floor(total / 3600);
      var minutes = Math.floor((total % 3600) / 60);
      var seconds = total % 60;
      var label = hours > 0 ? hours + 'h ' + minutes + 'm' : (minutes > 0 ? minutes + 'm ' + seconds + 's' : seconds + 's');
      el.textContent = 'Auto-sign in ' + label + ' · real-world timer';
      el.classList.toggle('is-urgent', remaining > 0 && remaining < 5 * 60 * 1000);
    });
  }

  function renderFeed(ws) {
    var host = $('#aiFeed');
    if (!host) return;
    var sig = ws.messages.map(function (message) { return message.id; }).join(',');
    if (sig === ui.feedSig) return;
    ui.feedSig = sig;
    host.innerHTML = ws.messages.slice(0, 12).map(function (message) {
      return '<div class="ai-msg" style="--c:' + message.color + '">' +
        '<div class="ai-msg-head"><b>' + escapeHtml(message.leader) + '</b>' +
          '<span>' + escapeHtml(message.kind) + '</span></div>' +
        '<p>' + escapeHtml(message.text) + '</p>' +
        '</div>';
    }).join('');
  }

  function renderCountryStates(ws) {
    var sig = ws.revision + ':' + ws.wars.map(function (war) { return war.id + war.status; }).join(',');
    if (sig === ui.countrySig) return;
    ui.countrySig = sig;

    var owned = {};
    ws.counties.forEach(function (county) {
      owned[county.owner] = (owned[county.owner] || 0) + 1;
    });

    $$('.country-row').forEach(function (row) {
      var id = row.dataset.country;
      var meta = COUNTRY_META[id];
      var country = ws.countries[id];
      if (!meta || !country) return;
      var countEl = $('.country-count', row);
      if (countEl) countEl.textContent = owned[id] || 0;
      var check = warSim.canDeclareWar(id);
      var button = $('[data-declare]', row);
      if (button) {
        button.disabled = !check.ok;
        button.title = check.ok ? 'Declare war on ' + meta.name : check.error;
        button.textContent = country.cooked ? 'Cooked' : (check.ok ? 'Declare' : 'Locked');
      }
      row.classList.toggle('is-cooked', !!country.cooked);
      row.classList.toggle('is-at-war', country.status === 'at war' || country.status === 'invaded');
    });
  }

  function renderActiveWars(ws) {
    var sig = 'wars:' + ws.activeWars.map(function (war) {
      return war.id + ':' + war.status + ':' + war.captured.length + ':' + (war.front || '');
    }).join('|');
    if (sig !== ui.warSig) {
      ui.warSig = sig;
      $('#activeWars').innerHTML = warListHtml(ws);
    }
    ws.activeWars.forEach(function (war) {
      var front = war.front ? countyName(war.front) : null;
      var phase = war.capture ? (war.capture.phase === 'move' ? 'Advancing to ' + front : 'Capturing ' + front) : 'Consolidating';
      var sub = $('[data-war-phase="' + war.id + '"]');
      if (sub) sub.textContent = phase + ' · ' + war.captured.length + '/' + war.totalCounties + ' counties taken';
      var bar = $('[data-war-bar="' + war.id + '"]');
      if (bar) bar.style.width = Math.round(war.captured.length / Math.max(1, war.totalCounties) * 100) + '%';
    });
    var meta = $('#warMeta');
    if (meta) {
      meta.textContent = ws.activeWars.length ?
        ws.activeWars.length + ' front' + (ws.activeWars.length === 1 ? '' : 's') + ' · ' + ws.stats.occupied + ' counties occupied' :
        'No wars';
    }
  }

  function renderStrip(ws) {
    var strip = $('#warStrip');
    if (!strip) return;
    if (!ws.activeWars.length) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    var text = ws.activeWars.map(function (war) {
      return COUNTRY_META[war.defender] ? COUNTRY_META[war.defender].name : war.defender;
    }).join(' · ') + ' front' + (ws.activeWars.length === 1 ? '' : 's') + ' active';
    $('#warStripText').textContent = text;
  }

  function renderWarPanel(ws) {
    renderStrip(ws);
    renderActiveWars(ws);
    renderOffers(ws);
    renderOfferClocks(ws);
    renderFeed(ws);
    renderCountryStates(ws);
  }

  /* ---------------- App events ---------------- */

  function markSeen() {
    seenZones = new Set(state.alerts.map(function (alert) { return alert.zone; }));
    seenIncidents = new Set(state.incidents.map(function (incident) { return incident.id; }));
    seenRecent = new Set(state.recent.map(function (item) { return item.id; }));
    lastStatus = state.status;
  }

  function handleEvents() {
    var zones = new Set(state.alerts.map(function (alert) { return alert.zone; }));
    var statusChanged = state.status !== lastStatus;
    var newZones = state.alerts.filter(function (alert) { return !seenZones.has(alert.zone); });
    var newIncidents = state.incidents.filter(function (incident) { return !seenIncidents.has(incident.id); });
    var newOutcomes = state.recent.filter(function (item) { return !seenRecent.has(item.id); });

    if (statusChanged) {
      if (state.status === 'air') {
        toast({
          mark: 'AIR',
          color: '#ef4444',
          title: 'AIR ALERT — ' + state.alerts.length + ' zone' + (state.alerts.length === 1 ? '' : 's'),
          sub: state.threats.length + ' track' + (state.threats.length === 1 ? '' : 's') + ' inbound across the Union'
        });
      } else if (state.status === 'border') {
        var critical = state.incidents.filter(function (incident) { return incident.level === 'critical'; });
        toast({
          mark: 'BORDER',
          color: '#f59e0b',
          title: 'BORDER ALERT',
          sub: critical.length + ' critical frontier report' + (critical.length === 1 ? '' : 's') + ' active'
        });
      } else {
        toast({
          mark: 'CLEAR',
          color: '#22c55e',
          title: 'ALL CLEAR',
          sub: 'No active air alerts across the Union.'
        });
      }
      lastStatus = state.status;
    } else if (newZones.length) {
      var first = newZones[0];
      toast({
        mark: 'AIR',
        color: first.color,
        title: 'ALERT · ' + first.name,
        sub: first.weapons.slice(0, 2).join(' · ') + ' · ETA ' + fmtEta(first.eta) +
          (newZones.length > 1 ? ' · +' + (newZones.length - 1) + ' more zone' + (newZones.length > 2 ? 's' : '') : '')
      });
    }

    if (!statusChanged && newIncidents.length) {
      var incident = newIncidents[0];
      toast({
        mark: 'BORDER',
        color: incident.level === 'critical' ? '#ef4444' : '#f59e0b',
        title: incident.sector.name,
        sub: incident.label + (newIncidents.length > 1 ? ' · +' + (newIncidents.length - 1) + ' report' : '')
      });
    }

    newOutcomes.forEach(function (item) {
      var impacted = item.outcome === 'impact';
      toast({
        mark: impacted ? 'IMPACT' : 'INTERCEPT',
        color: impacted ? '#ef4444' : '#22c55e',
        title: (impacted ? 'IMPACT · ' : 'INTERCEPTED · ') + item.weapon,
        sub: item.city + ' · ' + (impacted ? 'damage assessment pending' : 'target neutralised by air defence')
      });
      mapView.boom(item.point, item.outcome);
    });

    seenZones = zones;
    state.incidents.forEach(function (incident) { seenIncidents.add(incident.id); });
    state.recent.forEach(function (item) { seenRecent.add(item.id); });
  }

  function handleWarEvents() {
    var events = warSim.drainEvents();
    var now = Date.now();
    events.forEach(function (event) {
      toast({
        mark: event.mark,
        color: event.color,
        title: event.title,
        sub: event.sub
      });
      var major = event.mark === 'WAR' || event.mark === 'CAPITAL';
      if (event.focus && major && now - pendingFocus > 1600) {
        pendingFocus = now;
        mapView.focusCountry(event.focus);
      }
    });
  }

  function declareCountry(id) {
    var result = warSim.declareWar(id);
    if (!result.ok) {
      toast({ mark: 'DENIED', color: '#f59e0b', title: 'Cannot declare war', sub: result.error });
      return;
    }
    ui.warSig = '';
    ui.countrySig = '';
    handleWarEvents();
    renderWarPanel(warSim.getState(), Date.now());
    activateTab('war');
    window.setTimeout(function () { mapView.focusCountry(id); }, 150);
  }

  function resetWorld(silent) {
    warSim.resetWorld(Date.now());
    ui.warSig = '';
    ui.offerSig = '';
    ui.feedSig = '';
    ui.countrySig = '';
    mapView.warRevision = -1;
    mapView.renderWar(warSim.getState());
    renderWarPanel(warSim.getState(), Date.now());
    if (!silent) {
      toast({ mark: 'RESET', color: '#3b82f6', title: 'World reset', sub: 'Borders, counties and AI councils restored to nominal.' });
    }
  }

  function wireWarControls() {
    $('#worldResetBtn').addEventListener('click', function () { resetWorld(false); });

    $('#warStrip').addEventListener('click', function () { activateTab('war'); });

    $('#speedRow').addEventListener('click', function (event) {
      var button = event.target.closest('.speed-btn');
      if (!button) return;
      var speed = Number(button.dataset.speed);
      if (!speed) return;
      warSim.setSpeed(speed);
      $$('.speed-btn').forEach(function (item) { item.classList.toggle('is-active', item === button); });
      var label = $('#speedLabel');
      if (label) label.textContent = '×' + speed + ' · ' + (speed >= 3600 ? (speed / 3600) + ' h/s' : (speed / 60) + ' min/s');
      handleWarEvents();
    });

    $('#offerList').addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.offerTimer) {
        var timerInput = button.closest('.offer-card').querySelector('.offer-timer-input');
        var hours = timerInput ? Number(timerInput.value) : 6;
        var timed = warSim.setOfferTimer(button.dataset.offerTimer, hours);
        if (timed.ok) {
          ui.offerSig = '';
          handleWarEvents();
          renderWarPanel(warSim.getState(), Date.now());
        }
      } else if (button.dataset.offerAccept) {
        warSim.acceptOffer(button.dataset.offerAccept, false);
        ui.offerSig = '';
        ui.countrySig = '';
        handleWarEvents();
        mapView.renderWar(warSim.getState());
        renderWarPanel(warSim.getState(), Date.now());
      } else if (button.dataset.offerDecline) {
        warSim.declineOffer(button.dataset.offerDecline);
        ui.offerSig = '';
        handleWarEvents();
        renderWarPanel(warSim.getState(), Date.now());
      }
    });

    $('#activeWars').addEventListener('click', function (event) {
      var focus = event.target.closest('[data-war-focus]');
      if (focus) {
        mapView.focusCountry(focus.dataset.warFocus);
        return;
      }
      var ceasefire = event.target.closest('[data-war-ceasefire]');
      if (ceasefire) {
        var result = warSim.ceasefire(ceasefire.dataset.warCeasefire);
        if (result.ok) {
          ui.warSig = '';
          ui.countrySig = '';
          handleWarEvents();
          renderWarPanel(warSim.getState(), Date.now());
        }
      }
    });

    $('#warCountries').addEventListener('click', function (event) {
      var declare = event.target.closest('[data-declare]');
      if (declare) {
        event.preventDefault();
        if (declare.disabled) return;
        declareCountry(declare.dataset.declare);
        return;
      }
      var focus = event.target.closest('[data-focus-country]');
      if (!focus) return;
      var id = focus.dataset.focusCountry;
      mapView.focusCountry(id);
      window.setTimeout(function () { mapView.openCountryPopup(id); }, 520);
    });

    document.addEventListener('click', function (event) {
      var declare = event.target.closest('.pop-declare');
      if (!declare) return;
      event.preventDefault();
      mapView.map.closePopup();
      declareCountry(declare.dataset.declare);
    });

    $('#countrySearch').addEventListener('input', function () {
      var query = this.value.trim().toLowerCase();
      $$('.country-row').forEach(function (row) {
        row.hidden = !!query && row.dataset.search.indexOf(query) < 0;
      });
    });
  }

  function wireControls() {
    $('#sirenBtn').addEventListener('click', function () {
      var enabled = siren.toggle();
      renderSiren();
      toast({
        mark: 'AUDIO',
        color: enabled ? '#f2c14e' : '#64748b',
        title: enabled ? 'Siren armed' : 'Siren muted',
        sub: enabled ? 'Live alerts will sound in this browser.' : 'Audio warnings disabled.'
      });
    });

    $('#alertList').addEventListener('click', function (event) {
      var card = event.target.closest('.alert-card');
      if (!card) return;
      mapView.focusZone(card.dataset.zone);
    });

    $('#borderList').addEventListener('click', function (event) {
      var card = event.target.closest('.border-card');
      if (!card) return;
      mapView.focusSector(card.dataset.sector);
    });

    $('#drillAirBtn').addEventListener('click', function () {
      sim.drillAir();
      tick();
      toast({ mark: 'DRILL', color: '#ef4444', title: 'Air target injected', sub: 'New fictional track added to the network.' });
    });

    $('#drillBorderBtn').addEventListener('click', function () {
      sim.drillBorder();
      tick();
      toast({ mark: 'DRILL', color: '#f59e0b', title: 'Frontier incident injected', sub: 'Sector report added to the border feed.' });
    });

    $('#drillResetBtn').addEventListener('click', function () {
      sim.drillReset();
      state = sim.getState(Date.now());
      lastAlertSig = null;
      lastThreatSig = null;
      lastRecentSig = null;
      lastBorderSig = null;
      mapView.alertSig = '';
      mapView.borderSig = '';
      initialized = true;
      markSeen();
      renderConsole(Date.now(), warSim.getState());
      mapView.render(state, filters);
      mapView.resetView();
      toast({ mark: 'RESET', color: '#3b82f6', title: 'Air feed reset', sub: 'Common Alert Network reseeded with fictional tracks.' });
    });

    wireWarControls();
  }

  function updateClock() {
    var now = Date.now();
    var timeEl = $('#clockTime');
    var dateEl = $('#clockDate');
    if (timeEl) timeEl.textContent = fmtClock(now);
    if (dateEl) dateEl.textContent = dateFormatter.format(new Date(now));
  }

  function tick() {
    var now = Date.now();
    state = sim.update(now);
    warSim.update(now);
    var ws = warSim.getState();

    mapView.render(state, filters);
    mapView.renderWar(ws);
    renderConsole(now, ws);
    renderWarPanel(ws, now);
    handleWarEvents();

    if (!initialized) {
      markSeen();
      initialized = true;
    } else {
      handleEvents();
    }
  }

  function boot() {
    buildFilters();
    initTabs();
    buildDeterrent();
    buildCountryList();
    wireControls();
    mapView.init();
    mapView.renderWar(warSim.getState());
    renderWarPanel(warSim.getState(), Date.now());
    updateClock();
    window.setInterval(updateClock, 1000);
    tick();
    window.setInterval(tick, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
