// storage.js — chrome.storage.local abstraction layer

const STORAGE_KEYS = {
  TRACKED_URLS: 'trackedUrls',      // { [normalizedUrl]: { originalUrl, limitSeconds, addedAt, notifyBeforeSeconds, autoClose } }
  STATS: 'stats',                    // { [normalizedUrl]: { dayKey, weekKey, monthKey, todaySeconds, weekSeconds, monthSeconds, allTimeSeconds } }
  SETTINGS: 'settings',             // global settings
  ACTIVE_SESSIONS: 'activeSessions' // { [tabId]: { normalizedUrl, lastTickAt } } — persisted for restart recovery
};

/** Load all tracked URLs */
async function getTrackedUrls() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEYS.TRACKED_URLS, data => {
      resolve(data[STORAGE_KEYS.TRACKED_URLS] || {});
    });
  });
}

/** Save tracked URLs map */
async function saveTrackedUrls(map) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEYS.TRACKED_URLS]: map }, resolve);
  });
}

/** Add a tracked URL entry */
async function addTrackedUrl(normalizedUrl, originalUrl, limitSeconds, notifyBeforeSeconds, autoClose) {
  const map = await getTrackedUrls();
  map[normalizedUrl] = {
    originalUrl,
    limitSeconds: limitSeconds || null,
    notifyBeforeSeconds: notifyBeforeSeconds || 7200, // default 2h
    autoClose: autoClose || false,
    addedAt: Date.now()
  };
  await saveTrackedUrls(map);
}

/** Remove a tracked URL entry */
async function removeTrackedUrl(normalizedUrl) {
  const map = await getTrackedUrls();
  delete map[normalizedUrl];
  await saveTrackedUrls(map);
  // Also clean up stats
  const stats = await getAllStats();
  delete stats[normalizedUrl];
  await saveAllStats(stats);
}

/** Load all stats */
async function getAllStats() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEYS.STATS, data => {
      resolve(data[STORAGE_KEYS.STATS] || {});
    });
  });
}

/** Save all stats */
async function saveAllStats(stats) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats }, resolve);
  });
}

/** Get stats for a specific URL, applying rollover resets as needed */
async function getUrlStats(normalizedUrl) {
  const { dayKey, weekKey, monthKey } = getRolloverKeys();
  const allStats = await getAllStats();
  let s = allStats[normalizedUrl] || {};

  let dirty = false;

  // Daily reset
  if (s.dayKey !== dayKey) {
    s.todaySeconds = 0;
    s.dayKey = dayKey;
    dirty = true;
  }

  // Weekly reset
  if (s.weekKey !== weekKey) {
    s.weekSeconds = 0;
    s.weekKey = weekKey;
    dirty = true;
  }

  // Monthly reset
  if (s.monthKey !== monthKey) {
    s.monthSeconds = 0;
    s.monthKey = monthKey;
    dirty = true;
  }

  // Init defaults
  if (s.allTimeSeconds === undefined) s.allTimeSeconds = 0;
  if (s.todaySeconds === undefined) s.todaySeconds = 0;
  if (s.weekSeconds === undefined) s.weekSeconds = 0;
  if (s.monthSeconds === undefined) s.monthSeconds = 0;

  if (dirty) {
    allStats[normalizedUrl] = s;
    await saveAllStats(allStats);
  }

  return s;
}

/** Add elapsed seconds to all stat buckets for a URL */
async function addElapsedSeconds(normalizedUrl, elapsedSeconds) {
  if (elapsedSeconds <= 0) return;
  const { dayKey, weekKey, monthKey } = getRolloverKeys();
  const allStats = await getAllStats();
  let s = allStats[normalizedUrl] || {
    dayKey, weekKey, monthKey,
    todaySeconds: 0, weekSeconds: 0, monthSeconds: 0, allTimeSeconds: 0
  };

  // Apply rollovers before adding
  if (s.dayKey !== dayKey) { s.todaySeconds = 0; s.dayKey = dayKey; }
  if (s.weekKey !== weekKey) { s.weekSeconds = 0; s.weekKey = weekKey; }
  if (s.monthKey !== monthKey) { s.monthSeconds = 0; s.monthKey = monthKey; }

  s.todaySeconds = (s.todaySeconds || 0) + elapsedSeconds;
  s.weekSeconds = (s.weekSeconds || 0) + elapsedSeconds;
  s.monthSeconds = (s.monthSeconds || 0) + elapsedSeconds;
  s.allTimeSeconds = (s.allTimeSeconds || 0) + elapsedSeconds;

  allStats[normalizedUrl] = s;
  await saveAllStats(allStats);
  return s;
}

/** Load active sessions (for restart recovery) */
async function getActiveSessions() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEYS.ACTIVE_SESSIONS, data => {
      resolve(data[STORAGE_KEYS.ACTIVE_SESSIONS] || {});
    });
  });
}

/** Save active sessions */
async function saveActiveSessions(sessions) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_SESSIONS]: sessions }, resolve);
  });
}

/** Get global settings */
async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS, data => {
      resolve(data[STORAGE_KEYS.SETTINGS] || {});
    });
  });
}

/** Save global settings */
async function saveSettings(settings) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings }, resolve);
  });
}

/** Export all data as JSON string */
async function exportData() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, data => {
      resolve(JSON.stringify(data, null, 2));
    });
  });
}

/** Import data from JSON string */
async function importData(jsonString) {
  const data = JSON.parse(jsonString);
  return new Promise(resolve => {
    chrome.storage.local.set(data, resolve);
  });
}
