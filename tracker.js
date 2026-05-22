// tracker.js — Core tracking engine
// Imported by background.js in service worker context

// In-memory active sessions: { [tabId]: { normalizedUrl, lastTickAt } }
let activeSessions = {};

// Track which URLs have had "approaching limit" notification sent this month
let notifiedApproaching = new Set();
// Track which URLs have had "limit reached" handled
let handledLimitReached = new Set();

/** Initialize: restore sessions from storage, reconcile open tabs */
async function initTracker() {
  // Load persisted sessions (for crash/restart recovery)
  const persisted = await getActiveSessions();
  const trackedUrls = await getTrackedUrls();
  const trackedNormalized = Object.keys(trackedUrls);

  // Get all currently open tabs
  const tabs = await chrome.tabs.query({});
  const openTabMap = {}; // { [normalizedUrl]: tabId }

  for (const tab of tabs) {
    if (!tab.url) continue;
    const n = normalizeUrl(tab.url);
    if (trackedNormalized.includes(n)) {
      openTabMap[n] = tab.id;
    }
  }

  // Reconcile: flush any old sessions that are no longer open
  for (const [tabId, session] of Object.entries(persisted)) {
    const isStillOpen = Object.values(openTabMap).includes(parseInt(tabId));
    if (!isStillOpen && session.lastTickAt) {
      // Flush elapsed time for closed tab (up to max 2h to avoid huge gaps on crashes)
      const elapsed = Math.min((Date.now() - session.lastTickAt) / 1000, 7200);
      if (elapsed > 0) {
        await addElapsedSeconds(session.normalizedUrl, Math.floor(elapsed));
      }
    }
  }

  // Build fresh activeSessions for currently open tracked tabs
  activeSessions = {};
  for (const [normalizedUrl, tabId] of Object.entries(openTabMap)) {
    activeSessions[tabId] = { normalizedUrl, lastTickAt: Date.now() };
  }

  await saveActiveSessions(activeSessions);
  console.log('[Tracker] Initialized. Active sessions:', Object.keys(activeSessions).length);
}

/** Called when a tab is created or updated — check if URL is tracked */
async function onTabUpdated(tabId, url) {
  if (!url) return;
  const n = normalizeUrl(url);
  const trackedUrls = await getTrackedUrls();

  if (trackedUrls[n]) {
    // Start or update session for this tab
    if (activeSessions[tabId]) {
      // URL changed mid-session: flush old, start new
      await flushSession(tabId);
    }
    activeSessions[tabId] = { normalizedUrl: n, lastTickAt: Date.now() };
    await saveActiveSessions(activeSessions);
    console.log('[Tracker] Started session:', n, 'tabId:', tabId);
  } else {
    // Tab navigated away from tracked URL
    if (activeSessions[tabId]) {
      await flushSession(tabId);
      delete activeSessions[tabId];
      await saveActiveSessions(activeSessions);
    }
  }
}

/** Called when a tab is removed */
async function onTabRemoved(tabId) {
  if (activeSessions[tabId]) {
    await flushSession(tabId);
    delete activeSessions[tabId];
    await saveActiveSessions(activeSessions);
    console.log('[Tracker] Session ended on tab close. tabId:', tabId);
  }
}

/**
 * Flush elapsed time for a session to storage.
 * Does NOT remove the session — caller decides that.
 */
async function flushSession(tabId) {
  const session = activeSessions[tabId];
  if (!session || !session.lastTickAt) return;

  const now = Date.now();
  const elapsedSeconds = Math.floor((now - session.lastTickAt) / 1000);
  session.lastTickAt = now; // reset tick

  if (elapsedSeconds > 0) {
    await addElapsedSeconds(session.normalizedUrl, elapsedSeconds);
    console.log('[Tracker] Flushed', elapsedSeconds, 's for', session.normalizedUrl);
    await checkLimits(session.normalizedUrl);
  }
}

/** Flush ALL active sessions (called by alarm tick + suspend) */
async function flushAllSessions() {
  for (const tabId of Object.keys(activeSessions)) {
    await flushSession(parseInt(tabId));
  }
  await saveActiveSessions(activeSessions);
}

/** Check limit warnings and auto-close for a URL */
async function checkLimits(normalizedUrl) {
  const trackedUrls = await getTrackedUrls();
  const entry = trackedUrls[normalizedUrl];
  if (!entry || !entry.limitSeconds) return;

  const stats = await getUrlStats(normalizedUrl);
  const monthSeconds = stats.monthSeconds || 0;
  const limitSeconds = entry.limitSeconds;
  const remaining = limitSeconds - monthSeconds;
  const notifyThreshold = entry.notifyBeforeSeconds || 7200;

  const monthKey = getRolloverKeys().monthKey;
  const notifyKey = `${normalizedUrl}::${monthKey}`;

  // Approaching limit warning
  if (remaining > 0 && remaining <= notifyThreshold && !notifiedApproaching.has(notifyKey)) {
    notifiedApproaching.add(notifyKey);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '⚠️ Usage Limit Approaching',
      message: `${entry.originalUrl}\n${formatTime(remaining)} remaining of your monthly limit.`
    });
  }

  // Limit reached
  if (remaining <= 0 && !handledLimitReached.has(notifyKey)) {
    handledLimitReached.add(notifyKey);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '🚫 Usage Limit Reached',
      message: `${entry.originalUrl}\nMonthly limit of ${formatTime(limitSeconds)} reached.`
    });

    // Auto-close if enabled
    if (entry.autoClose) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && normalizeUrl(tab.url) === normalizedUrl) {
          chrome.tabs.remove(tab.id);
        }
      }
    }
  }
}

/** Reset notifications for new month (called on monthly rollover) */
function resetNotifications() {
  notifiedApproaching.clear();
  handledLimitReached.clear();
}

/** Get live status for all tracked URLs: which are currently open */
function getLiveStatus() {
  const status = {}; // { [normalizedUrl]: boolean }
  for (const session of Object.values(activeSessions)) {
    status[session.normalizedUrl] = true;
  }
  return status;
}

/** Get live elapsed seconds not yet flushed (for real-time display) */
function getLiveElapsed() {
  const elapsed = {}; // { [normalizedUrl]: seconds }
  const now = Date.now();
  for (const session of Object.values(activeSessions)) {
    const s = Math.floor((now - session.lastTickAt) / 1000);
    elapsed[session.normalizedUrl] = (elapsed[session.normalizedUrl] || 0) + s;
  }
  return elapsed;
}
