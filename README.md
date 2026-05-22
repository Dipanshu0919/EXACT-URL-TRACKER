# Exact URL Usage Tracker

A lightweight Chrome Extension (Manifest V3) for tracking exact-URL session time.  
Built specifically for services like **GitHub Codespaces**, where each session URL has its own quota.

---

## What It Does

- Tracks total **open-tab time** for specific, manually-added URLs
- Works when browser is unfocused, minimized, or user is idle
- Tracks **only the exact URL** you add — not the whole domain
- Monthly limits with notifications and optional auto-close
- Daily / weekly / monthly / all-time stats with automatic resets

---

## Folder Structure

```
exact-url-tracker/
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker — events, alarms, message handling
├── tracker.js         # Core tracking engine (sessions, flush, limits)
├── storage.js         # chrome.storage.local abstraction
├── utils.js           # URL normalization, time formatting, rollover keys
├── popup.html         # Extension popup UI
├── popup.js           # Popup controller
├── popup.css          # Dark industrial UI styles
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Installation (Unpacked / Developer Mode)

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `exact-url-tracker/` folder
5. The extension icon appears in your toolbar

---

## Usage

1. Click the extension icon
2. Paste an **exact URL** (e.g. `https://github.com/codespaces/sturdy-pancake-xrw66vwpppvg34w4`)
3. Optionally set a monthly limit (hours/minutes) and notification threshold
4. Click **+ Add**
5. Open that tab — tracking starts immediately

---

## URL Matching Rules

The extension uses **exact normalized URL matching only**.

Normalization strips:
- Query parameters (`?tab=ports`)
- Hash fragments (`#section`)
- Trailing slash

Example:
```
Input:   https://github.com/codespaces/test/?tab=ports#abc
Tracked: https://github.com/codespaces/test
```

✅ Matches the exact URL  
❌ Does NOT match parent paths, other subpages, or sibling URLs

---

## Tracking Logic

- Time is tracked whenever a matching tab **exists and is open**
- Does NOT require the tab to be active or focused
- Does NOT pause on user idle
- Works with minimized browser windows

**Engine:**
- Active sessions stored as `{ tabId: { normalizedUrl, lastTickAt } }`
- Chrome Alarms flush elapsed time every **1 minute**
- Sessions also flushed on tab close and browser shutdown
- On browser restart, old sessions are reconciled against currently open tabs

---

## Automatic Resets

| Period | Reset Trigger |
|--------|--------------|
| Daily  | Midnight (local time) |
| Weekly | Monday midnight |
| Monthly | 1st of month |

---

## Monthly Limits

Per-URL settings:
- **Monthly limit**: hours + minutes
- **Notify before**: show notification X hours before limit (default 2h)
- **Auto-close**: automatically close the tab when limit is reached

---

## Export / Import

- **Export**: Downloads a JSON file with all tracked URLs, stats, and settings
- **Import**: Restore from a previously exported JSON file

---

## Performance

| Concern | Approach |
|---------|----------|
| RAM | In-memory sessions only (tiny object) |
| CPU | Event-driven; no per-second loops |
| Storage | chrome.storage.local, written only on flush |
| Polling | Chrome Alarms (1/min) — not setInterval |
| Libraries | Zero — vanilla JS only |

---

## Chrome Web Store Publishing

1. Zip the extension folder:  
   `zip -r exact-url-tracker.zip exact-url-tracker/`

2. Go to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)

3. Pay one-time $5 developer fee (if not already)

4. Click **Add new item** → upload the zip

5. Fill in:
   - Name, description, category (Productivity)
   - Screenshots (1280×800 or 640×400)
   - Privacy policy (required — state you collect no browsing data)

6. Submit for review (usually 1–3 business days)

**Privacy policy note**: State clearly that the extension only tracks URLs manually added by the user, stores data locally, and never sends data externally.

---

## Edge Cases Handled

| Case | Handling |
|------|----------|
| Browser crash | Sessions flushed on next startup; elapsed capped at 2h to prevent inflated counts |
| Tab navigates away | Old session flushed, new session checked |
| Multiple tabs same URL | Each tab tracked independently; time summed |
| SW suspended | 1-min alarm wakes SW; no data lost beyond 1 tick |
| Monthly rollover | Stats reset on first access after new month |
| Notification spam | Per-URL, per-month deduplication |

---

## Privacy

- Only tracks URLs you manually add
- All data stored locally in `chrome.storage.local`
- No external requests, no analytics, no telemetry
- No access to browsing history
