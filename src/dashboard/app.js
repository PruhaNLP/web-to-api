var origin = window.location.origin;
document.getElementById('openai-url').textContent = origin + '/v1';

var providerOrigins = {
  'deepseek-web': 'https://chat.deepseek.com',
  'qwen-web': 'https://chat.qwen.ai',
  'kimi-web': 'https://www.kimi.com',
};

// Toast notification
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () {
    t.classList.remove('show');
  }, 2000);
}

// Copy URL — uses data-target attribute instead of inline onclick
function copyText(targetId) {
  var text = document.getElementById(targetId).textContent;
  navigator.clipboard.writeText(text).then(function () {
    showToast('Copied to clipboard!');
  });
}

// Bind copy buttons via data-target (no inline handlers)
document.querySelectorAll('.btn-copy[data-target]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    copyText(btn.getAttribute('data-target'));
  });
});

document.getElementById('btn-check-all').addEventListener('click', checkAllProviders);
document.getElementById('btn-test-all').addEventListener('click', testAllProviders);
document.getElementById('btn-refresh-all').addEventListener('click', refreshAllCookies);
document.getElementById('btn-telegram-test').addEventListener('click', testTelegramAlert);
document.getElementById('btn-import-state').addEventListener('click', importSelectedStateFile);
document.getElementById('btn-save-auto-order').addEventListener('click', saveAutoOrder);
document.getElementById('btn-reset-auto-order').addEventListener('click', resetAutoOrder);
document.getElementById('btn-restart-service').addEventListener('click', restartService);
document.getElementById('btn-load-logs').addEventListener('click', loadServiceLogs);

// Load providers list
async function loadProviders() {
  try {
    var res = await fetch('/admin/providers');
    var data = await res.json();
    var list = document.getElementById('provider-list');
    var countEl = document.getElementById('provider-count');

    if (!data.providers || data.providers.length === 0) {
      list.textContent = '';
      var emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty';
      emptyDiv.textContent = 'No providers configured.';
      list.appendChild(emptyDiv);
      countEl.textContent = '0 / 0';
      return;
    }

    var authCount = data.providers.filter(function (p) {
      return p.authenticated;
    }).length;
    countEl.textContent = authCount + ' / ' + data.providers.length + ' active';

    list.textContent = '';

    data.providers.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'provider-row';

      var left = document.createElement('div');
      left.className = 'provider-left';

      var dot = document.createElement('div');
      dot.className =
        'status-indicator ' + (p.authenticated ? 'active' : 'inactive');
      left.appendChild(dot);

      var nameEl = document.createElement('span');
      nameEl.className = 'provider-name';
      nameEl.textContent = p.name;
      left.appendChild(nameEl);

      var idEl = document.createElement('span');
      idEl.className = 'provider-id';
      idEl.textContent = p.id;
      left.appendChild(idEl);

      row.appendChild(left);

      var right = document.createElement('div');
      right.className = 'provider-right';

      if (p.authenticated) {
        var badge = document.createElement('span');
        badge.className = 'model-badge';
        badge.textContent = p.modelCount + ' models';
        right.appendChild(badge);
      } else {
        var btn = document.createElement('button');
        btn.className = 'btn-login';
        btn.textContent = 'Login';
        btn.addEventListener('click', function () {
          loginProvider(p.id);
        });
        right.appendChild(btn);
      }

      row.appendChild(right);
      list.appendChild(row);
    });
  } catch (err) {
    var list = document.getElementById('provider-list');
    list.textContent = '';
    var errDiv = document.createElement('div');
    errDiv.className = 'error';
    errDiv.textContent = 'Failed to load: ' + err.message;
    list.appendChild(errDiv);
  }
}

async function checkAllProviders() {
  var box = document.getElementById('ops-result');
  box.textContent = 'Checking providers...';
  try {
    var res = await fetch('/admin/providers/check-all', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    box.textContent = '';
    var title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = 'Checked at ' + data.checkedAt;
    box.appendChild(title);
    (data.providers || []).forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'check-row ' + (p.authenticated ? 'ok' : 'bad');
      row.textContent = p.id + ': ' + p.message;
      box.appendChild(row);
    });
    showToast('Provider check complete');
    loadProviders();
    loadHealth();
  } catch (err) {
    box.textContent = 'Check failed: ' + err.message;
    showToast('Check failed');
  }
}

async function testAllProviders() {
  var box = document.getElementById('ops-result');
  box.textContent = 'Testing all providers with real requests (pong)...';
  try {
    var res = await fetch('/admin/providers/test-all', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    box.textContent = '';
    var title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = 'Tested at ' + data.testedAt;
    box.appendChild(title);
    Object.keys(data.results || {}).forEach(function (id) {
      var r = data.results[id];
      var row = document.createElement('div');
      row.className = 'check-row ' + (r.status === 'ok' ? 'ok' : 'bad');
      var latency = r.latencyMs ? ' (' + r.latencyMs + 'ms)' : '';
      row.textContent = id + ': ' + (r.status === 'ok' ? 'OK' : 'FAIL') + latency + ' - ' + r.message;
      box.appendChild(row);
    });
    showToast('Deep test complete');
    loadProviders();
    loadHealth();
  } catch (err) {
    box.textContent = 'Test failed: ' + err.message;
    showToast('Test failed');
  }
}

async function refreshAllCookies() {
  var box = document.getElementById('ops-result');
  box.textContent = 'Refreshing all cookies from state files...';
  try {
    var res = await fetch('/admin/auth/refresh-all', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    box.textContent = '';
    var title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = 'Refresh ' + data.status;
    box.appendChild(title);
    (data.results || []).forEach(function (r) {
      var row = document.createElement('div');
      var isOk = r.status === 'imported' || r.status === 'active';
      row.className = 'check-row ' + (isOk ? 'ok' : 'bad');
      row.textContent = r.providerId + ': ' + (isOk ? 'Imported ' + (r.file || '') : r.message || r.error || 'Skipped');
      box.appendChild(row);
    });
    showToast('Cookie refresh complete');
    loadProviders();
    loadHealth();
  } catch (err) {
    box.textContent = 'Refresh failed: ' + err.message;
    showToast('Refresh failed');
  }
}

async function loadSettings() {
  var box = document.getElementById('settings-result');
  try {
    var res = await fetch('/admin/settings');
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    document.getElementById('auto-order-input').value = (data.autoModelOrder || []).join('\n');
    box.textContent = 'Settings loaded. Service: ' + data.serviceName;
  } catch (err) {
    box.textContent = 'Failed to load settings: ' + err.message;
  }
}

async function saveAutoOrder() {
  var box = document.getElementById('settings-result');
  var order = document.getElementById('auto-order-input').value
    .split('\n')
    .map(function (line) { return line.trim(); })
    .filter(Boolean);
  box.textContent = 'Saving auto order...';
  try {
    var res = await fetch('/admin/settings/auto-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: order }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    document.getElementById('auto-order-input').value = data.autoModelOrder.join('\n');
    box.textContent = 'Saved. Restart is optional; current runtime already uses this order.';
    showToast('Auto order saved');
    loadProviders();
  } catch (err) {
    box.textContent = 'Save failed: ' + err.message;
    showToast('Save failed');
  }
}

async function resetAutoOrder() {
  var box = document.getElementById('settings-result');
  box.textContent = 'Resetting auto order...';
  try {
    var res = await fetch('/admin/settings/auto-order/reset', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    document.getElementById('auto-order-input').value = data.autoModelOrder.join('\n');
    box.textContent = 'Reset to default order.';
    showToast('Auto order reset');
    loadProviders();
  } catch (err) {
    box.textContent = 'Reset failed: ' + err.message;
    showToast('Reset failed');
  }
}

async function restartService() {
  var box = document.getElementById('settings-result');
  if (!window.confirm('Restart web-to-api service now?')) return;
  box.textContent = 'Restart requested. Page may be unavailable for a few seconds...';
  try {
    var res = await fetch('/admin/service/restart', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    showToast('Service restarting');
    setTimeout(function () {
      loadHealth();
      loadProviders();
      loadSettings();
    }, 5000);
  } catch (err) {
    box.textContent = 'Restart failed: ' + err.message;
    showToast('Restart failed');
  }
}

async function loadServiceLogs() {
  var box = document.getElementById('service-logs');
  box.textContent = 'Loading logs...';
  try {
    var res = await fetch('/admin/service/logs?lines=160');
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    box.textContent = data.logs || '(empty)';
    showToast('Logs loaded');
  } catch (err) {
    box.textContent = 'Log load failed: ' + err.message;
    showToast('Log load failed');
  }
}

async function testTelegramAlert() {
  var box = document.getElementById('ops-result');
  box.textContent = 'Sending Telegram test...';
  try {
    var res = await fetch('/admin/notify/test', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    box.textContent = data.message || 'Telegram test sent.';
    showToast('Telegram test sent');
  } catch (err) {
    box.textContent = 'Telegram test failed: ' + err.message;
    showToast('Telegram test failed');
  }
}

async function importSelectedStateFile() {
  var providerId = document.getElementById('state-provider').value;
  var input = document.getElementById('state-file');
  var box = document.getElementById('import-result');
  if (!input.files || input.files.length === 0) {
    showToast('Select a JSON file first');
    return;
  }

  var file = input.files[0];
  box.textContent = 'Reading ' + file.name + '...';
  try {
    var parsed = JSON.parse(await file.text());
    var state = normalizeStateFile(parsed, providerId);
    var res = await fetch('/admin/auth/import-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: providerId, state: state }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    box.textContent = JSON.stringify(data, null, 2);
    showToast('State imported for ' + providerId);
    loadProviders();
    loadHealth();
  } catch (err) {
    box.textContent = 'Import failed: ' + err.message;
    showToast('Import failed');
  }
}

function normalizeStateFile(parsed, providerId) {
  var fallbackOrigin = providerOrigins[providerId] || 'https://chat.qwen.ai';
  if (Array.isArray(parsed)) {
    return { origin: fallbackOrigin, cookies: parsed };
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Unsupported JSON format');
  }
  if (Array.isArray(parsed.cookies) && Array.isArray(parsed.origins)) {
    return normalizePlaywrightStorageState(parsed, fallbackOrigin);
  }
  return {
    url: typeof parsed.url === 'string' ? parsed.url : undefined,
    origin: typeof parsed.origin === 'string' ? parsed.origin : fallbackOrigin,
    localStorage: normalizeRecord(parsed.localStorage),
    sessionStorage: normalizeRecord(parsed.sessionStorage),
    cookies: typeof parsed.cookies === 'string' || Array.isArray(parsed.cookies)
      ? parsed.cookies
      : undefined,
  };
}

function normalizePlaywrightStorageState(state, fallbackOrigin) {
  var origins = Array.isArray(state.origins) ? state.origins : [];
  var matched = origins.find(function (entry) {
    return entry && entry.origin === fallbackOrigin;
  }) || origins[0] || {};
  var localStorage = {};
  (matched.localStorage || []).forEach(function (entry) {
    if (entry && typeof entry.name === 'string') {
      localStorage[entry.name] = String(entry.value || '');
    }
  });
  return {
    origin: matched.origin || fallbackOrigin,
    localStorage: localStorage,
    cookies: state.cookies || [],
  };
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  var out = {};
  Object.keys(value).forEach(function (key) {
    out[key] = String(value[key] == null ? '' : value[key]);
  });
  return out;
}

// Login flow
async function loginProvider(providerId) {
  try {
    showToast('Launching Chrome for ' + providerId + '...');
    var res = await fetch('/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: providerId }),
    });
    var data = await res.json();
    if (data.status === 'login_started') {
      showToast(data.message || 'Chrome window opened. Please log in.');
      pollLoginStatus(providerId);
    } else if (data.status === 'error' || data.error) {
      showToast(data.message || data.error || 'Login failed');
    }
  } catch (err) {
    showToast('Login failed: ' + err.message);
  }
}

// Poll login status endpoint for real-time feedback
function pollLoginStatus(providerId) {
  var interval = setInterval(async function () {
    try {
      // Check login-status for detailed progress
      var statusRes = await fetch('/admin/auth/login-status');
      var statusData = await statusRes.json();
      if (statusData.status === 'waiting_for_user') {
        showToast('Waiting for you to log in at the Chrome window...');
      } else if (statusData.status === 'success') {
        clearInterval(interval);
        showToast(providerId + ' login completed!');
        loadProviders();
        loadHealth();
        return;
      } else if (statusData.status === 'failed') {
        clearInterval(interval);
        showToast('Login failed: ' + statusData.message);
        return;
      }

      // Also check provider status as backup
      var res = await fetch('/admin/providers');
      var data = await res.json();
      var provider = data.providers.find(function (p) {
        return p.id === providerId;
      });
      if (provider && provider.authenticated) {
        clearInterval(interval);
        showToast(providerId + ' authenticated!');
        loadProviders();
        loadHealth();
      }
    } catch (e) {
      /* retry */
    }
  }, 2000);
  setTimeout(function () {
    clearInterval(interval);
  }, 120000);
}

// Load system health stats
async function loadHealth() {
  try {
    var res = await fetch('/admin/health');
    var data = await res.json();
    var el = document.getElementById('health-info');

    var seconds = data.uptime || 0;
    var uptime =
      seconds < 60
        ? seconds + 's'
        : seconds < 3600
          ? Math.floor(seconds / 60) + 'm'
          : Math.floor(seconds / 3600) +
            'h ' +
            Math.floor((seconds % 3600) / 60) +
            'm';

    var browserStatus = data.browser ? data.browser.status : 'unknown';

    el.textContent = '';

    var items = [
      {
        label: 'Status',
        value: data.status || 'unknown',
        cls: data.status === 'healthy' ? 'green' : '',
      },
      { label: 'Uptime', value: uptime, cls: '' },
      {
        label: 'Browser',
        value: browserStatus,
        cls: browserStatus === 'running' ? 'green' : '',
      },
    ];

    items.forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'stat-item';

      var label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = item.label;
      div.appendChild(label);

      var val = document.createElement('span');
      val.className = 'stat-value' + (item.cls ? ' ' + item.cls : '');
      val.textContent = item.value;
      div.appendChild(val);

      el.appendChild(div);
    });
  } catch (e) {
    var el = document.getElementById('health-info');
    el.textContent = '';
    var errDiv = document.createElement('div');
    errDiv.className = 'error';
    errDiv.textContent = 'Unable to reach server';
    el.appendChild(errDiv);
  }
}

// Initial load + auto-refresh every 10s
loadSettings();
loadProviders();
loadHealth();
setInterval(function () {
  loadProviders();
  loadHealth();
}, 10000);
