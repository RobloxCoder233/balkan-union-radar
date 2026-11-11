(function () {
  'use strict';

  var snapshot = null;
  var countryNames = {};
  var pollTimer = null;

  function byId(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function timeLabel(value) {
    var date = new Date(Number(value) || Date.now());
    try {
      return date.toLocaleString('en-GB', {
        hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'
      });
    } catch (err) {
      return date.toISOString().slice(11, 16);
    }
  }

  function toast(mark, title, sub, color) {
    var host = byId('toasts');
    if (!host) return;
    var node = document.createElement('div');
    node.className = 'toast';
    node.style.setProperty('--c', color || '#2dd4bf');
    node.innerHTML = '<span class="toast-mark">' + esc(mark) + '</span>' +
      '<div class="toast-body"><div class="toast-title">' + esc(title) + '</div>' +
      (sub ? '<div class="toast-sub">' + esc(sub) + '</div>' : '') + '</div>';
    host.appendChild(node);
    while (host.children.length > 3) host.removeChild(host.firstElementChild);
    window.setTimeout(function () {
      node.classList.add('is-out');
      window.setTimeout(function () { node.remove(); }, 260);
    }, 4400);
  }

  function setLink(state) {
    var link = byId('opsLink');
    var text = byId('opsLinkText');
    if (!link || !text) return;
    if (state === 'live') {
      link.dataset.state = 'live';
      text.textContent = 'UPLINK LIVE';
    } else if (state === 'offline') {
      link.dataset.state = 'offline';
      text.textContent = 'NO SESSION';
    } else {
      link.dataset.state = 'error';
      text.textContent = 'UPLINK LOST';
    }
  }

  function request(action, body) {
    return fetch('/api/panel/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (response) {
      if (response.status === 401) {
        window.location.href = '/login?next=%2Fcontrol';
        throw new Error('session expired');
      }
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || 'request failed');
        return data;
      });
    });
  }

  function refresh() {
    fetch('/api/panel/state', { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (response.status === 401) {
          window.location.href = '/login?next=%2Fcontrol';
          throw new Error('session expired');
        }
        if (!response.ok) throw new Error('state unavailable');
        return response.json();
      })
      .then(function (data) {
        snapshot = data;
        setLink('live');
        render();
      })
      .catch(function (err) {
        if (err && err.message === 'session expired') return;
        setLink('error');
      });
  }

  function populateCountries() {
    var list = window.BU_WORLD && Array.isArray(window.BU_WORLD.countries) ? window.BU_WORLD.countries : [];
    list.forEach(function (country) { countryNames[country.id] = country.name; });
    var ordered = list.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var options = ordered.map(function (country) {
      return '<option value="' + esc(country.id) + '">' + esc(country.name) + '</option>';
    }).join('');
    var allianceSelect = byId('opsAllianceCountry');
    var deliverySelect = byId('opsDeliveryDestination');
    if (allianceSelect) allianceSelect.innerHTML = options;
    if (deliverySelect) deliverySelect.innerHTML = options;
    if (deliverySelect && countryNames.balkan) deliverySelect.value = 'balkan';
  }

  function chipClass(status) {
    return ['planned', 'confirmed', 'done', 'cancelled', 'allied', 'neutral', 'hostile',
      'transit', 'delivered', 'lost'].indexOf(status) >= 0 ? status : 'planned';
  }

  function meetingHtml(meeting) {
    var meta = [meeting.when, meeting.attendees].filter(Boolean).join(' · ');
    var actions = [];
    if (meeting.status === 'planned') {
      actions.push('<button class="mini-btn" type="button" data-meeting-status="confirmed" data-id="' +
        esc(meeting.id) + '">Confirm</button>');
    }
    if (meeting.status !== 'done' && meeting.status !== 'cancelled') {
      actions.push('<button class="mini-btn is-accept" type="button" data-meeting-status="done" data-id="' +
        esc(meeting.id) + '">Done</button>');
      actions.push('<button class="mini-btn is-danger" type="button" data-meeting-status="cancelled" data-id="' +
        esc(meeting.id) + '">Cancel</button>');
    }
    return '<div class="ops-item">' +
      '<div class="ops-item-head"><strong>' + esc(meeting.title) + '</strong>' +
      '<span class="ops-chip is-' + chipClass(meeting.status) + '">' + esc(meeting.status) + '</span></div>' +
      (meta ? '<p>' + esc(meta) + '</p>' : '') +
      (meeting.agenda ? '<p>' + esc(meeting.agenda) + '</p>' : '') +
      (actions.length ? '<div class="ops-item-actions">' + actions.join('') + '</div>' : '') +
      '</div>';
  }

  function allianceHtml(row) {
    return '<div class="ops-item">' +
      '<div class="ops-item-head"><strong>' + esc(countryNames[row.countryId] || row.countryId) + '</strong>' +
      '<span class="ops-chip is-' + chipClass(row.status) + '">' + esc(row.status) + '</span></div>' +
      '<p>Since ' + esc(timeLabel(row.since)) + '</p></div>';
  }

  function deliveryHtml(delivery) {
    var actions = [];
    if (delivery.status === 'planned') {
      actions.push('<button class="mini-btn" type="button" data-delivery-status="transit" data-id="' +
        esc(delivery.id) + '">In transit</button>');
    }
    if (delivery.status === 'planned' || delivery.status === 'transit') {
      actions.push('<button class="mini-btn is-accept" type="button" data-delivery-status="delivered" data-id="' +
        esc(delivery.id) + '">Delivered</button>');
      actions.push('<button class="mini-btn is-danger" type="button" data-delivery-status="lost" data-id="' +
        esc(delivery.id) + '">Lost</button>');
    }
    return '<div class="ops-item">' +
      '<div class="ops-item-head"><strong>' + esc(String(delivery.qty) + ' ' + delivery.cargo + ' → ' +
        (countryNames[delivery.destination] || delivery.destination)) + '</strong>' +
      '<span class="ops-chip is-' + chipClass(delivery.status) + '">' + esc(delivery.status) + '</span></div>' +
      '<p>ETA ' + esc(delivery.etaHours) + 'H · filed ' + esc(timeLabel(delivery.createdAt)) + '</p>' +
      (actions.length ? '<div class="ops-item-actions">' + actions.join('') + '</div>' : '') +
      '</div>';
  }

  function render() {
    if (!snapshot) return;
    var radar = snapshot.radar || {};
    var meetings = Array.isArray(snapshot.meetings) ? snapshot.meetings : [];
    var alliances = Array.isArray(snapshot.alliances) ? snapshot.alliances : [];
    var deliveries = Array.isArray(snapshot.deliveries) ? snapshot.deliveries : [];

    var condition = byId('opsCondition');
    if (condition) {
      condition.textContent = (radar.condition || 'GREEN') + ' · ' + (radar.silenced ? 'SIREN SILENCED' : 'SIREN ARMED');
      condition.style.color = radar.condition === 'RED' ? '#fca5a5' :
        radar.condition === 'AMBER' ? '#fcd34d' : '#86efac';
    }

    var conditionButtons = document.querySelectorAll('[data-condition]');
    for (var c = 0; c < conditionButtons.length; c++) {
      var active = conditionButtons[c].getAttribute('data-condition') === radar.condition;
      conditionButtons[c].classList.toggle('is-active', active);
      conditionButtons[c].setAttribute('aria-pressed', String(active));
    }

    var silence = byId('opsSilenceBtn');
    if (silence) {
      var silenced = !!radar.silenced;
      silence.setAttribute('aria-pressed', String(silenced));
      silence.textContent = silenced ? 'RESTORE SIREN' : 'SILENCE SIREN';
    }

    var meetingMeta = byId('opsMeetingMeta');
    if (meetingMeta) {
      var planned = meetings.filter(function (meeting) {
        return meeting.status === 'planned' || meeting.status === 'confirmed';
      }).length;
      meetingMeta.textContent = planned + ' open';
    }

    var allianceMeta = byId('opsAllianceMeta');
    if (allianceMeta) allianceMeta.textContent = alliances.length + ' set';

    var deliveryMeta = byId('opsDeliveryMeta');
    if (deliveryMeta) {
      var active = deliveries.filter(function (delivery) {
        return delivery.status === 'planned' || delivery.status === 'transit';
      }).length;
      deliveryMeta.textContent = active + ' active';
    }

    var meetingsHost = byId('opsMeetings');
    if (meetingsHost) {
      meetingsHost.innerHTML = meetings.length ? meetings.slice(0, 7).map(meetingHtml).join('') :
        '<div class="ops-empty">No meetings scheduled</div>';
    }

    var alliancesHost = byId('opsAlliances');
    if (alliancesHost) {
      alliancesHost.innerHTML = alliances.length ? alliances.slice().reverse().slice(0, 8).map(allianceHtml).join('') :
        '<div class="ops-empty">No alliance entries yet</div>';
    }

    var deliveriesHost = byId('opsDeliveries');
    if (deliveriesHost) {
      deliveriesHost.innerHTML = deliveries.length ? deliveries.slice(0, 7).map(deliveryHtml).join('') :
        '<div class="ops-empty">No convoys dispatched</div>';
    }
  }

  function handleAction(promise, successMark, successTitle) {
    return promise.then(function (data) {
      toast(successMark, successTitle, 'Published to the radar network.', '#2dd4bf');
      return data;
    }).then(refresh).catch(function (err) {
      if (err && err.message === 'session expired') return;
      toast('DENIED', 'Uplink rejected', err.message || 'Try again.', '#ef4444');
      setLink('error');
    });
  }

  function order(type, payload, title, mark) {
    return request('order', { type: type, payload: payload }).then(function (data) {
      toast(mark || 'ORDER', title, 'Broadcast to every radar station.', '#2dd4bf');
      return data;
    }).then(refresh).catch(function (err) {
      if (err && err.message === 'session expired') return;
      toast('DENIED', 'Order rejected', err.message || 'Try again.', '#ef4444');
    });
  }

  function bind() {
    var conditionButtons = document.querySelectorAll('[data-condition]');
    for (var i = 0; i < conditionButtons.length; i++) {
      conditionButtons[i].addEventListener('click', function () {
        var value = this.getAttribute('data-condition');
        order('condition', { condition: value }, 'Condition set to ' + value, 'COND');
      });
    }

    var drillButtons = document.querySelectorAll('[data-drill]');
    for (var j = 0; j < drillButtons.length; j++) {
      drillButtons[j].addEventListener('click', function () {
        var scope = this.getAttribute('data-drill');
        order('drill', { scope: scope }, (scope === 'naval' ? 'Naval' : 'Air') + ' drill launched', 'DRILL');
      });
    }

    var silence = byId('opsSilenceBtn');
    if (silence) {
      silence.addEventListener('click', function () {
        var next = !(snapshot && snapshot.radar && snapshot.radar.silenced);
        order('silence', { silenced: next }, next ? 'Siren silenced' : 'Siren restored', 'SIREN');
      });
    }

    var reload = byId('opsReloadBtn');
    if (reload) {
      reload.addEventListener('click', function () {
        refresh();
        toast('SYNC', 'Panel state reloaded', 'Reading the mission store.', '#3b82f6');
      });
    }

    var logout = byId('opsLogoutBtn');
    if (logout) {
      logout.addEventListener('click', function () {
        fetch('/api/logout', { method: 'POST', headers: { Accept: 'application/json' } })
          .then(function () { window.location.replace('/login'); })
          .catch(function () { window.location.replace('/login'); });
      });
    }

    var broadcast = byId('opsBroadcastForm');
    if (broadcast) {
      broadcast.addEventListener('submit', function (event) {
        event.preventDefault();
        var input = byId('opsMessage');
        var message = input ? input.value.trim() : '';
        if (!message) return;
        order('message', { text: message }, 'Ticker message broadcast', 'MSG').then(function () {
          if (input) input.value = '';
        });
      });
    }

    var meetingForm = byId('opsMeetingForm');
    if (meetingForm) {
      meetingForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var data = new FormData(meetingForm);
        var title = String(data.get('title') || '').trim();
        if (!title) return;
        handleAction(request('meeting', {
          title: title,
          when: String(data.get('when') || '').trim(),
          attendees: String(data.get('attendees') || '').trim(),
          agenda: String(data.get('agenda') || '').trim()
        }), 'COUNCIL', 'Meeting scheduled').then(function () {
          meetingForm.reset();
        });
      });
    }

    var allianceForm = byId('opsAllianceForm');
    if (allianceForm) {
      allianceForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var data = new FormData(allianceForm);
        var countryId = String(data.get('countryId') || '');
        if (!countryId) return;
        handleAction(request('alliance', {
          countryId: countryId,
          status: String(data.get('status') || 'neutral')
        }), 'PACT', 'Alliance stance updated');
      });
    }

    var deliveryForm = byId('opsDeliveryForm');
    if (deliveryForm) {
      deliveryForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var data = new FormData(deliveryForm);
        var destination = String(data.get('destination') || '');
        if (!destination) return;
        handleAction(request('delivery', {
          destination: destination,
          cargo: String(data.get('cargo') || 'supplies'),
          qty: Number(data.get('qty') || 1),
          etaHours: Number(data.get('etaHours') || 12)
        }), 'CONVOY', 'Convoy dispatched');
      });
    }

    document.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-meeting-status]') : null;
      if (target) {
        handleAction(request('meeting-status', {
          id: target.getAttribute('data-id'),
          status: target.getAttribute('data-meeting-status')
        }), 'COUNCIL', 'Meeting status updated');
        return;
      }
      var deliveryTarget = event.target.closest ? event.target.closest('[data-delivery-status]') : null;
      if (deliveryTarget) {
        handleAction(request('delivery-status', {
          id: deliveryTarget.getAttribute('data-id'),
          status: deliveryTarget.getAttribute('data-delivery-status')
        }), 'CONVOY', 'Convoy status updated');
      }
    });
  }

  function init() {
    if (!byId('panel-ops')) return;
    populateCountries();
    bind();
    refresh();
    pollTimer = window.setInterval(refresh, 8000);
    if (location.hash === '#ops') {
      var tab = byId('tab-ops');
      if (tab) tab.click();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
