/* Balkan Union — fictional war-room simulation. */
(function () {
  'use strict';

  if (!window.BU_WORLD || !window.BU_COUNTIES) return;

  var WORLD = window.BU_WORLD;
  var FACTIONS = WORLD.factions;
  var META = {};
  WORLD.countries.forEach(function (country) { META[country.id] = country; });

  function meta(id) { return META[id]; }
  function factionOf(id) { var m = META[id]; return m ? FACTIONS[m.faction] : FACTIONS.neutral; }
  function powerOf(id) {
    var m = META[id];
    if (!m) return 1;
    var f = FACTIONS[m.faction];
    return f && f.pooled ? f.power : m.power;
  }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function rand(low, high) { return low + Math.random() * (high - low); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function haversine(a, b) {
    var toRad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toRad;
    var dLon = (b[1] - a[1]) * toRad;
    var lat1 = a[0] * toRad;
    var lat2 = b[0] * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function WarSim() {
    this.speed = 1800;
    this.countyList = [];
    this.countyByCountry = {};
    this.countyMap = {};
    this.countries = {};
    this.wars = [];
    this.units = [];
    this.offers = [];
    this.messages = [];
    this.events = [];
    this.gameTime = 0;
    this.lastReal = Date.now();
    this.nextOfferAt = 0;
    this.seq = 0;
    this.offerSeq = 0;
    this.revision = 0;
    this.loadCounties();
    this.resetWorld(Date.now());
  }

  WarSim.prototype.loadCounties = function () {
    var self = this;
    this.countyList = window.BU_COUNTIES.features.map(function (feature) {
      var p = feature.properties;
      return {
        id: p.id,
        country: p.country,
        name: p.name,
        center: p.center,
        capital: !!p.capital,
        faction: p.faction,
        owner: p.country,
        controller: p.country,
        control: 100,
        capture: null
      };
    });
    this.countyList.forEach(function (county) {
      self.countyMap[county.id] = county;
      if (!self.countyByCountry[county.country]) self.countyByCountry[county.country] = [];
      self.countyByCountry[county.country].push(county);
    });
  };

  WarSim.prototype.resetWorld = function (now) {
    var self = this;
    this.countries = {};
    WORLD.countries.forEach(function (country) {
      self.countries[country.id] = {
        id: country.id,
        name: country.name,
        faction: country.faction,
        capital: country.capital,
        capitalCaptured: false,
        cooked: false,
        status: 'stable',
        warId: null
      };
    });
    this.countyList.forEach(function (county) {
      county.owner = county.country;
      county.controller = county.country;
      county.control = 100;
      county.capture = null;
    });
    this.wars = [];
    this.units = [];
    this.offers = [];
    this.messages = [];
    this.events = [];
    this.gameTime = 0;
    this.lastReal = now || Date.now();
    this.nextOfferAt = 8 * 3600;
    this.revision++;
    this.pushMessage('system', 'AI command net online. 48 state intelligences connected. All borders nominal.', 'system');
    this.pushMessage('csb', 'CARL-1: The spelling of the Balkans is about to change. The Kingdom is watching.', 'leader');
  };

  WarSim.prototype.setSpeed = function (speed) {
    this.speed = speed;
    this.pushMessage('system', 'Simulation tempo set to ×' + speed + '. Game clock is now ' +
      (speed >= 3600 ? (speed / 3600) + ' h/s' : (speed / 60) + ' min/s') + '.', 'system');
  };

  WarSim.prototype.getCountry = function (id) { return this.countries[id]; };

  WarSim.prototype.getCapitalCounty = function (countryId) {
    var list = this.countyByCountry[countryId] || [];
    for (var i = 0; i < list.length; i++) if (list[i].capital) return list[i];
    return null;
  };

  WarSim.prototype.sideControls = function (county, side) {
    if (!META[county.controller]) return false;
    return factionOf(county.controller).id === side;
  };

  WarSim.prototype.nearestControlledCenter = function (side, point) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < this.countyList.length; i++) {
      var county = this.countyList[i];
      if (!this.sideControls(county, side)) continue;
      var d = haversine(point, county.center);
      if (d < bestDist) { bestDist = d; best = county.center; }
    }
    return best || point;
  };

  WarSim.prototype.countryCenter = function (id) {
    var m = META[id];
    if (!m) return [45, 20];
    return m.center;
  };

  WarSim.prototype.getActiveWarFor = function (countryId) {
    return this.wars.filter(function (war) {
      return war.status === 'active' && (war.defender === countryId || war.attacker === countryId);
    })[0] || null;
  };

  WarSim.prototype.canDeclareWar = function (targetId) {
    var target = META[targetId];
    if (!target) return { ok: false, error: 'Unknown state.' };
    if (target.faction === 'balkan') return { ok: false, error: 'Balkan Union members are allied.' };
    var country = this.countries[targetId];
    if (country && (country.cooked || country.capitalCaptured)) {
      return { ok: false, error: target.name + ' is cooked — command authority offline.' };
    }
    if (this.getActiveWarFor(targetId)) return { ok: false, error: target.name + ' is already in an active war.' };
    return { ok: true };
  };

  WarSim.prototype.bestUnionOrigin = function (targetId) {
    var target = META[targetId];
    var point = target ? target.center : [45, 20];
    var best = null;
    var bestDist = Infinity;
    WORLD.countries.forEach(function (country) {
      if (country.faction !== 'balkan') return;
      var d = haversine(point, country.center);
      if (d < bestDist) { bestDist = d; best = country.id; }
    });
    return best || 'serbia';
  };

  WarSim.prototype.declareWar = function (targetId) {
    var check = this.canDeclareWar(targetId);
    if (!check.ok) return check;
    var target = META[targetId];
    var attacker = this.bestUnionOrigin(targetId);
    var war = {
      id: 'war-' + (++this.seq),
      attacker: attacker,
      attackerSide: 'balkan',
      attackerLabel: 'Balkan Union',
      defender: targetId,
      defenderSide: target.faction,
      startedGame: this.gameTime,
      status: 'active',
      captured: [],
      totalCounties: (this.countyByCountry[targetId] || []).length,
      front: null,
      capture: null,
      offerSent: false
    };
    this.wars.push(war);
    this.countries[attacker].warId = war.id;
    this.countries[targetId].warId = war.id;
    this.countries[targetId].status = 'at war';
    this.startNextCapture(war);
    this.pushMessage(attacker, 'STRATEGOS-9: The Union has declared war on ' + target.name +
      '. Strategic deterrent released to theatre command.', 'war');
    this.pushMessage(targetId, target.leader.name + ': ' + target.name + ' will not surrender its counties without a fight.', 'leader');
    this.emit({
      mark: 'WAR', color: '#ef4444',
      title: 'WAR DECLARED · ' + target.name,
      sub: 'Balkan Union fronts advancing · ' + war.totalCounties + ' counties in the theatre',
      focus: targetId
    });
    return { ok: true, war: war };
  };

  WarSim.prototype.selectNextTarget = function (war) {
    var self = this;
    var candidates = (this.countyByCountry[war.defender] || []).filter(function (county) {
      return county.controller !== war.attacker && !war.captured.some(function (id) { return id === county.id; });
    });
    if (!candidates.length) return null;
    var origin = this.countryCenter(war.attacker);
    candidates.sort(function (a, b) {
      return haversine(origin, a.center) - haversine(origin, b.center);
    });
    return candidates[0];
  };

  WarSim.prototype.startNextCapture = function (war) {
    var target = this.selectNextTarget(war);
    if (!target) { this.finishWar(war, 'occupied'); return; }
    var move = 1.75 * 3600;
    war.capture = {
      countyId: target.id,
      phase: 'move',
      moveEnd: this.gameTime + move,
      captureStart: null,
      captureEnd: null,
      progress: 0
    };
    war.front = target.id;
    target.control = 0;
    target.capture = { by: war.attackerSide, progress: 0 };
    this.revision++;
    this.spawnUnits(war, target, war.attackerSide, 2, false);
  };

  WarSim.prototype.spawnUnits = function (war, county, side, count, realMode) {
    var origin = this.nearestControlledCenter(side, county.center);
    var color = FACTIONS[side] ? FACTIONS[side].color : '#3b82f6';
    var now = Date.now();
    for (var i = 0; i < count; i++) {
      var jitterA = (Math.random() - 0.5) * 0.55;
      var jitterB = (Math.random() - 0.5) * 0.55;
      var start = [origin[0] + jitterA, origin[1] + jitterB];
      var end = [county.center[0] + jitterB * 0.35, county.center[1] + jitterA * 0.35];
      var unit = {
        id: 'unit-' + (++this.seq),
        warId: war.id,
        side: side,
        color: color,
        start: start,
        end: end,
        lat: start[0],
        lon: start[1],
        mode: realMode ? 'real' : 'game',
        startAt: realMode ? now : this.gameTime,
        endAt: realMode ? now + rand(1300, 1900) : this.gameTime + rand(1.4, 2.0) * 3600,
        bearing: bearing(start, end),
        countyId: county.id,
        kind: i === 0 ? 'armor' : 'infantry'
      };
      unit.progress = 0;
      this.units.push(unit);
    }
  };

  function bearing(from, to) {
    var toRad = Math.PI / 180;
    var y = Math.sin((to[1] - from[1]) * toRad) * Math.cos(to[0] * toRad);
    var x = Math.cos(from[0] * toRad) * Math.sin(to[0] * toRad) -
      Math.sin(from[0] * toRad) * Math.cos(to[0] * toRad) * Math.cos((to[1] - from[1]) * toRad);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  WarSim.prototype.captureDuration = function (war) {
    var attack = war.attackerSide === 'balkan' ? FACTIONS.balkan.power : powerOf(war.attacker);
    var defend = powerOf(war.defender);
    var ratio = Math.pow(Math.max(defend, 3) / Math.max(attack, 3), 0.4);
    return clamp(3.4 * 3600 * ratio, 1.3 * 3600, 9 * 3600);
  };

  WarSim.prototype.completeCapture = function (war, county) {
    county.controller = war.attacker;
    county.control = 100;
    county.capture = null;
    war.captured.push(county.id);
    war.capture = null;
    war.front = null;
    this.revision++;
    var country = this.countries[war.defender];
    var faction = factionOf(war.attacker);
    var capital = county.capital;
    if (capital) {
      country.capitalCaptured = true;
      country.cooked = true;
      country.status = 'cooked';
      war.status = 'victory';
      war.outcome = 'capital';
      war.endedGame = this.gameTime;
      this.emit({
        mark: 'CAPITAL', color: '#ef4444',
        title: capitalTitle(country.name),
        sub: country.capital + ' captured · ' + country.name + ' is cooked',
        focus: war.defender
      });
      this.pushMessage(war.defender, ((META[war.defender].leader || {}).name || 'COMMAND') + ': capital lost. Command authority offline. The state is cooked.', 'capital');
      this.pushMessage(war.attacker, 'STRATEGOS-9: ' + country.capital + ' has fallen. Occupation of ' + country.name + ' begins.', 'war');
    } else {
      this.emit({
        mark: 'COUNTY', color: faction.color,
        title: county.name + ' captured',
        sub: country.name + ' · ' + war.captured.length + ' counties taken'
      });
      this.pushMessage(war.attacker, 'Front command: ' + county.name + ' (' + country.name + ') secured. Advancing.', 'war');
    }
    if (war.status === 'active' && !this.selectNextTarget(war)) {
      this.finishWar(war, 'occupied');
    }
  };

  function capitalTitle(name) {
    return 'CAPITAL FALLEN · ' + name.toUpperCase();
  }

  WarSim.prototype.finishWar = function (war, outcome) {
    if (war.status !== 'active') return;
    war.status = outcome || 'ceasefire';
    war.endedGame = this.gameTime;
    this.countries[war.defender].status = outcome === 'occupied' ? 'occupied' : 'ceasefire';
    this.pushMessage('system', 'Front closed: ' + war.attackerLabel + ' → ' + META[war.defender].name +
      ' · outcome ' + war.status + '.', 'system');
    this.emit({
      mark: 'FRONT', color: '#22c55e',
      title: 'Front closed · ' + META[war.defender].name,
      sub: 'Outcome: ' + war.status
    });
  };

  WarSim.prototype.ceasefire = function (warId) {
    var war = this.wars.filter(function (item) { return item.id === warId; })[0];
    if (!war || war.status !== 'active') return { ok: false };
    if (war.capture) {
      var county = this.countyMap[war.capture.countyId];
      if (county) { county.capture = null; county.control = 100; }
    }
    war.capture = null;
    this.revision++;
    this.finishWar(war, 'ceasefire');
    return { ok: true };
  };

  WarSim.prototype.update = function (now) {
    var delta = Math.max(0, Math.min(1.5, (now - this.lastReal) / 1000));
    this.lastReal = now;
    this.gameTime += delta * this.speed;
    this.updateUnits(now);
    this.updateWars();
    this.updateOffers(now);
    this.maybeGenerateOffer();
    this.pruneUnits(now);
  };

  WarSim.prototype.updateUnits = function (now) {
    for (var i = 0; i < this.units.length; i++) {
      var unit = this.units[i];
      var t = unit.mode === 'game'
        ? (this.gameTime - unit.startAt) / (unit.endAt - unit.startAt)
        : (now - unit.startAt) / (unit.endAt - unit.startAt);
      unit.progress = clamp(t, 0, 1);
      unit.lat = unit.start[0] + (unit.end[0] - unit.start[0]) * unit.progress +
        Math.sin(unit.progress * Math.PI) * 0.08;
      unit.lon = unit.start[1] + (unit.end[1] - unit.start[1]) * unit.progress;
    }
  };

  WarSim.prototype.pruneUnits = function (now) {
    var self = this;
    this.units = this.units.filter(function (unit) {
      var done = unit.mode === 'game' ? self.gameTime > unit.endAt + 2.5 * 3600 : now > unit.endAt + 1400;
      return !done;
    });
  };

  WarSim.prototype.updateWars = function () {
    var self = this;
    this.wars.forEach(function (war) {
      if (war.status !== 'active') return;
      if (!war.capture) {
        var next = self.selectNextTarget(war);
        if (!next) { self.finishWar(war, 'occupied'); return; }
        self.startNextCapture(war);
        if (!war.capture) return;
      }
      var capture = war.capture;
      var county = self.countyMap[capture.countyId];
      if (!county) return;
      if (capture.phase === 'move' && self.gameTime >= capture.moveEnd) {
        capture.phase = 'capture';
        capture.captureStart = self.gameTime;
        capture.captureEnd = self.gameTime + self.captureDuration(war);
      }
      if (capture.phase === 'capture') {
        capture.progress = clamp((self.gameTime - capture.captureStart) /
          (capture.captureEnd - capture.captureStart), 0, 1);
        county.control = Math.round(capture.progress * 100);
        county.capture = { by: war.attackerSide, progress: capture.progress };
        self.revision++;
        if (capture.progress >= 1) self.completeCapture(war, county);
      }
      if (!war.offerSent && war.captured.length >= 2 && war.attackerSide === 'balkan') {
        war.offerSent = true;
        self.createCeasefireOffer(war);
      }
    });
  };

  WarSim.prototype.createCeasefireOffer = function (war) {
    var defender = META[war.defender];
    if (!defender) return;
    var offer = {
      id: 'offer-' + (++this.offerSeq),
      kind: 'ceasefire',
      fromId: war.defender,
      leader: defender.leader.name,
      faction: defender.faction,
      warId: war.id,
      counties: [],
      status: 'open',
      timerHours: null,
      acceptAt: null,
      createdGame: this.gameTime,
      text: defender.leader.name + ' requests an immediate ceasefire. The front would freeze where it stands.'
    };
    this.offers.unshift(offer);
    this.pushMessage(war.defender, defender.leader.name + ': casualties are unacceptable. We request a ceasefire. Set a response timer.', 'offer');
    this.emit({
      mark: 'AI OFFER', color: '#a855f7',
      title: defender.leader.name + ' requests a ceasefire',
      sub: defender.name + ' · front freezes where it stands'
    });
  };

  WarSim.prototype.maybeGenerateOffer = function () {
    if (!this.wars.length) {
      this.nextOfferAt = this.gameTime + 24 * 3600;
      return;
    }
    if (this.gameTime < this.nextOfferAt) return;
    var active = this.offers.filter(function (offer) { return offer.status === 'open' || offer.status === 'timer'; });
    if (active.length >= 2) { this.nextOfferAt = this.gameTime + 24 * 3600; return; }
    var self = this;
    var candidates = ['france', 'netherlands', 'turkey', 'ukraine', 'united-kingdom', 'russia'];
    var fromId = pick(candidates);
    var faction = META[fromId].faction;
    var capital = META[fromId].center;
    var targets = this.countyList.filter(function (county) {
      if (META[county.country].faction !== 'balkan') return false;
      if (county.capital || county.controller !== county.country) return false;
      if (self.offers.some(function (offer) {
        return (offer.status === 'open' || offer.status === 'timer') && offer.counties.indexOf(county.id) >= 0;
      })) return false;
      return true;
    }).sort(function (a, b) {
      return haversine(capital, a.center) - haversine(capital, b.center);
    });
    if (!targets.length) { this.nextOfferAt = this.gameTime + 48 * 3600; return; }
    var chosen = [];
    var seenCountries = {};
    for (var i = 0; i < targets.length && chosen.length < 2; i++) {
      if (seenCountries[targets[i].country]) continue;
      seenCountries[targets[i].country] = true;
      chosen.push(targets[i]);
    }
    var fromCountry = META[fromId];
    var names = chosen.map(function (county) { return county.name; }).join(' and ');
    var offer = {
      id: 'offer-' + (++this.offerSeq),
      kind: 'land',
      fromId: fromId,
      leader: fromCountry.leader.name,
      faction: faction,
      counties: chosen.map(function (county) { return county.id; }),
      status: 'open',
      timerHours: null,
      acceptAt: null,
      createdGame: this.gameTime,
      text: fromCountry.leader.name + ' proposes a border correction: ' + names +
        ' will be transferred to ' + fromCountry.name + '. Set the acceptance timer or refuse.'
    };
    this.offers.unshift(offer);
    this.pushMessage(fromId, offer.text, 'offer');
    this.emit({
      mark: 'AI OFFER', color: FACTIONS[faction].color,
      title: fromCountry.leader.name + ' wants ' + names,
      sub: 'Treaty request · set the acceptance timer in the War Room'
    });
    this.nextOfferAt = this.gameTime + rand(48, 96) * 3600;
  };

  WarSim.prototype.setOfferTimer = function (offerId, hours) {
    var offer = this.offers.filter(function (item) { return item.id === offerId; })[0];
    if (!offer || (offer.status !== 'open' && offer.status !== 'timer')) return { ok: false };
    var parsed = Math.max(0.1, Math.min(168, Number(hours) || 4));
    offer.timerHours = parsed;
    offer.acceptAt = Date.now() + parsed * 3600 * 1000;
    offer.status = 'timer';
    this.pushMessage('system', 'Treaty response timer set to ' + parsed + ' h (real time) for ' + offer.leader + '.', 'system');
    this.emit({
      mark: 'TIMER', color: '#3b82f6',
      title: 'Acceptance timer armed · ' + parsed + ' h',
      sub: offer.leader + ' · auto-signs after ' + parsed + ' real hours'
    });
    return { ok: true, offer: offer };
  };

  WarSim.prototype.acceptOffer = function (offerId, auto) {
    var offer = this.offers.filter(function (item) { return item.id === offerId; })[0];
    if (!offer || offer.status === 'accepted' || offer.status === 'refused') return { ok: false };
    offer.status = 'accepted';
    var self = this;
    if (offer.kind === 'ceasefire') {
      var war = this.wars.filter(function (item) { return item.id === offer.warId; })[0];
      if (war && war.status === 'active') this.ceasefire(war.id);
    } else {
      offer.counties.forEach(function (countyId) {
        var county = self.countyMap[countyId];
        if (!county) return;
        county.owner = offer.fromId;
        county.controller = offer.fromId;
        county.control = 100;
        county.capture = null;
      });
      this.revision++;
    }
    offer.acceptedGame = this.gameTime;
    var label = offer.kind === 'ceasefire' ? 'Ceasefire signed' : 'Treaty signed · border corrected';
    this.pushMessage(offer.fromId, offer.leader + ': The treaty is signed. ' + (auto ? 'The timer expired.' : 'A wise decision.'), 'leader');
    this.emit({
      mark: auto ? 'AUTO-SIGN' : 'TREATY',
      color: offer.kind === 'ceasefire' ? '#22c55e' : FACTIONS[offer.faction].color,
      title: label,
      sub: offer.kind === 'ceasefire' ? 'Front frozen · ' + META[offer.fromId].name : offer.counties.length + ' counties transferred to ' + META[offer.fromId].name
    });
    return { ok: true };
  };

  WarSim.prototype.declineOffer = function (offerId) {
    var offer = this.offers.filter(function (item) { return item.id === offerId; })[0];
    if (!offer || offer.status === 'accepted' || offer.status === 'refused') return { ok: false };
    offer.status = 'refused';
    this.nextOfferAt = this.gameTime + 72 * 3600;
    this.pushMessage(offer.fromId, offer.leader + ': Refusal noted. The Kingdom will remember this. ', 'leader');
    this.emit({
      mark: 'REFUSED', color: '#ef4444',
      title: 'Treaty refused',
      sub: offer.leader + ' · relations cooling'
    });
    return { ok: true };
  };

  WarSim.prototype.updateOffers = function (now) {
    var self = this;
    this.offers.forEach(function (offer) {
      if (offer.status === 'timer' && offer.acceptAt && now >= offer.acceptAt) {
        self.acceptOffer(offer.id, true);
      }
    });
  };

  WarSim.prototype.pushMessage = function (fromId, text, kind) {
    var country = META[fromId];
    var bloc = FACTIONS[fromId];
    var faction = country ? FACTIONS[country.faction] : (bloc || FACTIONS.neutral);
    this.messages.unshift({
      id: 'msg-' + (++this.seq),
      fromId: fromId,
      leader: country ? country.leader.name : (bloc ? bloc.leader : 'COMMAND NET'),
      faction: country ? country.faction : (bloc ? bloc.id : 'system'),
      color: country || bloc ? faction.color : '#64748b',
      text: text,
      kind: kind || 'system',
      at: Date.now()
    });
    if (this.messages.length > 24) this.messages.length = 24;
  };

  WarSim.prototype.emit = function (event) {
    this.events.push({
      id: 'ev-' + (++this.seq),
      mark: event.mark,
      color: event.color,
      title: event.title,
      sub: event.sub,
      focus: event.focus || null
    });
    if (this.events.length > 16) this.events.shift();
  };

  WarSim.prototype.drainEvents = function () {
    var events = this.events.slice();
    this.events = [];
    return events;
  };

  WarSim.prototype.getState = function () {
    var activeWars = this.wars.filter(function (war) { return war.status === 'active'; });
    var occupied = 0;
    var unionHeld = 0;
    var counts = {};
    this.countyList.forEach(function (county) {
      if (county.controller !== county.owner) occupied++;
      counts[county.controller] = (counts[county.controller] || 0) + 1;
      if (META[county.owner] && META[county.owner].faction === 'balkan' && county.controller === county.owner) unionHeld++;
    });
    return {
      gameTime: this.gameTime,
      speed: this.speed,
      countries: this.countries,
      counties: this.countyList,
      wars: this.wars,
      activeWars: activeWars,
      units: this.units,
      offers: this.offers,
      messages: this.messages,
      revision: this.revision,
      stats: {
        fronts: activeWars.length,
        occupied: occupied,
        unionHeld: unionHeld,
        countyTotal: this.countyList.length
      }
    };
  };

  window.BU.WarSim = WarSim;
})();
