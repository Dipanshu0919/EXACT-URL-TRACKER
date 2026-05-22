// utils.js — URL normalization + time formatting helpers

/**
 * Normalize a URL for exact comparison:
 * - lowercase
 * - strip query params
 * - strip hash fragments
 * - strip trailing slash
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url.trim().toLowerCase());
    // Keep only protocol + host + pathname
    let normalized = u.protocol + '//' + u.host + u.pathname;
    // Remove trailing slash (except root)
    if (normalized.endsWith('/') && normalized.split('/').length > 3) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    // Fallback: manual strip
    return url.trim().toLowerCase()
      .split('?')[0]
      .split('#')[0]
      .replace(/\/$/, '');
  }
}

/**
 * Format seconds → always includes seconds
 * e.g. 3723 → "1h 02m 03s" | 90 → "1m 30s" | 45 → "45s"
 */
function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}

/** Alias kept for compatibility */
function formatTimeShort(seconds) { return formatTime(seconds); }

/**
 * Get rollover keys for stats resets
 */
function getRolloverKeys() {
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
  // ISO week: Monday-based
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  const weekKey = monday.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7); // YYYY-MM
  return { dayKey, weekKey, monthKey };
}

// Export for both service worker and popup contexts
if (typeof module !== 'undefined') {
  module.exports = { normalizeUrl, formatTime, formatTimeShort, getRolloverKeys };
}
