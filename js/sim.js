/* Fictional alert simulation for the Balkan Union Common Alert Network. */
(function () {
  'use strict';

  var BU = window.BU;
  if (!BU) return;

  var RAD = Math.PI / 180;
  var seq = 0;

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function pickWeighted(list, weightKey) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i][weightKey] || 1;
    var roll = Math.random() * total;
    for (var j = 0; j < list.length; j++) {
      roll -= list[j][weightKey] || 1;
      if (roll <= 0) return list[j];
    }
    return list[list.length - 1];
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * RAD;
    var dLon = (lon2 - lon1) * RAD;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    var y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
    var x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
      Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  function formatCity(threat) {
    return threat.target.city;
  }

  function Simulation() {
    this.reset(true);
  }

  Simulation.prototype.reset = function (seed) {
    var now = Date.now();
    this.threats = [];
    this.recent = [];
    this.incidents = [];
    this.alerts = [];
    this.status = 'clear';
    this.alertsUpdated = now;
    this.nextAirAt = now + rand(19000, 32000);
    this.nextBorderAt = now + rand(26000, 44000);

    if (seed) {
      this.seedThreats();
      this.seedBorder();
    }
    this.update(now);
  };

  Simulation.prototype.seedThreats = function () {
    this.launchThreat({ cls: 'ballistic', cityName: 'Varna', ageSeconds: 22, silent: true });
    this.launchThreat({ cls: 'shahed', cityName: 'Chișinău', ageSeconds: 14, silent: true });
    this.launchThreat({ cls: 'cruise', cityName: 'Budapest', ageSeconds: 26, silent: true });
  };

  Simulation.prototype.seedBorder = function () {
    this.addIncident('aegean', 'critical', { silent: true, createdAt: Date.now() - 54000 });
    this.addIncident('black-sea', 'elevated', { silent: true, createdAt: Date.now() - 112000 });
    this.addIncident('eastern', 'elevated', { silent: true, createdAt: Date.now() - 78000 });
  };

  Simulation.prototype.affectedZones = function (city, radiusKm) {
    var zones = [];
    Object.keys(BU.ZONES).forEach(function (key) {
      var zone = BU.ZONES[key];
      if (key === city.zone || haversineKm(city.lat, city.lon, zone.center[0], zone.center[1]) <= radiusKm) {
        zones.push(key);
      }
    });
    return zones;
  };

  Simulation.prototype.pickCity = function () {
    var taken = this.threats.map(function (t) { return t.target.city; });
    for (var attempt = 0; attempt < 12; attempt++) {
      var city = pick(BU.CITIES);
      if (taken.indexOf(city.name) === -1) return city;
    }
    return pick(BU.CITIES);
  };

  Simulation.prototype.weightedClass = function () {
    return pickWeighted([
      { id: 'ballistic', weight: 22 },
      { id: 'cruise', weight: 30 },
      { id: 'jet', weight: 20 },
      { id: 'shahed', weight: 28 }
    ], 'weight').id;
  };

  Simulation.prototype.launchThreat = function (options) {
    options = options || {};
    var profile = BU.THREAT_CLASSES[options.cls] || BU.THREAT_CLASSES[this.weightedClass()];
    var city = options.cityName ?
      BU.CITIES.filter(function (c) { return c.name === options.cityName; })[0] : this.pickCity();
    if (!city) city = this.pickCity();

    var zone = BU.ZONES[city.zone];
    var sites = BU.LAUNCH_SITES.filter(function (site) {
      return zone.launch.indexOf(site.region) !== -1;
    });
    var site = sites.length ? pick(sites) : pick(BU.LAUNCH_SITES);

    var durationSec = options.etaSeconds != null ?
      options.etaSeconds + (options.ageSeconds || 0) :
      rand(profile.duration[0], profile.duration[1]);
    var age = Math.min(options.ageSeconds || 0, durationSec * 0.7);
    var now = Date.now();
    var start = now - age * 1000;
    var end = start + durationSec * 1000;

    var threat = {
      id: 'T' + (++seq).toString().padStart(3, '0'),
      cls: profile.id,
      label: profile.full,
      weapon: pick(profile.weapons),
      color: profile.color,
      origin: { name: site.name, lat: site.lat, lon: site.lon },
      target: { city: city.name, zone: city.zone, lat: city.lat, lon: city.lon },
      start: start,
      end: end,
      duration: durationSec,
      progress: clamp(age / durationSec, 0, 1),
      bow: rand(-0.75, 0.75),
      interceptAt: Math.random() < profile.interceptRate ? rand(0.58, 0.93) : null,
      zones: this.affectedZones(city, profile.radiusKm),
      status: 'inbound'
    };
    this.threats.push(threat);
    this.applyKinematics(threat, now);
    if (!options.silent) {
      this.lastLaunch = threat.id;
    }
    return threat;
  };

  Simulation.prototype.positionAt = function (threat, t) {
    var p = clamp(t, 0, 1);
    var o = threat.origin, d = threat.target;
    var dLat = d.lat - o.lat;
    var dLon = d.lon - o.lon;
    var len = Math.hypot(dLat, dLon) || 1;
    var perpLat = -dLon / len;
    var perpLon = dLat / len;
    var arc = threat.bow * 0.85 * Math.sin(Math.PI * p);
    return {
      lat: o.lat + dLat * p + perpLat * arc,
      lon: o.lon + dLon * p + perpLon * arc
    };
  };

  Simulation.prototype.applyKinematics = function (threat, now) {
    var profile = BU.THREAT_CLASSES[threat.cls];
    var raw = (now - threat.start) / (threat.end - threat.start);
    threat.progress = clamp(raw, 0, 1);
    threat.eta = Math.max(0, (threat.end - now) / 1000);
    var pos = this.positionAt(threat, threat.progress);
    var next = this.positionAt(threat, Math.min(1, threat.progress + 0.01));
    threat.lat = pos.lat;
    threat.lon = pos.lon;
    threat.heading = bearing(pos.lat, pos.lon, next.lat, next.lon);
    var altRange = profile.altKm;
    var altCurve = threat.cls === 'ballistic' ?
      (0.25 + 0.75 * Math.sin(Math.PI * threat.progress)) :
      (0.55 + 0.45 * Math.sin(Math.PI * threat.progress));
    threat.altitude = altRange[0] + (altRange[1] - altRange[0]) * altCurve;
    threat.speed = profile.speedKmh;
  };

  Simulation.prototype.resolve = function (threat, outcome, now) {
    var fraction = outcome === 'intercepted' ? (threat.interceptAt || threat.progress) : 1;
    var point = this.positionAt(threat, fraction);
    this.recent.unshift({
      id: threat.id + '-' + outcome,
      threatId: threat.id,
      cls: threat.cls,
      color: threat.color,
      weapon: threat.weapon,
      city: threat.target.city,
      zone: threat.target.zone,
      outcome: outcome,
      at: now,
      point: point
    });
    if (this.recent.length > 12) this.recent.length = 12;
    this.booms = this.booms || [];
    this.booms.push({ id: threat.id + '-' + outcome, lat: point.lat, lon: point.lon, kind: outcome, at: now });
  };

  Simulation.prototype.update = function (now) {
    var keep = [];
    for (var i = 0; i < this.threats.length; i++) {
      var threat = this.threats[i];
      var raw = (now - threat.start) / (threat.end - threat.start);

      if (threat.interceptAt != null && raw >= threat.interceptAt) {
        threat.progress = threat.interceptAt;
        this.applyKinematics(threat, now);
        this.resolve(threat, 'intercepted', now);
        continue;
      }
      if (raw >= 1) {
        threat.progress = 1;
        threat.eta = 0;
        this.resolve(threat, 'impact', now);
        continue;
      }
      this.applyKinematics(threat, now);
      keep.push(threat);
    }
    this.threats = keep;
    if (this.booms) {
      this.booms = this.booms.filter(function (b) { return now - b.at < 3500; });
    }

    if (now >= this.nextAirAt) {
      if (this.threats.length < 6) this.launchThreat();
      this.nextAirAt = now + rand(20000, 39000);
    }

    if (now >= this.nextBorderAt) {
      this.randomBorderEvent();
      this.nextBorderAt = now + rand(24000, 46000);
    }

    this.incidents = this.incidents.filter(function (incident) {
      return now - incident.createdAt < incident.ttl;
    });

    this.computeAlerts(now);
    return this.getState(now);
  };

  Simulation.prototype.computeAlerts = function (now) {
    var groups = {};
    for (var i = 0; i < this.threats.length; i++) {
      var threat = this.threats[i];
      var eta = (threat.end - now) / 1000;
      for (var j = 0; j < threat.zones.length; j++) {
        var zoneKey = threat.zones[j];
        if (!groups[zoneKey]) {
          groups[zoneKey] = {
            zone: zoneKey,
            threats: [],
            eta: Infinity,
            classes: {},
            weapons: {},
            targets: [],
            nearest: threat
          };
        }
        var group = groups[zoneKey];
        group.threats.push(threat);
        if (eta < group.eta) {
          group.eta = eta;
          group.nearest = threat;
        }
        group.classes[threat.cls] = true;
        group.weapons[threat.weapon] = true;
        if (group.targets.indexOf(threat.target.city) === -1) group.targets.push(threat.target.city);
      }
    }

    var alerts = [];
    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      var zone = BU.ZONES[key];
      var eta = Math.max(0, group.eta);
      var level = eta <= 40 ? 'critical' : eta <= 90 ? 'high' : 'elevated';
      alerts.push({
        zone: key,
        name: zone.name,
        group: zone.group,
        center: zone.center,
        eta: eta,
        level: level,
        classes: Object.keys(group.classes),
        weapons: Object.keys(group.weapons),
        targets: group.targets.slice(0, 4),
        dominant: group.nearest.cls,
        color: group.nearest.color,
        focus: { lat: group.nearest.target.lat, lon: group.nearest.target.lon, city: group.nearest.target.city },
        trackCount: group.threats.length
      });
    });

    alerts.sort(function (a, b) { return a.eta - b.eta; });
    this.alerts = alerts;
    this.alertsUpdated = now;

    var hasCriticalBorder = this.incidents.some(function (incident) {
      return incident.level === 'critical';
    });
    this.status = alerts.length ? 'air' : hasCriticalBorder ? 'border' : 'clear';
  };

  Simulation.prototype.addIncident = function (sectorId, level, options) {
    options = options || {};
    var sector = BU.BORDER_SECTORS.filter(function (s) { return s.id === sectorId; })[0];
    if (!sector) return null;

    var pool = BU.BORDER_INCIDENTS.filter(function (i) { return i.level === level; });
    if (!pool.length) pool = BU.BORDER_INCIDENTS;
    var template = pickWeighted(pool, 'weight');
    var now = Date.now();

    var sameSector = this.incidents.filter(function (i) { return i.sectorId === sectorId; });
    if (sameSector.length >= 2) {
      sameSector.sort(function (a, b) { return a.createdAt - b.createdAt; });
      this.incidents = this.incidents.filter(function (i) { return i.id !== sameSector[0].id; });
    }

    var incident = {
      id: 'B' + (++seq).toString().padStart(3, '0'),
      sectorId: sector.id,
      sector: sector,
      level: level,
      code: template.code,
      label: template.label,
      detail: template.detail,
      createdAt: options.createdAt || now,
      ttl: options.ttl || rand(85000, 190000)
    };
    this.incidents.push(incident);
    if (this.incidents.length > 8) this.incidents.shift();
    return incident;
  };

  Simulation.prototype.randomBorderEvent = function () {
    var sector = pick(BU.BORDER_SECTORS);
    var existing = this.incidents.filter(function (i) { return i.sectorId === sector.id; });
    var roll = Math.random();

    if (existing.length >= 2 || (existing.length && roll < 0.44)) {
      var oldest = existing[0];
      this.incidents = this.incidents.filter(function (i) { return i.id !== oldest.id; });
      return { type: 'cleared', sector: sector };
    }

    var level = Math.random() < 0.24 ? 'critical' : 'elevated';
    var incident = this.addIncident(sector.id, level);
    return { type: 'added', incident: incident };
  };

  Simulation.prototype.borderSectors = function () {
    var self = this;
    return BU.BORDER_SECTORS.map(function (sector) {
      var incidents = self.incidents.filter(function (i) { return i.sectorId === sector.id; });
      var level = 'calm';
      if (incidents.some(function (i) { return i.level === 'critical'; })) level = 'critical';
      else if (incidents.length) level = 'elevated';
      return {
        sector: sector,
        level: level,
        incidents: incidents.slice().sort(function (a, b) {
          if (a.level !== b.level) return a.level === 'critical' ? -1 : 1;
          return b.createdAt - a.createdAt;
        })
      };
    });
  };

  Simulation.prototype.getState = function (now) {
    var sectors = this.borderSectors();
    var activeBorder = sectors.filter(function (s) { return s.level !== 'calm'; });
    return {
      now: now,
      threats: this.threats,
      alerts: this.alerts,
      recent: this.recent,
      incidents: this.incidents.slice().sort(function (a, b) {
        if (a.level !== b.level) return a.level === 'critical' ? -1 : 1;
        return b.createdAt - a.createdAt;
      }),
      sectors: sectors,
      activeBorderCount: activeBorder.length,
      status: this.status,
      alertsUpdated: this.alertsUpdated,
      booms: this.booms || []
    };
  };

  Simulation.prototype.exportState = function () {
    var now = Date.now();
    var state = this.getState(now);
    return {
      simulation: true,
      union: BU.META.name,
      generatedAt: new Date(now).toISOString(),
      status: state.status.toUpperCase(),
      alerts: state.alerts.map(function (alert) {
        return {
          zone: alert.zone,
          group: alert.group,
          level: alert.level,
          dominantThreat: alert.dominant,
          weapons: alert.weapons,
          targets: alert.targets,
          nearestEta: Math.round(alert.eta),
          updatedAt: new Date(state.alertsUpdated).toISOString()
        };
      }),
      threats: state.threats.map(function (threat) {
        return {
          id: threat.id,
          weapon: threat.weapon,
          class: threat.cls,
          status: threat.status,
          origin: { site: threat.origin.name, lat: +threat.origin.lat.toFixed(4), lon: +threat.origin.lon.toFixed(4) },
          target: { city: threat.target.city, zone: threat.target.zone, lat: threat.target.lat, lon: threat.target.lon },
          position: { lat: +threat.lat.toFixed(4), lon: +threat.lon.toFixed(4) },
          altitudeM: Math.round(threat.altitude * 1000),
          speedKmh: threat.speed,
          heading: Math.round(threat.heading),
          progress: +threat.progress.toFixed(3),
          etaSeconds: Math.round(threat.eta),
          threatenedZones: threat.zones
        };
      }),
      border: state.sectors.map(function (row) {
        return {
          sector: row.sector.name,
          neighbour: row.sector.neighbour,
          status: row.level,
          incidents: row.incidents.map(function (incident) {
            return {
              code: incident.code,
              level: incident.level,
              summary: incident.label,
              reportedAt: new Date(incident.createdAt).toISOString()
            };
          })
        };
      })
    };
  };

  Simulation.prototype.drillAir = function () {
    return this.launchThreat({ silent: false });
  };

  Simulation.prototype.drillBorder = function () {
    var sector = pick(BU.BORDER_SECTORS);
    var level = Math.random() < 0.55 ? 'critical' : 'elevated';
    return this.addIncident(sector.id, level);
  };

  Simulation.prototype.drillReset = function () {
    this.reset(true);
  };

  BU.Simulation = Simulation;
  BU.UTIL = {
    haversineKm: haversineKm,
    bearing: bearing,
    clamp: clamp,
    formatCity: formatCity
  };
})();
