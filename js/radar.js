(function () {
  'use strict';

  var CX = 500;
  var CY = 500;
  var RADIUS = 438;

  var SCOPES = {
    air: {
      key: 'air',
      range: 250,
      lat: 44.787,
      lon: 20.448,
      rings: [50, 100, 150, 200, 250],
      sweep: 6,
      center: 'BELGRADE'
    },
    naval: {
      key: 'naval',
      range: 300,
      lat: 42.45,
      lon: 18.55,
      rings: [60, 120, 180, 240, 300],
      sweep: 8,
      center: 'ADRIATIC'
    }
  };

  var state = {
    updatedAt: 0,
    condition: 'GREEN',
    silenced: false,
    air: { contacts: [] },
    naval: { contacts: [] },
    orders: [],
    messages: []
  };

  var THEATRE_BOUNDS = [[34.0, -11.0], [60.0, 44.0]];
  var AFF_COLOR = { hostile: '#ff4d5e', unknown: '#ffd166', friendly: '#54e08a', civil: '#63d9ff' };

  var theatre = {
    ready: false,
    map: null,
    blips: null,
    labels: null,
    trails: { air: new Map(), naval: new Map() }
  };

  var selected = { air: null, naval: null };
  var trails = { air: new Map(), naval: new Map() };
  var knownHostiles = new Set();
  var lastCondition = 'GREEN';
  var lastOrderId = 0;
  var drillTimers = { air: 0, naval: 0 };
  var audioOn = false;
  var audioCtx = null;
  var mode = 'boot';
  var source = null;
  var pollTimer = null;
  var localTimer = null;
  var localState = null;
  var localCounter = 0;

  function el(id) { return document.getElementById(id); }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function bearingPoint(bearing, radius) {
    var rad = bearing * Math.PI / 180;
    return { x: CX + Math.sin(rad) * radius, y: CY - Math.cos(rad) * radius };
  }

  function project(scope, lat, lon) {
    var kmPerLat = 111.32;
    var kmPerLon = 111.32 * Math.cos(scope.lat * Math.PI / 180);
    var xKm = (lon - scope.lon) * kmPerLon;
    var yKm = (lat - scope.lat) * kmPerLat;
    return {
      x: CX + (xKm / scope.range) * RADIUS,
      y: CY - (yKm / scope.range) * RADIUS
    };
  }

  function contactPoint(scope, range, bearing) {
    var rad = bearing * Math.PI / 180;
    var distance = (range / scope.range) * RADIUS;
    return {
      x: CX + Math.sin(rad) * distance,
      y: CY - Math.cos(rad) * distance
    };
  }

  /* ---------- Static scope drawing ---------- */

  function buildGrid(key) {
    var scope = SCOPES[key];
    var host = document.querySelector('[data-grid="' + key + '"]');
    if (!host) return;
    var parts = [];
    var last = scope.rings.length - 1;

    scope.rings.forEach(function (km, index) {
      var radius = (km / scope.range) * RADIUS;
      parts.push('<circle class="ring' + (index === last ? ' is-outer' : '') +
        '" cx="500" cy="500" r="' + radius.toFixed(1) + '"></circle>');
      parts.push('<text x="514" y="' + (CY - radius + 15).toFixed(1) + '">' + km + ' KM</text>');
    });

    for (var deg = 0; deg < 360; deg += 30) {
      var point = bearingPoint(deg, RADIUS);
      parts.push('<line class="radial' + (deg % 90 === 0 ? ' is-cardinal' : '') +
        '" x1="500" y1="500" x2="' + point.x.toFixed(1) + '" y2="' + point.y.toFixed(1) + '"></line>');
    }

    for (var tick = 0; tick < 360; tick += 10) {
      var major = tick % 30 === 0;
      var outer = bearingPoint(tick, RADIUS);
      var inner = bearingPoint(tick, major ? RADIUS - 18 : RADIUS - 9);
      parts.push('<line class="tick' + (major ? ' is-major' : '') +
        '" x1="' + inner.x.toFixed(1) + '" y1="' + inner.y.toFixed(1) +
        '" x2="' + outer.x.toFixed(1) + '" y2="' + outer.y.toFixed(1) + '"></line>');
    }

    host.innerHTML = parts.join('');
  }

  function ringPath(scope, ring) {
    if (!ring || ring.length < 3) return '';
    var minLat = 90;
    var maxLat = -90;
    var minLon = 180;
    var maxLon = -180;
    var i;
    for (i = 0; i < ring.length; i++) {
      var lat = ring[i][1];
      var lon = ring[i][0];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    if (maxLat < scope.lat - 6 || minLat > scope.lat + 6) return '';
    if (maxLon < scope.lon - 9 || minLon > scope.lon + 9) return '';

    var d = '';
    for (i = 0; i < ring.length; i++) {
      var point = project(scope, ring[i][1], ring[i][0]);
      d += (i ? ' L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
    }
    return d + ' Z';
  }

  function linePath(scope, line) {
    if (!line || line.length < 2) return '';
    var d = '';
    for (var i = 0; i < line.length; i++) {
      var point = project(scope, line[i][1], line[i][0]);
      d += (i ? ' L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
    }
    return d;
  }

  function buildLand(key) {
    var scope = SCOPES[key];
    var host = document.querySelector('[data-geo="' + key + '"]');
    if (!host) return;
    var parts = [];

    if (window.BU_EUROPE && Array.isArray(window.BU_EUROPE.features)) {
      window.BU_EUROPE.features.forEach(function (feature) {
        var geometry = feature.geometry;
        if (!geometry) return;
        var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] :
          geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
        var d = '';
        polygons.forEach(function (polygon) {
          polygon.forEach(function (ring) {
            d += ringPath(scope, ring);
          });
        });
        if (!d) return;
        var faction = (feature.properties && feature.properties.faction) || 'neutral';
        parts.push('<path class="faction-' + esc(faction) + '" fill-rule="evenodd" d="' + d + '"></path>');
      });
    }

    if (window.BU_UNION_OUTLINE && Array.isArray(window.BU_UNION_OUTLINE.features)) {
      window.BU_UNION_OUTLINE.features.forEach(function (feature) {
        var geometry = feature.geometry;
        if (!geometry) return;
        var lines = geometry.type === 'LineString' ? [geometry.coordinates] :
          geometry.type === 'MultiLineString' ? geometry.coordinates : [];
        var d = '';
        lines.forEach(function (line) { d += linePath(scope, line); });
        if (d) parts.push('<path class="union-frontier" d="' + d + '"></path>');
      });
    }

    host.innerHTML = parts.join('');
  }

  function buildSweep(key) {
    var host = document.querySelector('[data-sweep="' + key + '"]');
    if (!host) return;
    var angles = [0, 13, 28, 45, 62];
    var alphas = [0.17, 0.11, 0.07, 0.035];
    var parts = [];
    for (var i = 0; i < 4; i++) {
      var start = bearingPoint(angles[i], RADIUS);
      var end = bearingPoint(angles[i + 1], RADIUS);
      parts.push('<path class="sweep-wedge" style="opacity:' + alphas[i] +
        '" d="M500 500 L' + start.x.toFixed(1) + ' ' + start.y.toFixed(1) +
        ' A438 438 0 0 1 ' + end.x.toFixed(1) + ' ' + end.y.toFixed(1) + ' Z"></path>');
    }
    var edge = bearingPoint(0, RADIUS);
    parts.push('<line class="sweep-edge" x1="500" y1="500" x2="' + edge.x.toFixed(1) +
      '" y2="' + edge.y.toFixed(1) + '"></line>');
    host.innerHTML = parts.join('');
  }

  /* ---------- Live rendering ---------- */

  function contactList(key) {
    var side = state[key];
    return side && Array.isArray(side.contacts) ? side.contacts : [];
  }

  function affClass(aff) {
    return ['hostile', 'unknown', 'friendly', 'civil'].indexOf(aff) >= 0 ? aff : 'unknown';
  }

  function affLabel(aff) {
    return aff === 'hostile' ? 'HOSTILE' : aff === 'friendly' ? 'FRIENDLY' :
      aff === 'civil' ? 'CIVIL' : 'UNKNOWN';
  }

  function contactDetail(key, contact) {
    var bearing = Math.round(num(contact.bearing, 0) + 360) % 360;
    var range = Math.max(0, Math.round(num(contact.range, 0)));
    var base = (contact.callsign || 'UNKNOWN') + ' · ' + (contact.cls || 'CONTACT') +
      ' · BRG ' + bearing + '° / ' + range + ' KM';
    if (key === 'air') {
      var alt = Math.max(0, num(contact.alt, 0));
      base += ' · ALT ' + (alt > 0 ? Math.round(alt * 1000).toLocaleString('en-GB') + ' FT' : 'SURFACE');
      base += ' · ' + Math.round(num(contact.speed, 0)) + ' KM/H';
    } else {
      var sub = String(contact.kind) === 'sub';
      base += ' · ' + (sub ? 'DEPTH ' + Math.round(num(contact.depth, 0)) + ' M' : 'SURFACE');
      base += ' · ' + Math.round(num(contact.speed, 0)) + ' KN';
    }
    return base + ' · ' + affLabel(affClass(contact.aff));
  }

  /* ---------- Theatre map ---------- */

  function destinationPoint(lat, lon, bearing, km) {
    var rad = Math.PI / 180;
    var d = Math.max(0, km) / 6371;
    var br = bearing * rad;
    var lat1 = lat * rad;
    var lon1 = lon * rad;
    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    var lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 / rad, ((lon2 / rad + 540) % 360) - 180];
  }

  function theatreCoverage(lat, lon, km, label, naval) {
    L.circle([lat, lon], {
      radius: km * 1000,
      pane: 'rangePane',
      interactive: false,
      color: naval ? '#63d9ff' : '#6bffc4',
      weight: 1.3,
      opacity: 0.7,
      dashArray: '7 7',
      fill: true,
      fillOpacity: 0.05
    }).addTo(theatre.map);

    L.marker([lat + (km / 111.32) * 0.9, lon], {
      pane: 'rangePane',
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'map-range-label' + (naval ? ' is-naval' : ''),
        html: '<span>' + label + '</span>',
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      })
    }).addTo(theatre.map);
  }

  function theatreFactionLabels() {
    var factions = (window.BU_WORLD && window.BU_WORLD.factions) || {};
    [
      ['BALKAN UNION', 42.4, 25.4, 'balkan'],
      ['DUTCH UNION', 52.3, 5.6, 'dutch'],
      ["KINGDOM OF CARL'S SPELLING BEE", 46.7, 1.8, 'csb'],
      ['UNITED KINGDOM', 54.3, -2.8, 'uk'],
      ['UKRAINE', 49.2, 32.2, 'ukraine'],
      ['TÜRKİYE', 39.1, 34.6, 'turkey']
    ].forEach(function (entry) {
      var faction = factions[entry[3]] || {};
      L.marker([entry[1], entry[2]], {
        pane: 'rangePane',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'map-faction-label',
          html: '<span style="color:' + (faction.color || '#6f8f88') + '">' + entry[0] + '</span>',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        })
      }).addTo(theatre.map);
    });
  }

  function theatreCsbBorders() {
    var geo = window.BU_CSB_GEO;
    if (!geo) return;
    var map = theatre.map;

    map.createPane('csbPane');
    map.getPane('csbPane').style.zIndex = 410;
    map.getPane('csbPane').style.pointerEvents = 'none';

    L.geoJSON(geo.neutral, {
      pane: 'csbPane',
      interactive: false,
      style: { fillColor: '#171c25', fillOpacity: 0.9, color: '#232b38', weight: 0.7, opacity: 1 }
    }).addTo(map);

    L.geoJSON(geo.zones, {
      pane: 'csbPane',
      interactive: false,
      style: function (feature) {
        var csb = feature.properties.side === 'csb';
        return {
          fillColor: csb ? '#17223b' : '#3a1426',
          fillOpacity: 0.88,
          color: csb ? '#34497a' : '#5a2340',
          weight: 0.6,
          opacity: 0.9
        };
      }
    }).addTo(map);

    L.geoJSON(geo.groups, {
      pane: 'csbPane',
      interactive: false,
      style: function (feature) {
        var csb = feature.properties.side === 'csb';
        return { fill: false, color: csb ? '#3d5a9e' : '#6b2a47', weight: 1.2, opacity: 0.9 };
      }
    }).addTo(map);

    L.geoJSON(geo.sides, {
      pane: 'csbPane',
      interactive: false,
      style: function (feature) {
        var csb = feature.properties.side === 'csb';
        return { fill: false, color: csb ? '#4f8cff' : '#d81b6a', weight: 2.3, opacity: 0.92 };
      }
    }).addTo(map);
  }

  function theatreInit() {
    if (theatre.ready) return true;
    var host = el('theatreMap');
    if (!host) return false;
    if (!window.L || !window.BU_EUROPE) {
      var hint = el('theatreHint');
      if (hint) hint.hidden = false;
      return false;
    }

    var map = L.map(host, {
      zoomControl: false,
      minZoom: 3,
      maxZoom: 9,
      zoomSnap: 0.25,
      attributionControl: true
    });
    theatre.map = map;
    window.BU_THEATRE_MAP = map;

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Borders: Natural Earth · Fiction: Balkan Union');
    map.fitBounds(THEATRE_BOUNDS, { padding: [18, 18], maxZoom: 5.25 });

    map.createPane('rangePane');
    map.getPane('rangePane').style.zIndex = 415;
    map.getPane('rangePane').style.pointerEvents = 'none';
    map.createPane('linePane');
    map.getPane('linePane').style.zIndex = 420;
    map.getPane('linePane').style.pointerEvents = 'none';
    map.createPane('blipPane');
    map.getPane('blipPane').style.zIndex = 620;

    var factions = (window.BU_WORLD && window.BU_WORLD.factions) || {};

    L.geoJSON(window.BU_EUROPE, {
      interactive: false,
      style: function (feature) {
        var faction = factions[feature.properties.faction] ||
          factions.neutral || { fill: '#14211e', line: '#33524b' };
        return {
          color: faction.line || '#33524b',
          weight: 0.9,
          opacity: 0.9,
          fillColor: faction.fill || '#14211e',
          fillOpacity: feature.properties.union ? 0.42 : 0.28
        };
      }
    }).addTo(map);

    if (window.BU_UNION_OUTLINE) {
      L.geoJSON(window.BU_UNION_OUTLINE, {
        pane: 'linePane',
        interactive: false,
        style: { color: '#ff4040', weight: 1.6, opacity: 0.85, fill: false }
      }).addTo(map);
    }

    theatreCsbBorders();

    theatreCoverage(44.787, 20.448, 250, 'AIR WATCH · BELGRADE · 250 KM', false);
    theatreCoverage(42.45, 18.55, 300, 'NAVAL WATCH · ADRIATIC · 300 KM', true);
    theatreFactionLabels();

    theatre.trailLayer = L.layerGroup().addTo(map);
    theatre.blips = L.layerGroup().addTo(map);
    theatre.labels = L.layerGroup().addTo(map);
    theatre.ready = true;

    map.on('zoomend', function () { theatreRender(); });
    return true;
  }

  function theatreRender() {
    if (!theatre.ready) return;

    theatre.blips.clearLayers();
    theatre.labels.clearLayers();
    theatre.trailLayer.clearLayers();

    var hostiles = 0;
    var airCount = 0;
    var navalCount = 0;

    ['air', 'naval'].forEach(function (key) {
      var scope = SCOPES[key];
      var contacts = contactList(key);
      var history = theatre.trails[key];
      var seen = new Set();
      if (key === 'air') airCount = contacts.length;
      else navalCount = contacts.length;

      contacts.forEach(function (contact, index) {
        var id = String(contact.id == null ? contact.callsign : contact.id);
        var aff = affClass(contact.aff);
        seen.add(id);
        if (aff === 'hostile') hostiles++;

        var range = clamp(num(contact.range, 0), 0, scope.range * 1.5);
        var bearing = ((num(contact.bearing, 0) % 360) + 360) % 360;
        var heading = ((num(contact.heading, bearing) % 360) + 360) % 360;
        var point = destinationPoint(scope.lat, scope.lon, bearing, range);
        var isSelected = selected[key] === id;

        var points = history.get(id) || [];
        var last = points[points.length - 1];
        if (!last || Math.abs(last[0] - point[0]) > 0.0015 ||
          Math.abs(last[1] - point[1]) > 0.0015) {
          points.push(point);
          if (points.length > 14) points.shift();
        }
        history.set(id, points);

        if (points.length > 1) {
          L.polyline(points, {
            pane: 'linePane',
            interactive: false,
            color: AFF_COLOR[aff] || AFF_COLOR.unknown,
            weight: 1,
            opacity: 0.45,
            dashArray: '2 4'
          }).addTo(theatre.trailLayer);
        }

        var icon = L.divIcon({
          className: 'map-blip is-' + aff + (isSelected ? ' is-selected' : ''),
          html: '<span class="mp-arrow" style="transform:rotate(' + heading.toFixed(0) + 'deg)">' +
            '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.2 11.4 12 7 9.6 2.6 12Z"/></svg></span>' +
            '<span class="mp-pip"></span><span class="mp-ring"></span>',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        });

        var marker = L.marker(point, {
          icon: icon,
          pane: 'blipPane',
          keyboard: false,
          title: (contact.callsign || 'UNKNOWN') + ' · ' + affLabel(aff)
        }).addTo(theatre.blips);

        marker.on('click', function (event) {
          if (event && event.originalEvent) L.DomEvent.stopPropagation(event);
          selected[key] = selected[key] === id ? null : id;
          theatreRender();
          theatreReadout();
          renderScope(key);
        });

        var zoom = theatre.map.getZoom();
        var showLabel = isSelected || (aff === 'hostile' && zoom >= 4.5) ||
          (aff === 'unknown' && zoom >= 5.6);
        if (showLabel) {
          L.marker(point, {
            pane: 'blipPane',
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
              className: 'map-label is-' + aff + (index % 2 ? ' is-low' : ''),
              html: '<span>' + esc(contact.callsign || 'UNKNOWN') + '</span>' +
                '<small>' + esc((key === 'air' ? 'AIR' : 'SEA') + ' · ' +
                  Math.round(range) + ' KM · ' + affLabel(aff)) + '</small>',
              iconSize: [0, 0],
              iconAnchor: [0, 0]
            })
          }).addTo(theatre.labels);
        }
      });

      history.forEach(function (_, trailId) {
        if (!seen.has(trailId)) history.delete(trailId);
      });
    });

    var airNode = el('mapAir');
    var navalNode = el('mapNaval');
    var hostileNode = el('mapHostile');
    if (airNode) airNode.textContent = airCount;
    if (navalNode) navalNode.textContent = navalCount;
    if (hostileNode) hostileNode.textContent = hostiles;
  }

  function theatreReadout() {
    var node = el('mapSelected');
    if (!node) return;
    var parts = [];
    ['air', 'naval'].forEach(function (key) {
      var contact = selectedContact(key);
      if (contact) parts.push(contactDetail(key, contact));
    });
    node.textContent = parts.length ? parts.join('   ·   ') : 'NO TRACK SELECTED · CLICK A CONTACT';
  }

  function setView(view, persist) {
    var stage = el('stage');
    if (!stage) return;
    var next = view === 'scopes' ? 'scopes' : 'map';
    stage.setAttribute('data-view', next);

    Array.prototype.forEach.call(document.querySelectorAll('.view-switch button'), function (button) {
      var active = button.getAttribute('data-view') === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (next === 'map' && theatreInit()) {
      theatreRender();
      theatreReadout();
      setTimeout(function () {
        if (theatre.map) theatre.map.invalidateSize();
        theatreRender();
      }, 90);
    }

    if (persist) {
      try { localStorage.setItem('bu_radar_view', next); } catch (err) { /* private mode */ }
    }
  }

  function labelRect(option, width) {
    var left = option.anchor === 'end' ? option.x - width : option.x;
    return { left: left, right: left + width, top: option.y - 14, bottom: option.y + 32 };
  }

  function insideScope(rect) {
    var corners = [
      [rect.left, rect.top], [rect.right, rect.top],
      [rect.left, rect.bottom], [rect.right, rect.bottom]
    ];
    return corners.every(function (c) {
      var dx = c[0] - 500;
      var dy = c[1] - 500;
      return Math.sqrt(dx * dx + dy * dy) < 402;
    });
  }

  function placeLabel(x, y, callsign, detail, placed, force) {
    var detailWidth = Math.max(84, String(callsign).length * 9.6 + 12, String(detail).length * 7.5 + 10);
    var nameWidth = Math.max(62, String(callsign).length * 9.6 + 12);
    var widths = detail ? [detailWidth, nameWidth] : [nameWidth];
    var above = y > 120;
    var options = [
      { x: x + 19, y: y - 10, anchor: 'start' },
      { x: x + 19, y: y + 30, anchor: 'start' },
      { x: x - 19, y: y - 10, anchor: 'end' },
      { x: x - 19, y: y + 30, anchor: 'end' },
      { x: x + 19, y: y + 54, anchor: 'start' },
      { x: x - 19, y: y - 34, anchor: 'end' }
    ];
    if (!above) options = options.slice(1, 5).concat(options.slice(0, 1));

    for (var w = 0; w < widths.length; w++) {
      for (var i = 0; i < options.length; i++) {
        var option = options[i];
        var rect = labelRect(option, widths[w]);
        if (!insideScope(rect)) continue;
        var collides = placed.some(function (other) {
          return !(rect.right + 3 < other.left || rect.left - 3 > other.right ||
            rect.bottom + 3 < other.top || rect.top - 3 > other.bottom);
        });
        if (!collides || force) {
          placed.push(rect);
          return {
            x: option.x,
            y: option.y,
            anchor: option.anchor,
            detail: detail && widths[w] === detailWidth
          };
        }
      }
    }
    if (!force) return null;

    var fallback = {
      x: x >= 500 ? Math.max(40, x - 15) : Math.min(960, x + 15),
      y: clamp(y + (y < 500 ? 34 : -18), 30, 970),
      anchor: x >= 500 ? 'end' : 'start',
      detail: !!detail
    };
    placed.push(labelRect(fallback, detail ? detailWidth : nameWidth));
    return fallback;
  }

  function renderScope(key) {
    var scope = SCOPES[key];
    var priority = { hostile: 0, unknown: 1, friendly: 2, civil: 3 };
    var contacts = contactList(key).slice().sort(function (a, b) {
      return (priority[affClass(a.aff)] - priority[affClass(b.aff)]) ||
        (num(a.range, 0) - num(b.range, 0));
    });
    var blipHost = document.querySelector('[data-blips="' + key + '"]');
    var trailHost = document.querySelector('[data-trails="' + key + '"]');
    if (!blipHost || !trailHost) return;

    var history = trails[key];
    var seen = new Set();
    var placedLabels = [];
    var blipParts = [];
    var trailParts = [];
    var nowSeconds = performance.now() / 1000;
    var selectedId = selected[key];

    contacts.forEach(function (contact) {
      var id = String(contact.id == null ? contact.callsign : contact.id);
      var aff = affClass(contact.aff);
      var range = clamp(num(contact.range, 0), 0, scope.range * 1.4);
      var bearing = ((num(contact.bearing, 0) % 360) + 360) % 360;
      var heading = ((num(contact.heading, bearing) % 360) + 360) % 360;
      var speed = Math.max(0, num(contact.speed, 0));
      var pos = contactPoint(scope, range, bearing);

      seen.add(id);

      var points = history.get(id) || [];
      var last = points[points.length - 1];
      if (!last || Math.abs(last.x - pos.x) > 0.6 || Math.abs(last.y - pos.y) > 0.6) {
        points.push({ x: pos.x, y: pos.y });
        if (points.length > 24) points.shift();
      }
      history.set(id, points);

      if (points.length > 1) {
        trailParts.push('<polyline class="trail is-' + aff + '" points="' +
          points.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') +
          '"></polyline>');
      }

      var isAir = key === 'air';
      var isSub = !isAir && String(contact.kind) === 'sub';
      var marker;
      if (isSub) {
        marker = '<circle class="blip-sym" r="5.5"></circle>' +
          '<line x1="-8" y1="0" x2="8" y2="0" stroke="currentColor" stroke-width="1.6"></line>';
      } else if (isAir) {
        marker = '<path class="blip-sym" d="M0 -10 L6 7 L0 4 L-6 7 Z"></path>';
      } else {
        marker = '<path class="blip-sym" d="M0 -9 L7 6 L0 3 L-7 6 Z"></path>';
      }

      var vectorLength = clamp(9 + speed / (isAir ? 80 : 4), 9, 32);
      var rad = heading * Math.PI / 180;
      var vectorX = pos.x + Math.sin(rad) * vectorLength;
      var vectorY = pos.y - Math.cos(rad) * vectorLength;

      var detail = Math.round(bearing) + '°/' + Math.round(range) + 'KM · ' +
        (isAir ? (Math.round(num(contact.alt, 0)) > 0 ? Math.round(num(contact.alt, 0)) + 'K FT' : 'SURFACE')
          : (isSub ? 'SUB' : 'SURF'));
      if ((aff === 'friendly' || aff === 'civil') && selectedId !== id) detail = '';
      var isSelected = selectedId === id;
      var label = placeLabel(pos.x, pos.y, contact.callsign || 'UNKNOWN', detail, placedLabels, isSelected);

      var delay = (bearing / 360) * scope.sweep - nowSeconds;
      var classes = 'blip is-' + aff + (selectedId === id ? ' is-selected' : '');

      blipParts.push(
        '<g class="' + classes + '" data-id="' + esc(id) + '" data-scope="' + key +
        '" style="animation-delay:' + delay.toFixed(2) + 's">' +
        '<circle class="blip-ring" cx="' + pos.x.toFixed(1) + '" cy="' + pos.y.toFixed(1) + '" r="15"></circle>' +
        '<g transform="translate(' + pos.x.toFixed(1) + ' ' + pos.y.toFixed(1) + ') rotate(' + heading.toFixed(0) + ')">' +
        marker + '</g>' +
        '<circle class="blip-pip" cx="' + pos.x.toFixed(1) + '" cy="' + pos.y.toFixed(1) + '" r="2.4"></circle>' +
        '<line class="blip-vec" x1="' + pos.x.toFixed(1) + '" y1="' + pos.y.toFixed(1) +
        '" x2="' + vectorX.toFixed(1) + '" y2="' + vectorY.toFixed(1) + '"></line>' +
        (label ? '<text class="blip-label" x="' + label.x.toFixed(1) + '" y="' + label.y.toFixed(1) +
          '" text-anchor="' + label.anchor + '">' + esc(contact.callsign || 'UNKNOWN') + '</text>' +
          (label.detail ? '<text class="blip-sub" x="' + label.x.toFixed(1) + '" y="' + (label.y + 14).toFixed(1) +
            '" text-anchor="' + label.anchor + '">' + esc(detail) + '</text>' : '') : '') +
        '</g>'
      );
    });

    history.forEach(function (_, id) {
      if (!seen.has(id)) history.delete(id);
    });

    blipHost.innerHTML = blipParts.join('');
    trailHost.innerHTML = trailParts.join('');

    var hostileCount = 0;
    var unknownCount = 0;
    var nearest = null;
    contacts.forEach(function (contact) {
      var aff = affClass(contact.aff);
      if (aff === 'hostile') {
        hostileCount++;
        var range = num(contact.range, Infinity);
        if (nearest === null || range < nearest) nearest = range;
      } else if (aff === 'unknown') {
        unknownCount++;
      }
    });

    var totalNode = el(key + 'Total');
    var hostileNode = el(key + 'Hostile');
    var unknownNode = el(key + 'Unknown');
    var nearestNode = el(key + 'Nearest');
    if (totalNode) totalNode.textContent = contacts.length;
    if (hostileNode) hostileNode.textContent = hostileCount;
    if (unknownNode) unknownNode.textContent = unknownCount;
    if (nearestNode) nearestNode.textContent = nearest === null ? '—' : Math.round(nearest) + ' KM';

    var scopeState = el(key + 'State');
    if (scopeState) {
      if (hostileCount > 0) {
        scopeState.className = 'scope-state is-threat';
        scopeState.innerHTML = '<i></i>THREAT · ' + hostileCount;
      } else if (contacts.length > 0) {
        scopeState.className = 'scope-state is-tracking';
        scopeState.innerHTML = '<i></i>TRACKING · ' + contacts.length;
      } else {
        scopeState.className = 'scope-state is-quiet';
        scopeState.innerHTML = '<i></i>QUIET';
      }
    }

    var emptyNode = el(key + 'Empty');
    if (emptyNode) emptyNode.hidden = contacts.length > 0;

    var svg = document.querySelector('#scope-' + key + ' .ppi');
    if (svg) {
      svg.setAttribute('aria-label', (key === 'air' ? 'Air' : 'Naval') +
        ' radar scope, ' + contacts.length + ' contacts, ' + hostileCount +
        ' hostile, centred on ' + scope.center);
    }

    updateReadout(key);
  }

  function selectedContact(key) {
    var id = selected[key];
    if (id == null) return null;
    var contacts = contactList(key);
    for (var i = 0; i < contacts.length; i++) {
      var contactId = String(contacts[i].id == null ? contacts[i].callsign : contacts[i].id);
      if (contactId === id) return contacts[i];
    }
    return null;
  }

  function updateReadout(key) {
    var node = el(key + 'Selected');
    if (!node) return;
    var contact = selectedContact(key);
    if (!contact) {
      selected[key] = null;
      node.textContent = 'NO TRACK SELECTED · CLICK A CONTACT';
      return;
    }
    node.textContent = contactDetail(key, contact);
  }

  function updateCondition() {
    var condition = ['GREEN', 'AMBER', 'RED'].indexOf(state.condition) >= 0 ? state.condition : 'GREEN';
    var badge = el('conditionBadge');
    var text = el('conditionText');
    if (badge) badge.setAttribute('data-cond', condition);
    if (text) text.textContent = condition;

    if (condition !== lastCondition) {
      if (!state.silenced && audioOn) {
        if (condition === 'RED') alertTone('red');
        else if (condition === 'AMBER') alertTone('amber');
      }
      lastCondition = condition;
    }

    var silence = el('silenceFlag');
    if (silence) silence.hidden = !state.silenced;
  }

  function updateHeaderTotals() {
    var air = contactList('air');
    var naval = contactList('naval');
    var hostiles = 0;
    air.concat(naval).forEach(function (contact) {
      if (affClass(contact.aff) === 'hostile') hostiles++;
    });
    var airNode = el('hdrAir');
    var navalNode = el('hdrNaval');
    var hostileNode = el('hdrHostile');
    if (airNode) airNode.textContent = air.length;
    if (navalNode) navalNode.textContent = naval.length;
    if (hostileNode) hostileNode.textContent = hostiles;
  }

  function checkNewHostiles(first) {
    var current = new Set();
    contactList('air').concat(contactList('naval')).forEach(function (contact) {
      if (affClass(contact.aff) === 'hostile') {
        current.add(String(contact.id == null ? contact.callsign : contact.id));
      }
    });
    if (!first && audioOn && !state.silenced) {
      var fresh = 0;
      current.forEach(function (id) { if (!knownHostiles.has(id)) fresh++; });
      if (fresh > 0) alertTone('hostile');

    }
    knownHostiles = current;
  }

  function checkOrders(first) {
    var maxId = 0;
    state.orders.forEach(function (order) {
      maxId = Math.max(maxId, num(order.id, 0));
    });
    if (first) {
      lastOrderId = maxId;
      return;
    }
    state.orders.forEach(function (order) {
      if (num(order.id, 0) <= lastOrderId) return;
      if (order.type === 'drill') {
        var scopeKey = order.payload && order.payload.scope === 'naval' ? 'naval' : 'air';
        flashDrill(scopeKey);
      }
    });
    lastOrderId = Math.max(lastOrderId, maxId);
  }

  function flashDrill(key) {
    var node = el(key + 'Drill');
    if (!node) return;
    node.hidden = false;
    clearTimeout(drillTimers[key]);
    drillTimers[key] = setTimeout(function () { node.hidden = true; }, 8000);
    if (audioOn && !state.silenced) alertTone('drill');
  }

  function renderTicker() {
    var track = el('tickerTrack');
    if (!track) return;
    var items = [];
    var air = contactList('air');
    var naval = contactList('naval');
    var hostiles = 0;
    air.concat(naval).forEach(function (contact) {
      if (affClass(contact.aff) === 'hostile') hostiles++;
    });

    var conditionClass = state.condition === 'RED' ? ' class="is-warn"' :
      state.condition === 'AMBER' ? ' class="is-warn"' : '';
    items.push('<span' + conditionClass + '><b>COND</b> ' + state.condition + ' · ' +
      hostiles + ' HOSTILE</span>');

    state.messages.slice(-2).forEach(function (message) {
      if (message && message.text) items.push('<span><b>MSG</b> ' + esc(message.text) + '</span>');
    });

    state.orders.slice(-6).forEach(function (order) {
      var payload = order.payload || {};
      if (order.type === 'condition') {
        items.push('<span class="is-warn"><b>COND</b> ' + esc(payload.condition) + ' SET</span>');
      } else if (order.type === 'drill') {
        items.push('<span><b>EXERCISE</b> ' + esc(String(payload.scope || 'air').toUpperCase()) + ' SCOPE</span>');
      } else if (order.type === 'convoy') {
        items.push('<span><b>CONVOY</b> ' + esc(String(payload.destination || '').toUpperCase()) +
          ' · ETA ' + esc(payload.etaHours) + 'H</span>');
      } else if (order.type === 'convoy-end') {
        items.push('<span><b>CONVOY</b> ' + esc(String(payload.status || '').toUpperCase()) + '</span>');
      } else if (order.type === 'silence') {
        items.push('<span class="is-warn"><b>SIREN</b> ' +
          (payload.silenced ? 'SILENCED' : 'RESTORED') + '</span>');
      }
    });

    items.push('<span><b>AIR</b> ' + air.length + ' TRACKS</span>');
    items.push('<span><b>SEA</b> ' + naval.length + ' TRACKS</span>');

    if (items.length > 8) items = items.slice(-8);

    var content = '<span class="ticker-group">' + items.join('<span class="sep">◆</span>') +
      '</span><span class="ticker-group">' + items.join('<span class="sep">◆</span>') + '</span>';
    if (track.innerHTML !== content) {
      track.innerHTML = content;
    }
  }

  function renderAll(first) {
    updateCondition();
    updateHeaderTotals();
    renderScope('air');
    renderScope('naval');
    theatreRender();
    theatreReadout();
    renderTicker();
    checkNewHostiles(first);
    checkOrders(first);
  }

  function applyState(next) {
    if (!next || typeof next !== 'object') return;
    var first = !state.updatedAt;
    var condition = ['GREEN', 'AMBER', 'RED'].indexOf(next.condition) >= 0 ? next.condition : state.condition;

    state.updatedAt = num(next.updatedAt, state.updatedAt);
    state.condition = condition;
    state.silenced = !!next.silenced;

    ['air', 'naval'].forEach(function (key) {
      var side = next[key];
      if (side && Array.isArray(side.contacts)) {
        state[key] = side;
      }
    });

    if (Array.isArray(next.orders)) state.orders = next.orders;
    if (Array.isArray(next.messages)) state.messages = next.messages;

    renderAll(first);
  }

  /* ---------- Audio ---------- */

  function ensureAudio() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(frequency, start, duration, gainValue) {
    if (!audioCtx) return;
    var oscillator = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    var begin = audioCtx.currentTime + start;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, begin);
    gain.gain.exponentialRampToValueAtTime(gainValue, begin + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, begin + duration);
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start(begin);
    oscillator.stop(begin + duration + 0.05);
  }

  function alertTone(kind) {
    if (!audioOn) return;
    ensureAudio();
    if (!audioCtx) return;
    if (kind === 'red') {
      tone(880, 0, 0.16, 0.055);
      tone(640, 0.2, 0.16, 0.055);
      tone(880, 0.4, 0.16, 0.055);
    } else if (kind === 'amber') {
      tone(680, 0, 0.14, 0.045);
      tone(540, 0.18, 0.14, 0.045);
    } else if (kind === 'hostile') {
      tone(760, 0, 0.1, 0.045);
      tone(580, 0.15, 0.12, 0.045);
    } else {
      tone(520, 0, 0.09, 0.035);
    }
  }

  /* ---------- Clock / connection ---------- */

  var timeFormat = null;
  var dateFormat = null;
  try {
    timeFormat = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    dateFormat = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Belgrade', weekday: 'short', day: '2-digit', month: 'short'
    });
  } catch (err) {
    timeFormat = null;
    dateFormat = null;
  }

  function updateClock() {
    var now = new Date();
    var timeNode = el('clockTime');
    var dateNode = el('clockDate');
    if (timeNode) {
      timeNode.textContent = timeFormat ? timeFormat.format(now) :
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');
    }
    if (dateNode) {
      dateNode.textContent = dateFormat ? dateFormat.format(now).toUpperCase() :
        now.toDateString().toUpperCase();
    }
  }

  function setMode(nextMode, label) {
    mode = nextMode;
    var node = el('uplink');
    var text = el('uplinkText');
    if (!text) return;
    text.textContent = label;
    if (node) {
      if (nextMode === 'live') node.removeAttribute('data-mode');
      else node.setAttribute('data-mode', nextMode === 'local' ? 'local' : 'error');
    }
  }

  function connectStream() {
    if (!window.EventSource) return;
    source = new EventSource('/api/stream');
    source.addEventListener('open', function () {
      stopLocalSim();
      setMode('live', 'SERVER UPLINK');
    });
    source.addEventListener('state', function (event) {
      try {
        applyState(JSON.parse(event.data));
        if (mode !== 'live') setMode('live', 'SERVER UPLINK');
      } catch (err) { /* ignore malformed frame */ }
    });
    source.addEventListener('error', function () {
      if (mode !== 'local') setMode('sync', 'RECONNECTING');
    });
  }

  function refresh() {
    if (mode === 'local') return;
    fetch('/api/state', { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('state unavailable');
        return response.json();
      })
      .then(function (payload) {
        applyState(payload);
        stopLocalSim();
        if (mode !== 'live') setMode('sync', 'SERVER SYNC');
      })
      .catch(function () {
        if (!localTimer) startLocalSim();
      });
  }

  /* ---------- Local fallback simulation ---------- */

  var AIR_TABLE = {
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

  var NAVAL_TABLE = {
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

  var CALLSIGNS = {
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

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomAffinity() {
    var roll = Math.random();
    if (roll < 0.3) return 'hostile';
    if (roll < 0.62) return 'unknown';
    if (roll < 0.88) return 'friendly';
    return 'civil';
  }

  function makeLocalContact(side, affinity, range, bearing) {
    var table = side === 'air' ? AIR_TABLE : NAVAL_TABLE;
    var options = table[affinity] || table.unknown;
    var base = pick(options);
    var callsign = pick(CALLSIGNS[side][affinity] || CALLSIGNS[side].unknown);
    if (affinity !== 'civil') callsign += ' ' + (10 + Math.floor(Math.random() * 89));
    var heading = affinity === 'hostile' ? (bearing + 180 + (Math.random() * 24 - 12)) % 360 :
      Math.random() * 360;
    return {
      id: 'L' + (++localCounter),
      callsign: callsign,
      cls: base.cls,
      kind: base.kind,
      aff: affinity,
      range: range,
      bearing: (bearing + 360) % 360,
      alt: side === 'air' ? Math.max(0, base.alt + (Math.random() * 3 - 1)) : 0,
      speed: Math.round(base.speed * (0.85 + Math.random() * 0.3)),
      heading: heading,
      depth: base.kind === 'sub' ? Math.round(40 + Math.random() * 220) : 0
    };
  }

  function makeRandomLocalContact(side) {
    var scope = SCOPES[side];
    return makeLocalContact(
      side,
      randomAffinity(),
      scope.range * (0.35 + Math.random() * 0.6),
      Math.random() * 360
    );
  }

  function autoCondition() {
    var hostiles = 0;
    var unknowns = 0;
    ['air', 'naval'].forEach(function (key) {
      localState[key].contacts.forEach(function (contact) {
        if (contact.aff === 'hostile') hostiles++;
        else if (contact.aff === 'unknown') unknowns++;
      });
    });
    if (hostiles >= 3) return 'RED';
    if (hostiles >= 1 || unknowns >= 6) return 'AMBER';
    return 'GREEN';
  }

  function startLocalSim() {
    if (localTimer) return;
    localState = {
      updatedAt: 0,
      condition: 'GREEN',
      silenced: false,
      air: { contacts: [] },
      naval: { contacts: [] },
      orders: [],
      messages: [{ id: 'local', text: 'AUTONOMOUS SCOPE GENERATOR · FICTIONAL TRAFFIC', at: Date.now() }]
    };

    localState.air.contacts.push(makeLocalContact('air', 'hostile', 208, 112));
    localState.air.contacts.push(makeLocalContact('air', 'unknown', 164, 286));
    localState.air.contacts.push(makeLocalContact('air', 'friendly', 96, 342));
    localState.air.contacts.push(makeLocalContact('air', 'civil', 188, 238));
    localState.air.contacts.push(makeLocalContact('air', 'unknown', 226, 64));

    localState.naval.contacts.push(makeLocalContact('naval', 'hostile', 254, 128));
    localState.naval.contacts.push(makeLocalContact('naval', 'friendly', 122, 214));
    localState.naval.contacts.push(makeLocalContact('naval', 'unknown', 196, 312));
    localState.naval.contacts.push(makeLocalContact('naval', 'civil', 88, 24));

    setMode('local', 'AUTONOMOUS RADAR');
    tickLocal();
    localTimer = setInterval(tickLocal, 2200);
  }

  function tickLocal() {
    if (!localState) return;

    ['air', 'naval'].forEach(function (key) {
      var scope = SCOPES[key];
      var contacts = localState[key].contacts;

      while (contacts.length < 3) contacts.push(makeRandomLocalContact(key));
      if (contacts.length < 9 && Math.random() < 0.13) contacts.push(makeRandomLocalContact(key));

      contacts.forEach(function (contact) {
        var step = (Math.max(0, contact.speed) / 3600) * 2.2;
        var rel = (contact.heading - contact.bearing) * Math.PI / 180;
        contact.range += step * Math.cos(rel);
        contact.bearing = (contact.bearing +
          (step / Math.max(contact.range, 14)) * Math.sin(rel) * (180 / Math.PI) + 360) % 360;
        contact.heading = (contact.heading + (Math.random() * 4 - 2) + 360) % 360;
        if (key === 'air' && Math.random() < 0.03) {
          contact.alt = clamp(contact.alt + (Math.random() * 2 - 1), 0, 60);
        }
        if (contact.kind === 'sub') {
          contact.depth = clamp(contact.depth + (Math.random() * 6 - 3), 20, 400);
        }
      });

      localState[key].contacts = contacts.filter(function (contact) {
        return contact.range < scope.range + 50 && contact.range > 7;
      });
      localState[key].total = localState[key].contacts.length;
      localState[key].hostile = localState[key].contacts.filter(function (c) { return c.aff === 'hostile'; }).length;
      localState[key].unknown = localState[key].contacts.filter(function (c) { return c.aff === 'unknown'; }).length;
      localState[key].friendly = localState[key].contacts.filter(function (c) { return c.aff === 'friendly'; }).length;
    });

    localState.condition = autoCondition();
    localState.updatedAt = Date.now();
    applyState(localState);
  }

  function stopLocalSim() {
    if (localTimer) {
      clearInterval(localTimer);
      localTimer = null;
    }
  }

  /* ---------- Interaction ---------- */

  function bind() {
    ['air', 'naval'].forEach(function (key) {
      var svg = document.querySelector('#scope-' + key + ' .ppi');
      if (!svg) return;

      svg.addEventListener('click', function (event) {
        var group = event.target.closest ? event.target.closest('.blip') : null;
        if (!group) return;
        var id = group.getAttribute('data-id');
        selected[key] = selected[key] === id ? null : id;
        renderScope(key);
        theatreRender();
        theatreReadout();
      });

      svg.addEventListener('mouseover', function (event) {
        var group = event.target.closest ? event.target.closest('.blip') : null;
        if (!group) return;
        var contact = null;
        var contacts = contactList(key);
        for (var i = 0; i < contacts.length; i++) {
          var contactId = String(contacts[i].id == null ? contacts[i].callsign : contacts[i].id);
          if (contactId === group.getAttribute('data-id')) { contact = contacts[i]; break; }
        }
        var node = el(key + 'Selected');
        if (contact && node) node.textContent = contactDetail(key, contact);
      });

      svg.addEventListener('mouseout', function (event) {
        var group = event.target.closest ? event.target.closest('.blip') : null;
        if (!group) return;
        updateReadout(key);
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.view-switch button'), function (button) {
      button.addEventListener('click', function () {
        setView(button.getAttribute('data-view'), true);
      });
    });

    window.addEventListener('resize', function () {
      var stage = el('stage');
      if (theatre.ready && stage && stage.getAttribute('data-view') === 'map') {
        theatre.map.invalidateSize();
      }
    });

    var audioButton = el('audioBtn');
    if (audioButton) {
      audioButton.addEventListener('click', function () {
        audioOn = !audioOn;
        audioButton.setAttribute('aria-pressed', String(audioOn));
        var label = el('audioLabel');
        if (label) label.textContent = audioOn ? 'AUDIO ON' : 'AUDIO OFF';
        if (audioOn) {
          ensureAudio();
          tone(880, 0, 0.09, 0.035);
        }
      });
    }
  }

  /* ---------- Boot ---------- */

  function init() {
    Object.keys(SCOPES).forEach(function (key) {
      buildGrid(key);
      buildSweep(key);
      buildLand(key);
    });
    bind();
    updateClock();
    setInterval(updateClock, 1000);
    renderTicker();

    var savedView = 'map';
    try {
      var storedView = localStorage.getItem('bu_radar_view');
      if (storedView === 'scopes' || storedView === 'map') savedView = storedView;
    } catch (err) { /* storage unavailable */ }
    setView(savedView, false);

    var uplinkMeta = document.querySelector('meta[name="bu-uplink"]');
    var serverUplink = !uplinkMeta || uplinkMeta.getAttribute('content') !== 'static';

    if (serverUplink && (location.protocol === 'http:' || location.protocol === 'https:')) {
      var useStream = true;
      try { useStream = new URLSearchParams(location.search).get('stream') !== '0'; }
      catch (err) { useStream = true; }
      if (useStream) connectStream();
      refresh();
      pollTimer = setInterval(function () {
        if (mode !== 'live') refresh();
      }, 6000);
    } else {
      startLocalSim();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
