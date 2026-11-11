(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var input = document.getElementById('commandKey');
  var button = document.getElementById('loginBtn');
  var error = document.getElementById('loginError');
  var params = new URLSearchParams(window.location.search);
  var next = params.get('next') || '/control';
  if (next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/control';

  function showError(message) {
    if (!error) return;
    error.hidden = false;
    error.textContent = message;
  }

  if (!form || !input || !button) return;

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var key = input.value;
    if (!key) {
      showError('Enter the command key.');
      input.focus();
      return;
    }
    if (error) error.hidden = true;
    button.disabled = true;
    button.textContent = 'AUTHENTICATING…';

    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key: key })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || 'Authentication failed.');
        return data;
      });
    }).then(function () {
      window.location.replace(next);
    }).catch(function (err) {
      showError(err.message || 'Authentication failed.');
      button.disabled = false;
      button.textContent = 'AUTHENTICATE';
      input.select();
    });
  });
})();
