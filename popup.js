// popup.js — UI controller
// Communicates with background service worker via chrome.runtime.sendMessage

let state = {}; // { [normalizedUrl]: { originalUrl, todayS, weekS, monthS, allTimeS, limitS, isLive, notifyBeforeS, autoClose } }
let refreshTimer = null;

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  bindUI();
  // Refresh every 3s for live second-level counters
  refreshTimer = setInterval(loadState, 3000);
});

window.addEventListener('unload', () => {
  clearInterval(refreshTimer);
});

// ─── Data Loading ──────────────────────────────────────────────────────────────

async function loadState() {
  try {
    const resp = await sendMsg({ type: 'GET_STATE' });
    state = resp.trackedUrls || {};
    // Don't re-render while user is typing — it kills focus
    const active = document.activeElement;
    const userTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (!userTyping) renderAll();
  } catch (e) {
    console.error('[Popup] loadState error:', e);
  }
}

// ─── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  const list = document.getElementById('urlList');
  const empty = document.getElementById('emptyState');
  const summaryBar = document.getElementById('summaryBar');
  const totalMonthEl = document.getElementById('totalMonth');
  const activeCountEl = document.getElementById('activeCount');
  const sectionLabel = document.getElementById('sectionLabel');

  const entries = Object.entries(state);

  if (entries.length === 0) {
    empty.style.display = 'block';
    summaryBar.style.display = 'none';
    sectionLabel.style.display = 'none';
    // Clear cards (keep empty state)
    Array.from(list.children).forEach(c => {
      if (c.id !== 'emptyState') c.remove();
    });
    activeCountEl.textContent = '0 active';
    return;
  }

  empty.style.display = 'none';
  summaryBar.style.display = 'flex';
  sectionLabel.style.display = 'block';

  // Calc totals
  let totalMonth = 0;
  let activeCount = 0;
  for (const [, d] of entries) {
    totalMonth += d.monthSeconds || 0;
    if (d.isLive) activeCount++;
  }

  totalMonthEl.textContent = formatTime(totalMonth);
  activeCountEl.textContent = `${activeCount} active`;

  // Render / update each card
  for (const [nUrl, data] of entries) {
    const cardId = 'card-' + btoa(nUrl).replace(/[^a-z0-9]/gi, '');
    let card = document.getElementById(cardId);
    if (!card) {
      card = buildCard(nUrl, data, cardId);
      // Insert before empty state
      list.insertBefore(card, empty);
    } else {
      updateCard(card, nUrl, data);
    }
  }

  // Remove cards for removed URLs
  Array.from(list.querySelectorAll('.url-card')).forEach(card => {
    const nUrl = card.dataset.nurl;
    if (nUrl && !state[nUrl]) card.remove();
  });
}

function buildCard(nUrl, data, cardId) {
  const div = document.createElement('div');
  div.className = 'url-card';
  div.id = cardId;
  div.dataset.nurl = nUrl;
  div.innerHTML = cardHTML(nUrl, data);
  bindCardEvents(div, nUrl);
  return div;
}

function updateCard(card, nUrl, data) {
  // Only update dynamic content to avoid full re-render (preserves settings panel state)
  const isSettingsOpen = card.querySelector('.card-settings')?.classList.contains('open');
  card.innerHTML = cardHTML(nUrl, data);
  if (isSettingsOpen) {
    card.querySelector('.card-settings')?.classList.add('open');
  }
  bindCardEvents(card, nUrl);
}

function cardHTML(nUrl, data) {
  const url = data.originalUrl || nUrl;
  const displayUrl = url.length > 58 ? url.slice(0, 55) + '…' : url;
  const note = data.note || '';

  const isLive = data.isLive;
  const badgeHtml = isLive
    ? `<span class="badge badge-live">● LIVE</span>`
    : `<span class="badge badge-closed">CLOSED</span>`;

  const monthS = data.monthSeconds || 0;
  const limitS = data.limitSeconds;
  let progressHtml = '';

  if (limitS) {
    const pct = Math.min(100, Math.round((monthS / limitS) * 100));
    const remaining = Math.max(0, limitS - monthS);
    const fillClass = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : '';
    progressHtml = `
      <div class="progress-wrap">
        <div class="progress-header">
          <span class="progress-label">Month: ${formatTime(monthS)} / ${formatTime(limitS)}</span>
          <span class="progress-pct">${pct}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill ${fillClass}" style="width:${pct}%"></div></div>
        ${pct >= 80 ? `<div class="progress-remaining ${pct >= 100 ? 'danger' : ''}">
          ${pct >= 100 ? '🚫 Limit reached' : `⚠ ${formatTime(remaining)} remaining`}
        </div>` : ''}
      </div>`;
  } else {
    progressHtml = `
      <div class="progress-wrap">
        <div class="progress-header">
          <span class="progress-label">Month: ${formatTime(monthS)} / ∞</span>
        </div>
      </div>`;
  }

  const notifyHrs = data.notifyBeforeSeconds ? (data.notifyBeforeSeconds / 3600).toFixed(1) : '2.0';
  const limitHrsCur = limitS ? Math.floor(limitS / 3600) : '';
  const limitMinsCur = limitS ? Math.floor((limitS % 3600) / 60) : '';
  const noteEsc = note.replace(/"/g, '&quot;').replace(/</g, '&lt;');

  return `
    <div class="card-top">
      <div class="card-url-block">
        ${note ? `<span class="card-note">${note.replace(/</g,'&lt;')}</span>` : ''}
        <span class="card-url" title="${url}">${displayUrl}</span>
      </div>
      <div class="card-badges">${badgeHtml}</div>
    </div>
    ${progressHtml}
    <div class="stats-grid">
      <div class="stat-cell">
        <span class="stat-label">Today</span>
        <span class="stat-val">${formatTime(data.todaySeconds || 0)}</span>
      </div>
      <div class="stat-cell">
        <span class="stat-label">Week</span>
        <span class="stat-val">${formatTime(data.weekSeconds || 0)}</span>
      </div>
      <div class="stat-cell">
        <span class="stat-label">Month</span>
        <span class="stat-val">${formatTime(data.monthSeconds || 0)}</span>
      </div>
      <div class="stat-cell">
        <span class="stat-label">All-time</span>
        <span class="stat-val">${formatTime(data.allTimeSeconds || 0)}</span>
      </div>
    </div>
    <div class="card-footer">
      <button class="btn-copy-url" data-action="copyUrl" title="Copy URL">⎘ Copy</button>
      <button class="btn-settings-card" data-action="settings">⚙ Settings</button>
      <button class="btn-icon-remove" data-action="remove">✕ Remove</button>
    </div>
    <div class="card-settings" data-settings>
      <div class="settings-row">
        <span class="settings-label">Name / Note:</span>
        <input class="settings-input settings-input-wide" data-field="note" type="text" maxlength="120" value="${noteEsc}" placeholder="e.g. My Codespace session A">
      </div>
      <div class="settings-row">
        <span class="settings-label">Monthly limit:</span>
        <input class="settings-input" data-field="limitHrs" type="number" min="0" step="0.5" value="${limitHrsCur}" placeholder="hrs">
        <span class="label-small">h</span>
        <input class="settings-input" data-field="limitMins" type="number" min="0" max="59" value="${limitMinsCur}" placeholder="m">
        <span class="label-small">m</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Notify before:</span>
        <input class="settings-input" data-field="notifyHrs" type="number" min="0" step="0.5" value="${notifyHrs}" placeholder="2">
        <span class="label-small">hrs</span>
      </div>
      <div class="settings-row">
        <label class="check-wrap">
          <input type="checkbox" data-field="autoClose" ${data.autoClose ? 'checked' : ''}>
          <span class="check-label">Auto-close tab on limit</span>
        </label>
        <button class="btn-save-settings" data-action="saveSettings">Save</button>
      </div>
      <div class="settings-divider"></div>
      <div class="settings-row reset-row">
        <span class="settings-label">Reset stats:</span>
        <button class="btn-reset" data-action="resetToday">Today</button>
        <button class="btn-reset" data-action="resetWeek">Week</button>
        <button class="btn-reset" data-action="resetMonth">Month</button>
        <button class="btn-reset" data-action="resetAllTime">All-time</button>
        <button class="btn-reset btn-reset-all" data-action="resetAll">All</button>
      </div>
    </div>
  `;
}

function bindCardEvents(card, nUrl) {
  card.querySelector('[data-action="copyUrl"]')?.addEventListener('click', async () => {
    const url = state[nUrl]?.originalUrl || nUrl;
    await navigator.clipboard.writeText(url);
    showToast('URL copied!');
  });

  card.querySelector('[data-action="remove"]')?.addEventListener('click', async () => {
    if (confirm('Remove tracking for this URL?')) {
      await sendMsg({ type: 'REMOVE_URL', normalizedUrl: nUrl });
      await loadState();
    }
  });

  card.querySelector('[data-action="settings"]')?.addEventListener('click', (e) => {
    const panel = card.querySelector('[data-settings]');
    panel?.classList.toggle('open');
    e.stopPropagation();
  });

  const resetMap = { resetToday:'today', resetWeek:'week', resetMonth:'month', resetAllTime:'alltime', resetAll:'all' };
  for (const [action, scope] of Object.entries(resetMap)) {
    card.querySelector(`[data-action="${action}"]`)?.addEventListener('click', async () => {
      const label = scope === 'all' ? 'ALL stats' : `${scope} stats`;
      if (!confirm(`Reset ${label} for this URL? Cannot be undone.`)) return;
      await sendMsg({ type: 'RESET_STATS', normalizedUrl: nUrl, scope });
      showToast(`${scope === 'all' ? 'All stats' : scope.charAt(0).toUpperCase() + scope.slice(1)} reset`);
      await loadState();
    });
  }

  card.querySelector('[data-action="saveSettings"]')?.addEventListener('click', async () => {
    const limitHrs = parseFloat(card.querySelector('[data-field="limitHrs"]')?.value) || 0;
    const limitMins = parseFloat(card.querySelector('[data-field="limitMins"]')?.value) || 0;
    const notifyHrs = parseFloat(card.querySelector('[data-field="notifyHrs"]')?.value) || 2;
    const autoClose = card.querySelector('[data-field="autoClose"]')?.checked || false;

    const limitSeconds = limitHrs > 0 || limitMins > 0
      ? Math.round((limitHrs * 3600) + (limitMins * 60))
      : null;
    const notifyBeforeSeconds = Math.round(notifyHrs * 3600);

    const note = card.querySelector('[data-field="note"]')?.value || '';

    await sendMsg({
      type: 'UPDATE_URL_SETTINGS',
      normalizedUrl: nUrl,
      limitSeconds,
      notifyBeforeSeconds,
      autoClose,
      note
    });
    showToast('Settings saved');
    await loadState();
  });
}

// ─── Add URL ──────────────────────────────────────────────────────────────────

function bindUI() {
  // Current tab button
  document.getElementById('currentTabBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
      showToast('No valid URL on current tab');
      return;
    }
    document.getElementById('urlInput').value = tab.url;
    document.getElementById('urlInput').focus();
    document.getElementById('errorText').classList.remove('show');
  });

  const addBtn = document.getElementById('addBtn');
  const urlInput = document.getElementById('urlInput');
  const errorText = document.getElementById('errorText');

  addBtn.addEventListener('click', handleAdd);
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAdd();
  });
  urlInput.addEventListener('input', () => {
    errorText.classList.remove('show');
  });

  // Export
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const resp = await sendMsg({ type: 'EXPORT' });
    const blob = new Blob([resp.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `url-tracker-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported!');
  });

  // Import
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      await sendMsg({ type: 'IMPORT', json: text });
      showToast('Imported!');
      await loadState();
    } catch {
      showToast('Import failed — invalid JSON');
    }
    e.target.value = '';
  });
}

async function handleAdd() {
  const urlInput = document.getElementById('urlInput');
  const errorText = document.getElementById('errorText');
  const raw = urlInput.value.trim();

  if (!raw || (!raw.startsWith('http://') && !raw.startsWith('https://'))) {
    errorText.classList.add('show');
    return;
  }

  const limitHrs = parseFloat(document.getElementById('limitHours').value) || 0;
  const limitMins = parseFloat(document.getElementById('limitMins').value) || 0;
  const notifyHrs = parseFloat(document.getElementById('notifyHours').value) || 2;
  const autoClose = document.getElementById('autoCloseCheck').checked;

  const limitSeconds = limitHrs > 0 || limitMins > 0
    ? Math.round((limitHrs * 3600) + (limitMins * 60))
    : null;
  const notifyBeforeSeconds = Math.round(notifyHrs * 3600);

  const resp = await sendMsg({
    type: 'ADD_URL',
    originalUrl: raw,
    limitSeconds,
    notifyBeforeSeconds,
    autoClose
  });

  if (resp.error) {
    errorText.textContent = resp.error;
    errorText.classList.add('show');
    return;
  }

  // Reset form
  urlInput.value = '';
  document.getElementById('limitHours').value = '';
  document.getElementById('limitMins').value = '';
  document.getElementById('notifyHours').value = '2';
  document.getElementById('autoCloseCheck').checked = false;
  errorText.classList.remove('show');

  showToast('URL added!');
  await loadState();
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ─── Message Helper ────────────────────────────────────────────────────────────

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(resp);
    });
  });
}
