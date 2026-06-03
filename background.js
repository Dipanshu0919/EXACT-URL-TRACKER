// background.js — Manifest V3 Service Worker
// Orchestrates tab events, alarms, and the tracking engine

// Import helpers (service worker supports importScripts)
importScripts('utils.js', 'storage.js', 'tracker.js');

// ─── Bootstrap ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[BG] Extension installed/updated');
  await initTracker();
  setupAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[BG] Browser started');
  await initTracker();
  setupAlarms();
  resetNotifications();
});

// Service worker wakeup: re-init if activeSessions is empty
// (happens when SW was suspended and woken by an event)
async function ensureInit() {
  if (Object.keys(activeSessions).length === 0) {
    await initTracker();
  }
}

// ─── Alarm Setup ─────────────────────────────────────────────────────────────

function setupAlarms() {
  // Periodic tick: flush every 1 minute
  chrome.alarms.create('tick', { periodInMinutes: 0.5 }); // flush every 30s
  // Midnight check: reset daily/weekly/monthly stats
  chrome.alarms.create('midnightCheck', { periodInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await ensureInit();
  if (alarm.name === 'tick') {
    await flushAllSessions();
  }
  if (alarm.name === 'midnightCheck') {
    await checkRollovers();
  }
});

// ─── Tab Events ───────────────────────────────────────────────────────────────

// Tab created (e.g. opened directly to a tracked URL)
chrome.tabs.onCreated.addListener(async (tab) => {
  await ensureInit();
  if (tab.url) await onTabUpdated(tab.id, tab.url);
});

// Tab URL updated (navigation)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await ensureInit();
  // Only act on committed navigations (complete or loading with url)
  if (changeInfo.url) {
    await onTabUpdated(tabId, changeInfo.url);
  }
});

// Tab closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ensureInit();
  await onTabRemoved(tabId);
});

// ─── Popup Message Handling ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true; // keep channel open for async
});

async function handleMessage(msg) {
  await ensureInit();

  switch (msg.type) {

    case 'GET_STATE': {
      const trackedUrls = await getTrackedUrls();
      const allStats = await getAllStats();
      const liveStatus = getLiveStatus();
      const liveElapsed = getLiveElapsed();
      const { dayKey, weekKey, monthKey } = getRolloverKeys();

      // Apply rollovers & merge live elapsed for display
      const enriched = {};
      for (const [nUrl, entry] of Object.entries(trackedUrls)) {
        let s = allStats[nUrl] || {};
        if (s.dayKey !== dayKey) { s.todaySeconds = 0; }
        if (s.weekKey !== weekKey) { s.weekSeconds = 0; }
        if (s.monthKey !== monthKey) { s.monthSeconds = 0; }

        const live = liveElapsed[nUrl] || 0;
        enriched[nUrl] = {
          ...entry,
          todaySeconds: (s.todaySeconds || 0) + live,
          weekSeconds: (s.weekSeconds || 0) + live,
          monthSeconds: (s.monthSeconds || 0) + live,
          allTimeSeconds: (s.allTimeSeconds || 0) + live,
          isLive: !!liveStatus[nUrl]
        };
      }
      return { trackedUrls: enriched };
    }

    case 'ADD_URL': {
      const { originalUrl, limitSeconds, notifyBeforeSeconds, autoClose } = msg;
      const n = normalizeUrl(originalUrl);
      if (!n) return { error: 'Invalid URL' };
      await addTrackedUrl(n, originalUrl, limitSeconds, notifyBeforeSeconds, autoClose);
      // Check if already open
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && normalizeUrl(tab.url) === n) {
          activeSessions[tab.id] = { normalizedUrl: n, lastTickAt: Date.now() };
        }
      }
      await saveActiveSessions(activeSessions);
      return { ok: true, normalizedUrl: n };
    }

    case 'REMOVE_URL': {
      const { normalizedUrl } = msg;
      // Flush any active sessions for this URL
      for (const [tabId, session] of Object.entries(activeSessions)) {
        if (session.normalizedUrl === normalizedUrl) {
          await flushSession(parseInt(tabId));
          delete activeSessions[tabId];
        }
      }
      await saveActiveSessions(activeSessions);
      await removeTrackedUrl(normalizedUrl);
      return { ok: true };
    }

    case 'EXPORT': {
      const json = await exportData();
      return { json };
    }

    case 'IMPORT': {
      await importData(msg.json);
      await initTracker();
      return { ok: true };
    }

    case 'RESET_STATS': {
      const { normalizedUrl, scope } = msg; // scope: 'today'|'week'|'month'|'alltime'|'all'
      const allStats = await getAllStats();
      const { dayKey, weekKey, monthKey } = getRolloverKeys();
      let s = allStats[normalizedUrl] || {};

      // Also flush any live session first so we start fresh from now
      for (const [tabId, session] of Object.entries(activeSessions)) {
        if (session.normalizedUrl === normalizedUrl) {
          session.lastTickAt = Date.now(); // reset tick without flushing
        }
      }

      if (scope === 'today' || scope === 'all') { s.todaySeconds = 0; s.dayKey = dayKey; }
      if (scope === 'week'  || scope === 'all') { s.weekSeconds  = 0; s.weekKey = weekKey; }
      if (scope === 'month' || scope === 'all') {
        s.monthSeconds = 0; s.monthKey = monthKey;
        // Allow limit warnings to fire again after a manual month reset
        const notifyKey = `${normalizedUrl}::${monthKey}`;
        notifiedApproaching.delete(notifyKey);
        handledLimitReached.delete(notifyKey);
      }
      if (scope === 'alltime' || scope === 'all') { s.allTimeSeconds = 0; }

      allStats[normalizedUrl] = s;
      await saveAllStats(allStats);
      return { ok: true };
    }

    case 'UPDATE_URL_SETTINGS': {
      const { normalizedUrl, limitSeconds, notifyBeforeSeconds, autoClose, note, pinned } = msg;
      const map = await getTrackedUrls();
      if (map[normalizedUrl]) {
        map[normalizedUrl].limitSeconds = limitSeconds;
        map[normalizedUrl].notifyBeforeSeconds = notifyBeforeSeconds;
        map[normalizedUrl].autoClose = autoClose;
        map[normalizedUrl].note = (note || '').trim().slice(0, 120);
        map[normalizedUrl].pinned = pinned || false;
        await saveTrackedUrls(map);
      }
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── Rollover Detection ────────────────────────────────────────────────────────

let lastKnownKeys = getRolloverKeys();

async function checkRollovers() {
  const current = getRolloverKeys();
  if (current.monthKey !== lastKnownKeys.monthKey) {
    resetNotifications();
    console.log('[BG] Monthly rollover detected');
  }
  lastKnownKeys = current;
}

// ─── Service Worker Suspend: flush before dying ────────────────────────────────

// SW may be suspended at any time; flush on every alarm ensures minimal data loss.
// The 1-minute alarm is the safety net.
