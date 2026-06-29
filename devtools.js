// Registers the "Tracking Auditor" tab in DevTools. The panel HTML/JS carries
// all UI and capture logic; this file only creates the panel once per DevTools
// instance (i.e. once per inspected tab).
chrome.devtools.panels.create(
  'Tracking Auditor',
  '',            // icon path (none yet)
  'panel.html',
  () => { /* panel created */ }
);
