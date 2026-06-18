var origin = window.location.origin;
document.getElementById('openai-url').textContent = origin + '/v1';

// ======Settings=========
var AUTH_STORAGE_KEY = 'wta-auth-token';
// ======Settings=========

var dashboardAuthRequired = false;

function getAuthToken() {
  return localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

function setAuthToken(token) {
  var trimmed = (token || '').trim();
  if (trimmed) localStorage.setItem(AUTH_STORAGE_KEY, trimmed);
  else localStorage.removeItem(AUTH_STORAGE_KEY);
}

function initAuthFromUrl() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('token');
  if (!token) return;
  setAuthToken(token);
  params.delete('token');
  var qs = params.toString();
  history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
}

function apiHeaders(base) {
  var headers = base ? Object.assign({}, base) : {};
  var token = getAuthToken();
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = 'Bearer ' + token;
  }
  return headers;
}

function apiFetch(url, options) {
  options = options || {};
  options.headers = apiHeaders(options.headers);
  return fetch(url, options);
}

async function loadDashboardConfig() {
  try {
    var res = await apiFetch('/dashboard/config.json');
    if (!res.ok) return;
    var cfg = await res.json();
    dashboardAuthRequired = Boolean(cfg.authRequired);
    updateAuthUi();
  } catch (e) {
    /* ignore */
  }
}

function updateAuthUi() {
  var block = document.getElementById('api-auth-block');
  var divider = document.getElementById('api-auth-divider');
  if (!block) return;
  var visible = dashboardAuthRequired || Boolean(getAuthToken());
  block.classList.toggle('hidden', !visible);
  if (divider) divider.classList.toggle('hidden', !visible);
}

async function saveApiAuthToken() {
  var input = document.getElementById('api-auth-token');
  setAuthToken(input.value);
  showToast('API token saved');
  updateAuthUi();
  loadSettings();
  loadProviders();
  loadHealth();
}

var providerOrigins = {
  'deepseek-web': 'https://chat.deepseek.com',
  'qwen-web': 'https://chat.qwen.ai',
  'kimi-web': 'https://www.kimi.com',
};

var DUAL_IMPORT_RULES = {
  'deepseek-web': {
    label: 'DeepSeek',
    validateCookies: validateDeepSeekCookies,
    validateState: validateDeepSeekState,
    cookiesError: 'Cookies file must be a Cookie-Editor JSON array with ds_session_id or ds_chat_token',
    stateError: 'State file must include localStorage.userToken or localStorage.settingsJwt',
    dualNote: 'DeepSeek needs both files. Cookie-Editor alone is not enough — you also need localStorage JWT from the console export.',
  },
  'qwen-web': {
    label: 'Qwen',
    validateCookies: validateQwenCookies,
    validateState: validateQwenState,
    cookiesError: 'Cookies file must be a Cookie-Editor JSON array exported from chat.qwen.ai (non-empty)',
    stateError: 'State file must include localStorage.token or localStorage.user_info',
    dualNote: 'Qwen needs both files. Cookie-Editor for session cookies + Console export for localStorage.token.',
  },
};

function buildConsoleExportScript(downloadName) {
  return `(() => {
  const run = async () => {
    const localStorageData = Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, i) => {
        const k = localStorage.key(i);
        return [k, localStorage.getItem(k)];
      })
    );
    const sessionStorageData = Object.fromEntries(
      Array.from({ length: sessionStorage.length }, (_, i) => {
        const k = sessionStorage.key(i);
        return [k, sessionStorage.getItem(k)];
      })
    );

    let cookies = document.cookie;
    if (window.cookieStore && typeof window.cookieStore.getAll === 'function') {
      try {
        const all = await cookieStore.getAll();
        if (all.length > 0) {
          cookies = all.map((c) => ({
            name: c.name,
            value: c.value,
            domain: location.hostname,
            path: c.path || '/',
            secure: Boolean(c.secure),
            sameSite: c.sameSite || 'Lax',
          }));
        }
      } catch (err) {
        console.warn('cookieStore.getAll failed, using document.cookie only', err);
      }
    }

    const data = {
      url: location.href,
      origin: location.origin,
      localStorage: localStorageData,
      sessionStorage: sessionStorageData,
      cookies: cookies,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ${JSON.stringify(downloadName)};
    a.click();
    URL.revokeObjectURL(a.href);
    console.log('Exported', ${JSON.stringify(downloadName)}, Object.keys(localStorageData).length, 'localStorage keys');
  };
  run();
})();`;
}

var exportScriptNames = {
  'deepseek-web': 'deepseek-state.json',
  'qwen-web': 'qwen-state.json',
};

var modelsByProvider = {};

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
document.getElementById('btn-save-telegram').addEventListener('click', saveTelegramSettings);
document.getElementById('btn-verify-telegram-token').addEventListener('click', verifyTelegramToken);
document.getElementById('btn-discover-chat-id').addEventListener('click', discoverTelegramChatId);
document.getElementById('telegram-chat-pick').addEventListener('change', onTelegramChatPick);
document.getElementById('telegram-proxy-server').addEventListener('input', updateTelegramControls);
document.getElementById('telegram-proxy-user').addEventListener('input', updateTelegramControls);
document.getElementById('telegram-proxy-pass').addEventListener('input', updateTelegramControls);
document.getElementById('telegram-bot-token').addEventListener('input', function () {
  telegramTokenVerified = false;
  updateTelegramControls();
  document.getElementById('telegram-verify-status').textContent = '';
});

// ======Settings=========
var LOGS_POLL_MS = 5000;
// ======Settings=========

var logsPollTimer = null;
var telegramTokenVerified = false;
document.getElementById('btn-import-state').addEventListener('click', importSelectedStateFile);
document.getElementById('state-provider').addEventListener('change', updateImportForm);
document.getElementById('btn-copy-export-script').addEventListener('click', copyExportScript);
document.getElementById('btn-toggle-script').addEventListener('click', toggleExportScript);
document.getElementById('btn-save-auto-order').addEventListener('click', saveAutoOrder);
document.getElementById('btn-reset-auto-order').addEventListener('click', resetAutoOrder);
document.getElementById('btn-save-api-auth').addEventListener('click', saveApiAuthToken);
document.getElementById('btn-restart-service').addEventListener('click', restartService);
document.getElementById('btn-load-logs').addEventListener('click', loadServiceLogs);

// Tab switching
document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var tab = btn.getAttribute('data-tab');
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'tab-' + tab);
    });
    if (tab === 'logs') {
      loadServiceLogs();
      startLogsPoll();
    } else {
      stopLogsPoll();
    }
  });
});

function formatUptime(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
}

async function loadModels() {
  try {
    var res = await apiFetch('/v1/models');
    var data = await res.json();
    var grouped = {};
    (data.data || []).forEach(function (m) {
      if (!m.id || m.id === 'auto') return;
      var slash = m.id.indexOf('/');
      if (slash < 0) return;
      var providerId = m.id.slice(0, slash);
      var modelId = m.id.slice(slash + 1);
      if (!grouped[providerId]) grouped[providerId] = [];
      grouped[providerId].push(modelId);
    });
    Object.keys(grouped).forEach(function (providerId) {
      grouped[providerId].sort();
    });
    modelsByProvider = grouped;
  } catch (e) {
    /* keep previous cache */
  }
}

function buildModelSelect(providerId, authenticated) {
  var wrap = document.createElement('div');
  wrap.className = 'provider-models';

  var select = document.createElement('select');
  select.className = 'model-select';
  select.disabled = !authenticated;

  var models = modelsByProvider[providerId] || [];
  if (!authenticated) {
    var opt = document.createElement('option');
    opt.textContent = 'Login to load models';
    select.appendChild(opt);
  } else if (models.length === 0) {
    var emptyOpt = document.createElement('option');
    emptyOpt.textContent = 'No models available';
    select.appendChild(emptyOpt);
  } else {
    models.forEach(function (modelId) {
      var option = document.createElement('option');
      option.value = modelId;
      option.textContent = modelId;
      select.appendChild(option);
    });
  }

  var copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn-copy-model';
  copyBtn.textContent = 'Copy ID';
  copyBtn.disabled = !authenticated || models.length === 0;
  copyBtn.addEventListener('click', function () {
    if (!select.value) return;
    navigator.clipboard.writeText(providerId + '/' + select.value).then(function () {
      showToast('Model ID copied');
    });
  });

  wrap.appendChild(select);
  wrap.appendChild(copyBtn);
  return wrap;
}

// Load providers list
async function loadProviders() {
  await loadModels();
  try {
    var res = await apiFetch('/admin/providers');
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
      var card = document.createElement('div');
      card.className = 'provider-card' + (p.authenticated ? ' active' : '');

      var head = document.createElement('div');
      head.className = 'provider-head';

      var dot = document.createElement('div');
      dot.className = 'status-indicator ' + (p.authenticated ? 'active' : 'inactive');
      head.appendChild(dot);

      var info = document.createElement('div');
      info.className = 'provider-info';

      var nameEl = document.createElement('span');
      nameEl.className = 'provider-name';
      nameEl.textContent = p.name;
      info.appendChild(nameEl);

      var idEl = document.createElement('span');
      idEl.className = 'provider-id';
      idEl.textContent = p.id;
      info.appendChild(idEl);

      head.appendChild(info);

      var meta = document.createElement('div');
      meta.className = 'provider-meta';

      if (p.authenticated) {
        var badge = document.createElement('span');
        badge.className = 'model-badge';
        var modelCount = (modelsByProvider[p.id] || []).length || p.modelCount;
        badge.textContent = modelCount + ' models';
        meta.appendChild(badge);
      } else {
        var btn = document.createElement('button');
        btn.className = 'btn-login';
        btn.textContent = 'Login';
        btn.addEventListener('click', function () {
          loginProvider(p.id);
        });
        meta.appendChild(btn);
      }

      head.appendChild(meta);
      card.appendChild(head);
      card.appendChild(buildModelSelect(p.id, p.authenticated));
      list.appendChild(card);
    });

    var metricProviders = document.getElementById('metric-providers');
    if (metricProviders) {
      metricProviders.textContent = authCount + ' / ' + data.providers.length;
    }
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
    var res = await apiFetch('/admin/providers/check-all', { method: 'POST' });
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
    var res = await apiFetch('/admin/providers/test-all', { method: 'POST' });
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
  box.textContent = 'Re-importing sessions from ~/.web-to-api/imports/...';
  try {
    var res = await apiFetch('/admin/auth/refresh-all', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    box.textContent = '';

    if (data.status === 'no_files') {
      var info = document.createElement('div');
      info.className = 'check-row warn';
      info.textContent = data.message;
      box.appendChild(info);
      var hint = document.createElement('div');
      hint.className = 'check-row muted';
      hint.textContent = 'If you logged in via Chrome profile only — sessions are already active, import files are optional.';
      box.appendChild(hint);
      showToast('No import files found');
      return;
    }

    var title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = 'Re-imported from ' + (data.importsDir || 'imports');
    box.appendChild(title);

    (data.results || []).forEach(function (r) {
      var row = document.createElement('div');
      var cls = 'check-row ';
      if (r.status === 'imported') cls += 'ok';
      else if (r.status === 'error') cls += 'bad';
      else cls += 'warn';
      row.className = cls;
      if (r.status === 'imported') {
        row.textContent = r.providerId + ': OK — ' + (r.file || 'imported');
      } else {
        row.textContent = r.providerId + ': ' + (r.error || r.message || r.status);
      }
      box.appendChild(row);
    });

    var imported = (data.results || []).filter(function (r) { return r.status === 'imported'; }).length;
    showToast(imported > 0 ? 'Re-imported ' + imported + ' provider(s)' : 'Nothing imported');
    loadProviders();
    loadHealth();
  } catch (err) {
    box.textContent = 'Re-import failed: ' + err.message;
    showToast('Re-import failed');
  }
}

async function loadSettings() {
  var box = document.getElementById('settings-result');
  try {
    var res = await apiFetch('/admin/settings');
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    document.getElementById('auto-order-input').value = (data.autoModelOrder || []).join('\n');
    applyTelegramForm(data.telegram || {});
    var tgStatus = data.telegram && data.telegram.configured ? 'Telegram: configured' : 'Telegram: not configured';
    box.textContent = 'Settings loaded. ' + tgStatus + '. Service: ' + data.serviceName;
  } catch (err) {
    box.textContent = 'Failed to load settings: ' + err.message;
  }
}

function applyTelegramForm(telegram) {
  var chatId = document.getElementById('telegram-chat-id');
  var token = document.getElementById('telegram-bot-token');
  var envHint = document.getElementById('telegram-env-hint');
  var tokenHint = document.getElementById('telegram-token-hint');
  var verifyStatus = document.getElementById('telegram-verify-status');
  var proxyServer = document.getElementById('telegram-proxy-server');
  var proxyUser = document.getElementById('telegram-proxy-user');
  var proxyPass = document.getElementById('telegram-proxy-pass');

  chatId.value = telegram.chatId || '';
  token.value = '';
  telegramTokenVerified = false;

  if (telegram.proxy) {
    proxyServer.value = telegram.proxy.server || '';
    proxyUser.value = telegram.proxy.username || '';
    proxyPass.value = '';
    proxyPass.placeholder = telegram.proxy.passwordMasked
      ? 'saved: ' + telegram.proxy.passwordMasked
      : 'password';
  } else {
    proxyServer.value = '';
    proxyUser.value = '';
    proxyPass.value = '';
    proxyPass.placeholder = 'password';
  }

  var locked = telegram.envLocked || {};
  chatId.disabled = Boolean(locked.chatId);
  token.disabled = Boolean(locked.botToken);
  proxyServer.disabled = Boolean(locked.proxy);
  proxyUser.disabled = Boolean(locked.proxy);
  proxyPass.disabled = Boolean(locked.proxy);

  if (locked.botToken || locked.chatId || locked.proxy) {
    envHint.textContent = 'some fields locked by WTA_TELEGRAM_* env vars';
  } else {
    envHint.textContent = '1 · Proxy → 2 · Verify token → 3 · Get Chat ID';
  }

  if (telegram.botTokenMasked) {
    tokenHint.textContent = 'saved: ' + telegram.botTokenMasked + ' — leave empty to keep';
    token.placeholder = telegram.botTokenMasked;
  } else {
    tokenHint.textContent = 'paste token from @BotFather';
    token.placeholder = '123456:ABC...';
  }

  verifyStatus.textContent = '';
  updateTelegramControls();
}

function isTelegramProxyReady() {
  var server = document.getElementById('telegram-proxy-server').value.trim();
  var user = document.getElementById('telegram-proxy-user').value.trim();
  var pass = document.getElementById('telegram-proxy-pass').value.trim();
  var passEl = document.getElementById('telegram-proxy-pass');
  var hasSavedPass = (passEl.placeholder || '').indexOf('saved:') >= 0;
  var any = Boolean(server || user || pass);
  if (!any) return true;
  if (!server) return false;
  if (user && !pass && !hasSavedPass) return false;
  return true;
}

function updateTelegramControls() {
  var proxyStatus = document.getElementById('telegram-proxy-status');
  var verifyBtn = document.getElementById('btn-verify-telegram-token');
  var discoverBtn = document.getElementById('btn-discover-chat-id');
  var verifyStatus = document.getElementById('telegram-verify-status');

  var server = document.getElementById('telegram-proxy-server').value.trim();
  var user = document.getElementById('telegram-proxy-user').value.trim();
  var pass = document.getElementById('telegram-proxy-pass').value.trim();
  var anyProxy = Boolean(server || user || pass);

  var proxyReady = isTelegramProxyReady();
  verifyBtn.disabled = !proxyReady;

  if (anyProxy && !proxyReady) {
    proxyStatus.textContent = 'Fill proxy server (and password if username set)';
    discoverBtn.disabled = true;
    telegramTokenVerified = false;
    if (verifyStatus.textContent.indexOf('OK —') === 0) {
      verifyStatus.textContent = '';
    }
    return;
  }

  if (anyProxy && proxyReady) {
    proxyStatus.textContent = 'Proxy configured — now verify token';
  } else {
    proxyStatus.textContent = 'No proxy — direct to api.telegram.org';
  }

  discoverBtn.disabled = !telegramTokenVerified || !proxyReady;
}

function getTelegramTokenPayload() {
  var tokenVal = document.getElementById('telegram-bot-token').value.trim();
  var payload = {
    proxyServer: document.getElementById('telegram-proxy-server').value.trim(),
    proxyUser: document.getElementById('telegram-proxy-user').value.trim(),
    proxyPass: document.getElementById('telegram-proxy-pass').value,
  };
  if (tokenVal) payload.botToken = tokenVal;
  return payload;
}

async function verifyTelegramToken() {
  if (!isTelegramProxyReady()) {
    showToast('Complete proxy settings first');
    return;
  }
  var status = document.getElementById('telegram-verify-status');
  var discoverBtn = document.getElementById('btn-discover-chat-id');
  status.textContent = 'Checking token…';
  discoverBtn.disabled = true;
  telegramTokenVerified = false;
  try {
    var res = await apiFetch('/admin/telegram/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getTelegramTokenPayload()),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    telegramTokenVerified = true;
    updateTelegramControls();
    var name = data.bot && data.bot.username ? '@' + data.bot.username : 'bot #' + data.bot.id;
    status.textContent = 'OK — ' + name + ' via ' + (data.proxyLabel || 'api.telegram.org');
    showToast('Token verified');
  } catch (err) {
    status.textContent = 'Verify failed: ' + err.message;
    showToast('Verify failed');
  }
}

async function discoverTelegramChatId() {
  if (!isTelegramProxyReady()) {
    showToast('Complete proxy settings first');
    return;
  }
  if (!telegramTokenVerified) {
    showToast('Verify token first');
    return;
  }
  var box = document.getElementById('settings-result');
  var pick = document.getElementById('telegram-chat-pick');
  box.textContent = 'Fetching chat IDs…';
  try {
    var res = await apiFetch('/admin/telegram/discover-chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getTelegramTokenPayload()),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);

    pick.textContent = '';
    pick.classList.add('hidden');

    if (!data.chats || data.chats.length === 0) {
      box.textContent = data.message || 'No chats found. Message your bot first.';
      showToast('No chats yet');
      return;
    }

    if (data.chats.length === 1) {
      document.getElementById('telegram-chat-id').value = data.chats[0].id;
      box.textContent = 'Chat ID set: ' + data.chats[0].title + ' (' + data.chats[0].id + ')';
      showToast('Chat ID found');
      return;
    }

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select chat (' + data.chats.length + ')';
    pick.appendChild(placeholder);
    data.chats.forEach(function (chat) {
      var opt = document.createElement('option');
      opt.value = chat.id;
      opt.textContent = chat.title + ' · ' + chat.type + ' · ' + chat.id;
      pick.appendChild(opt);
    });
    pick.classList.remove('hidden');
    box.textContent = 'Multiple chats found — pick one from the list.';
    showToast('Pick chat ID');
  } catch (err) {
    box.textContent = 'Get ID failed: ' + err.message;
    showToast('Get ID failed');
  }
}

function onTelegramChatPick() {
  var pick = document.getElementById('telegram-chat-pick');
  if (!pick.value) return;
  document.getElementById('telegram-chat-id').value = pick.value;
  showToast('Chat ID selected');
}

async function saveTelegramSettings() {
  var box = document.getElementById('settings-result');
  box.textContent = 'Saving Telegram settings...';
  try {
    var payload = {
      chatId: document.getElementById('telegram-chat-id').value.trim(),
      proxyServer: document.getElementById('telegram-proxy-server').value.trim(),
      proxyUser: document.getElementById('telegram-proxy-user').value.trim(),
      proxyPass: document.getElementById('telegram-proxy-pass').value,
    };
    var tokenVal = document.getElementById('telegram-bot-token').value.trim();
    if (tokenVal) payload.botToken = tokenVal;

    var res = await apiFetch('/admin/settings/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    applyTelegramForm(data.telegram || {});
    box.textContent = data.message || 'Telegram settings saved.';
    showToast('Telegram saved');
  } catch (err) {
    box.textContent = 'Telegram save failed: ' + err.message;
    showToast('Telegram save failed');
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
    var res = await apiFetch('/admin/settings/auto-order', {
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
    var res = await apiFetch('/admin/settings/auto-order/reset', { method: 'POST' });
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
    var res = await apiFetch('/admin/service/restart', { method: 'POST' });
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

async function loadServiceLogs(silent) {
  var box = document.getElementById('service-logs');
  if (!silent) box.textContent = 'Loading logs...';
  try {
    var res = await apiFetch('/admin/service/logs?lines=200');
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    var header = data.source && data.source !== 'none'
      ? '# ' + data.source + '\n\n'
      : '';
    box.textContent = header + (data.logs || '(empty)');
    scrollLogBoxToBottom(box);
  } catch (err) {
    box.textContent = 'Log load failed: ' + err.message;
    if (!silent) showToast('Log load failed');
  }
}

function scrollLogBoxToBottom(box) {
  requestAnimationFrame(function () {
    box.scrollTop = box.scrollHeight;
  });
}

function startLogsPoll() {
  stopLogsPoll();
  logsPollTimer = setInterval(function () {
    var panel = document.getElementById('tab-logs');
    if (panel && panel.classList.contains('active')) {
      loadServiceLogs(true);
    }
  }, LOGS_POLL_MS);
}

function stopLogsPoll() {
  if (logsPollTimer) {
    clearInterval(logsPollTimer);
    logsPollTimer = null;
  }
}

async function testTelegramAlert() {
  var box = document.getElementById('ops-result');
  box.textContent = 'Sending Telegram test...';
  try {
    var res = await apiFetch('/admin/notify/test', { method: 'POST' });
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
  var box = document.getElementById('import-result');

  try {
    if (DUAL_IMPORT_RULES[providerId]) {
      await importDualProvider(box, providerId);
    } else {
      await importSingleFile(box, providerId);
    }
    showToast('Import completed for ' + providerId);
    loadProviders();
    loadHealth();
  } catch (err) {
    box.textContent = 'Import failed: ' + err.message;
    showToast('Import failed');
  }
}

async function importDualProvider(box, providerId) {
  var rules = DUAL_IMPORT_RULES[providerId];
  if (!rules) throw new Error('Unknown dual-import provider');

  var cookiesInput = document.getElementById('state-cookies-file');
  var stateInput = document.getElementById('state-local-file');
  if (!cookiesInput.files?.length || !stateInput.files?.length) {
    throw new Error(rules.label + ' requires both files: Cookie-Editor cookies JSON and Console state JSON');
  }

  var cookiesFile = cookiesInput.files[0];
  var stateFile = stateInput.files[0];
  var cookiesParsed = JSON.parse(await cookiesFile.text());
  var stateParsed = JSON.parse(await stateFile.text());

  if (!rules.validateCookies(cookiesParsed)) {
    throw new Error(rules.cookiesError);
  }
  if (!rules.validateState(stateParsed)) {
    throw new Error(rules.stateError);
  }

  box.textContent = 'Importing cookies from ' + cookiesFile.name + '...';
  await postImportState(providerId, normalizeStateFile(cookiesParsed, providerId), {
    raw: cookiesParsed,
    persistKind: 'cookies',
  });

  box.textContent = 'Importing state from ' + stateFile.name + '...';
  var result = await postImportState(providerId, normalizeStateFile(stateParsed, providerId), {
    raw: stateParsed,
    persistKind: 'state',
  });
  box.textContent = JSON.stringify(result, null, 2);
}

async function importSingleFile(box, providerId) {
  var input = document.getElementById('state-file');
  if (!input.files || input.files.length === 0) {
    throw new Error('Select a JSON file first');
  }

  var file = input.files[0];
  box.textContent = 'Reading ' + file.name + '...';
  var parsed = JSON.parse(await file.text());
  var state = normalizeStateFile(parsed, providerId);
  var result = await postImportState(providerId, state, {
    raw: parsed,
    persistKind: 'single',
  });
  box.textContent = JSON.stringify(result, null, 2);
}

async function postImportState(providerId, state, options) {
  var res = await apiFetch('/admin/auth/import-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: providerId,
      state: state,
      raw: options && options.raw !== undefined ? options.raw : state,
      persistKind: options && options.persistKind ? options.persistKind : undefined,
    }),
  });
  var data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

function validateDeepSeekCookies(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  return parsed.some(function (c) {
    return c && (c.name === 'ds_session_id' || c.name === 'ds_chat_token');
  });
}

function validateDeepSeekState(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  var ls = parsed.localStorage || {};
  return Boolean(ls.userToken || ls.settingsJwt);
}

function validateQwenCookies(parsed) {
  return Array.isArray(parsed) && parsed.length > 0;
}

function validateQwenState(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  var ls = parsed.localStorage || {};
  return Boolean(ls.token || ls.user_info);
}

function updateImportForm() {
  var providerId = document.getElementById('state-provider').value;
  var dualRules = DUAL_IMPORT_RULES[providerId];
  var dual = Boolean(dualRules);
  document.getElementById('import-single').classList.toggle('hidden', dual);
  document.getElementById('import-dual').classList.toggle('hidden', !dual);
  if (dualRules) {
    document.getElementById('import-dual-note').textContent = dualRules.dualNote;
  }

  var scriptBox = document.getElementById('export-script-box');
  var scriptName = exportScriptNames[providerId];
  if (scriptName) {
    scriptBox.classList.remove('hidden');
    document.getElementById('export-script').textContent = buildConsoleExportScript(scriptName);
    var body = document.getElementById('export-script-body');
    var toggleBtn = document.getElementById('btn-toggle-script');
    body.classList.add('collapsed');
    if (toggleBtn) toggleBtn.textContent = 'Show';
  } else {
    scriptBox.classList.add('hidden');
  }

  var hints = {
    'deepseek-web': 'Upload Cookie-Editor cookies + Console state (two files).',
    'kimi-web': 'Cookie-Editor JSON array with kimi-auth.',
    'qwen-web': 'Upload Cookie-Editor cookies + Console state (two files).',
  };
  document.getElementById('import-result').textContent = hints[providerId] || 'Select provider and upload session JSON.';
}

function copyExportScript() {
  var text = document.getElementById('export-script').textContent;
  navigator.clipboard.writeText(text).then(function () {
    showToast('Export script copied');
  });
}

function toggleExportScript() {
  var body = document.getElementById('export-script-body');
  var btn = document.getElementById('btn-toggle-script');
  var collapsed = body.classList.toggle('collapsed');
  btn.textContent = collapsed ? 'Show' : 'Hide';
}

updateImportForm();

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
    var res = await apiFetch('/admin/auth/login', {
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
      var statusRes = await apiFetch('/admin/auth/login-status');
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
      var res = await apiFetch('/admin/providers');
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
    var res = await apiFetch('/admin/health');
    var data = await res.json();
    var el = document.getElementById('health-info');

    var seconds = data.uptime || 0;
    var uptime = formatUptime(seconds);
    var browserStatus = data.browser ? data.browser.status : 'unknown';
    var isHealthy = data.status === 'healthy';

    var uptimeEl = document.getElementById('metric-uptime');
    var browserEl = document.getElementById('metric-browser');
    if (uptimeEl) uptimeEl.textContent = uptime;
    if (browserEl) browserEl.textContent = browserStatus;

    var statusEl = document.getElementById('server-status');
    if (statusEl) {
      statusEl.innerHTML =
        '<span class="pulse ' + (isHealthy ? 'green' : '') + '"></span>' +
        '<span>' + (isHealthy ? 'Online' : (data.status || 'Unknown')) + '</span>';
      statusEl.style.color = isHealthy ? '' : 'var(--yellow)';
      statusEl.style.borderColor = isHealthy ? '' : 'rgba(230, 180, 80, 0.35)';
      statusEl.style.background = isHealthy ? '' : 'rgba(230, 180, 80, 0.08)';
    }

    el.textContent = '';

    var items = [
      {
        label: 'Status',
        value: data.status || 'unknown',
        cls: isHealthy ? 'green' : '',
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

    var statusEl = document.getElementById('server-status');
    if (statusEl) {
      statusEl.innerHTML = '<span class="pulse"></span><span>Offline</span>';
      statusEl.style.color = 'var(--red)';
    }
  }
}

// Initial load + auto-refresh every 10s
initAuthFromUrl();
loadDashboardConfig().then(function () {
  loadSettings();
  loadProviders();
  loadHealth();
});
setInterval(function () {
  loadProviders();
  loadHealth();
}, 10000);
