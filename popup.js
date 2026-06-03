// popup.js — Two-tab UI: drag-reorder (handle-only), pin, copy, notes

let state     = {};
let urlOrder  = [];
let refreshTimer = null;

// ─── Init ────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadOrder();
  await loadState();
  bindUI();
  bindTabs();
  refreshTimer = setInterval(loadState, 3000);
  showExtId();
  showStorageUsed();
});

window.addEventListener('unload', () => clearInterval(refreshTimer));

// ─── Order storage ───────────────────────────────────────────────────────────────

async function loadOrder() {
  return new Promise(resolve => {
    chrome.storage.local.get('urlOrder', d => { urlOrder = d.urlOrder || []; resolve(); });
  });
}
async function saveOrder() {
  return new Promise(resolve => chrome.storage.local.set({ urlOrder }, resolve));
}

function getOrderedUrls() {
  const keys = Object.keys(state);
  for (const k of keys) if (!urlOrder.includes(k)) urlOrder.push(k);
  urlOrder = urlOrder.filter(k => keys.includes(k));
  const pinned   = urlOrder.filter(k => state[k]?.pinned);
  const unpinned = urlOrder.filter(k => !state[k]?.pinned);
  return [...pinned, ...unpinned];
}

// ─── Load state ──────────────────────────────────────────────────────────────────

async function loadState() {
  try {
    const resp = await sendMsg({ type: 'GET_STATE' });
    state = resp.trackedUrls || {};
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    renderAll();
  } catch(e) { console.error(e); }
}

// ─── Tabs ────────────────────────────────────────────────────────────────────────

function bindTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      const id = 'panel' + btn.dataset.tab[0].toUpperCase() + btn.dataset.tab.slice(1);
      document.getElementById(id)?.classList.remove('hidden');
    });
  });
}

// ─── Render ──────────────────────────────────────────────────────────────────────

function renderAll() {
  const list       = document.getElementById('urlList');
  const empty      = document.getElementById('emptyState');
  const summaryBar = document.getElementById('summaryBar');
  const totalEl    = document.getElementById('totalMonth');
  const activeEl   = document.getElementById('activeCount');
  const secLabel   = document.getElementById('sectionLabel');

  const ordered = getOrderedUrls();

  if (ordered.length === 0) {
    empty.style.display = 'block';
    summaryBar.style.display = 'none';
    secLabel.style.display = 'none';
    list.innerHTML = '';
    list.appendChild(empty);
    activeEl.textContent = '0 active';
    return;
  }

  empty.style.display = 'none';
  summaryBar.style.display = 'flex';
  secLabel.style.display   = 'block';

  let totalMonth = 0, activeCount = 0;
  for (const d of Object.values(state)) {
    totalMonth += d.monthSeconds || 0;
    if (d.isLive) activeCount++;
  }
  totalEl.textContent    = formatTime(totalMonth);
  activeEl.textContent   = activeCount + ' active';

  // Build new list, reuse existing card elements when possible
  const newList = document.createDocumentFragment();
  newList.appendChild(empty);

  for (const nUrl of ordered) {
    const data = state[nUrl]; if (!data) continue;
    const cardId = 'card-' + CSS.escape(btoa(unescape(encodeURIComponent(nUrl))).slice(0, 20));
    let card = document.getElementById(cardId);
    const settingsOpen = card?.querySelector('.card-settings')?.classList.contains('open');
    if (!card) {
      card = document.createElement('div');
      card.className = 'url-card';
      card.id = cardId;
    }
    card.dataset.nurl = nUrl;
    card.innerHTML = cardHTML(nUrl, data);
    if (settingsOpen) card.querySelector('.card-settings')?.classList.add('open');
    bindCardEvents(card, nUrl);
    setupDrag(card, nUrl);
    newList.appendChild(card);
  }

  list.innerHTML = '';
  list.appendChild(newList);
}

// ─── Card HTML ───────────────────────────────────────────────────────────────────

function cardHTML(nUrl, data) {
  const url    = data.originalUrl || nUrl;
  const disp   = url.length > 56 ? url.slice(0, 53) + '…' : url;
  const note   = (data.note || '').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const pinned = !!data.pinned;

  const badge = data.isLive
    ? `<span class="badge badge-live">● LIVE</span>`
    : `<span class="badge badge-closed">CLOSED</span>`;

  const monthS = data.monthSeconds || 0;
  const limitS = data.limitSeconds;
  let prog = '';
  if (limitS) {
    const pct = Math.min(100, Math.round((monthS / limitS) * 100));
    const rem = Math.max(0, limitS - monthS);
    const fc  = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : '';
    prog = `<div class="progress-wrap">
      <div class="progress-header">
        <span class="progress-label">Month: ${formatTime(monthS)} / ${formatTime(limitS)}</span>
        <span class="progress-pct">${pct}%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill ${fc}" style="width:${pct}%"></div></div>
      ${pct >= 80 ? `<div class="progress-remaining ${pct>=100?'danger':''}">
        ${pct >= 100 ? '🚫 Limit reached' : `⚠ ${formatTime(rem)} remaining`}
      </div>` : ''}
    </div>`;
  } else {
    prog = `<div class="progress-wrap"><div class="progress-header">
      <span class="progress-label">Month: ${formatTime(monthS)} / ∞</span>
    </div></div>`;
  }

  const notifyHrs   = data.notifyBeforeSeconds ? (data.notifyBeforeSeconds/3600).toFixed(1) : '2.0';
  const limitHrsCur = limitS ? Math.floor(limitS/3600)      : '';
  const limitMinCur = limitS ? Math.floor((limitS%3600)/60) : '';
  const rawNote     = (data.note||'').replace(/</g,'&lt;').replace(/"/g,'&quot;');

  return `
    <div class="card-top">
      <div class="drag-handle" data-draghandle title="Drag to reorder">⠿</div>
      <div class="card-url-block">
        ${data.note ? `<span class="card-note">${data.note.replace(/</g,'&lt;')}</span>` : ''}
        <span class="card-url" title="${url}">${disp}</span>
      </div>
      <div class="card-badges">
        ${pinned ? `<span class="badge badge-pinned">📌</span>` : ''}
        ${badge}
      </div>
    </div>
    ${prog}
    <div class="stats-grid">
      <div class="stat-cell"><span class="stat-label">Today</span><span class="stat-val">${formatTime(data.todaySeconds||0)}</span></div>
      <div class="stat-cell"><span class="stat-label">Week</span><span class="stat-val">${formatTime(data.weekSeconds||0)}</span></div>
      <div class="stat-cell"><span class="stat-label">Month</span><span class="stat-val">${formatTime(data.monthSeconds||0)}</span></div>
      <div class="stat-cell"><span class="stat-label">All-time</span><span class="stat-val">${formatTime(data.allTimeSeconds||0)}</span></div>
    </div>
    <div class="card-footer">
      <button class="fc-btn btn-pin"  data-action="pin">${pinned ? '📌 Pinned' : '📍 Pin'}</button>
      <button class="fc-btn btn-copy" data-action="copyUrl">⎘ Copy</button>
      <button class="fc-btn btn-cfg"  data-action="settings">⚙ Settings</button>
      <button class="fc-btn btn-del"  data-action="remove">✕</button>
    </div>
    <div class="card-settings" data-settings>
      <div class="settings-row">
        <span class="settings-label">Name / Note:</span>
        <input class="settings-input settings-input-wide" data-field="note" type="text" maxlength="120" value="${rawNote}" placeholder="e.g. My Codespace session A">
      </div>
      <div class="settings-row">
        <span class="settings-label">Monthly limit:</span>
        <input class="settings-input" data-field="limitHrs"  type="number" min="0" step="0.5" value="${limitHrsCur}" placeholder="hrs">
        <span class="label-small">h</span>
        <input class="settings-input" data-field="limitMins" type="number" min="0" max="59" value="${limitMinCur}" placeholder="m">
        <span class="label-small">m</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Notify before:</span>
        <input class="settings-input" data-field="notifyHrs" type="number" min="0" step="0.5" value="${notifyHrs}" placeholder="2">
        <span class="label-small">hrs</span>
      </div>
      <div class="settings-row">
        <label class="check-wrap">
          <input type="checkbox" data-field="autoClose" ${data.autoClose?'checked':''}>
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
        <button class="btn-reset btn-reset-all" data-action="resetAll">ALL</button>
      </div>
    </div>`;
}

// ─── Card events ─────────────────────────────────────────────────────────────────

function bindCardEvents(card, nUrl) {
  card.querySelector('[data-action="pin"]')?.addEventListener('click', async () => {
    const cur = !!state[nUrl]?.pinned;
    await sendMsg({
      type: 'UPDATE_URL_SETTINGS', normalizedUrl: nUrl,
      limitSeconds:        state[nUrl]?.limitSeconds        ?? null,
      notifyBeforeSeconds: state[nUrl]?.notifyBeforeSeconds ?? 7200,
      autoClose:           state[nUrl]?.autoClose           ?? false,
      note:                state[nUrl]?.note                ?? '',
      pinned:              !cur
    });
    showToast(!cur ? '📌 Pinned to top' : 'Unpinned');
    await loadState();
  });

  card.querySelector('[data-action="copyUrl"]')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(state[nUrl]?.originalUrl || nUrl);
    showToast('URL copied!');
  });

  card.querySelector('[data-action="remove"]')?.addEventListener('click', async () => {
    if (!confirm('Remove tracking for this URL?')) return;
    await sendMsg({ type: 'REMOVE_URL', normalizedUrl: nUrl });
    urlOrder = urlOrder.filter(u => u !== nUrl);
    await saveOrder();
    await loadState();
  });

  card.querySelector('[data-action="settings"]')?.addEventListener('click', e => {
    card.querySelector('[data-settings]')?.classList.toggle('open');
    e.stopPropagation();
  });

  card.querySelector('[data-action="saveSettings"]')?.addEventListener('click', async () => {
    const lh = parseFloat(card.querySelector('[data-field="limitHrs"]')?.value)  || 0;
    const lm = parseFloat(card.querySelector('[data-field="limitMins"]')?.value) || 0;
    const nh = parseFloat(card.querySelector('[data-field="notifyHrs"]')?.value) || 2;
    const ac = card.querySelector('[data-field="autoClose"]')?.checked || false;
    const nt = card.querySelector('[data-field="note"]')?.value || '';
    await sendMsg({
      type: 'UPDATE_URL_SETTINGS', normalizedUrl: nUrl,
      limitSeconds:        (lh>0||lm>0) ? Math.round(lh*3600+lm*60) : null,
      notifyBeforeSeconds: Math.round(nh*3600),
      autoClose: ac, note: nt,
      pinned: state[nUrl]?.pinned || false
    });
    showToast('Settings saved');
    await loadState();
  });

  const resetMap = { resetToday:'today', resetWeek:'week', resetMonth:'month', resetAllTime:'alltime', resetAll:'all' };
  for (const [action, scope] of Object.entries(resetMap)) {
    card.querySelector(`[data-action="${action}"]`)?.addEventListener('click', async () => {
      if (!confirm(`Reset ${scope==='all'?'ALL stats':scope+' stats'}? Cannot be undone.`)) return;
      await sendMsg({ type: 'RESET_STATS', normalizedUrl: nUrl, scope });
      showToast(scope==='all' ? 'All stats reset' : scope+' reset');
      await loadState();
    });
  }
}

// ─── Drag & Drop (pointer-events based, works on Linux Chrome) ──────────────────
// We only allow drag when mousedown is on the handle, by toggling card.draggable.

function setupDrag(card, nUrl) {
  const handle = card.querySelector('[data-draghandle]');
  if (!handle) return;

  let dragging = false;
  let overUrl  = null;

  // Only enable draggable when pressing the handle
  handle.addEventListener('mousedown', () => { card.draggable = true; });
  document.addEventListener('mouseup', () => { card.draggable = false; }, { passive: true });

  card.addEventListener('dragstart', e => {
    if (!card.draggable) { e.preventDefault(); return; }
    dragging = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', nUrl);
    // Defer class add so Chrome renders the ghost first
    setTimeout(() => card.classList.add('dragging'), 0);
  });

  card.addEventListener('dragend', () => {
    dragging = false;
    card.draggable = false;
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  card.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const src = e.dataTransfer.getData('text/plain') || null;
    if (nUrl !== src) {
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      card.classList.add('drag-over');
      overUrl = nUrl;
    }
  });

  card.addEventListener('dragleave', e => {
    // Only remove if leaving to outside the card
    if (!card.contains(e.relatedTarget)) {
      card.classList.remove('drag-over');
    }
  });

  card.addEventListener('drop', async e => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const srcUrl = e.dataTransfer.getData('text/plain');
    if (!srcUrl || srcUrl === nUrl) return;

    const from = urlOrder.indexOf(srcUrl);
    const to   = urlOrder.indexOf(nUrl);
    if (from === -1 || to === -1) return;

    urlOrder.splice(from, 1);
    urlOrder.splice(to, 0, srcUrl);
    await saveOrder();
    renderAll();
    showToast('Order saved');
  });
}

// ─── Add URL / UI ────────────────────────────────────────────────────────────────

function bindUI() {
  document.getElementById('currentTabBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.url.startsWith('http')) { showToast('No valid URL on current tab'); return; }
    document.getElementById('urlInput').value = tab.url;
    document.getElementById('urlInput').focus();
    document.getElementById('errorText').classList.remove('show');
  });

  document.getElementById('addBtn').addEventListener('click', handleAdd);
  document.getElementById('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
  document.getElementById('urlInput').addEventListener('input', () => document.getElementById('errorText').classList.remove('show'));

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const { json } = await sendMsg({ type: 'EXPORT' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
      download: `url-tracker-${new Date().toISOString().slice(0,10)}.json`
    });
    a.click(); showToast('Exported!');
  });

  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      await sendMsg({ type: 'IMPORT', json: await file.text() });
      await loadOrder(); showToast('Imported!'); await loadState();
    } catch { showToast('Import failed'); }
    e.target.value = '';
  });
}

async function handleAdd() {
  const input  = document.getElementById('urlInput');
  const errTxt = document.getElementById('errorText');
  const raw    = input.value.trim();
  if (!raw || !raw.startsWith('http')) { errTxt.classList.add('show'); return; }

  const lh = parseFloat(document.getElementById('limitHours').value)  || 0;
  const lm = parseFloat(document.getElementById('limitMins').value)   || 0;
  const nh = parseFloat(document.getElementById('notifyHours').value) || 2;
  const ac = document.getElementById('autoCloseCheck').checked;

  const resp = await sendMsg({
    type: 'ADD_URL', originalUrl: raw,
    limitSeconds:        (lh>0||lm>0) ? Math.round(lh*3600+lm*60) : null,
    notifyBeforeSeconds: Math.round(nh*3600), autoClose: ac
  });
  if (resp.error) { errTxt.textContent = resp.error; errTxt.classList.add('show'); return; }

  input.value = '';
  ['limitHours','limitMins'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('notifyHours').value = '2';
  document.getElementById('autoCloseCheck').checked = false;
  errTxt.classList.remove('show');

  if (resp.normalizedUrl && !urlOrder.includes(resp.normalizedUrl)) {
    urlOrder.push(resp.normalizedUrl); await saveOrder();
  }
  showToast('URL added!');
  await loadState();
  document.getElementById('tabTracker').click();
}

// ─── Storage info ────────────────────────────────────────────────────────────────

function showExtId() {
  const id = chrome.runtime.id;
  document.getElementById('extId').textContent = id;
  document.querySelectorAll('.ext-id-dyn').forEach(el => el.textContent = id);
}

async function showStorageUsed() {
  chrome.storage.local.getBytesInUse(null, bytes => {
    const el = document.getElementById('storageUsed');
    if (el) el.textContent = (bytes/1024).toFixed(2) + ' KB of ~5 MB (local)';
  });
}

// ─── Toast / sendMsg ─────────────────────────────────────────────────────────────

function showToast(msg, ms=2000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(resp);
    });
  });
}
