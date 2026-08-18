# MONA RADAR Market Desktop MVP

`npm run tauri:build` creates the Windows NSIS installer and executable. The bundle contains `node.exe` plus the compiled collector runtime, so an installed user does not need a separate Node installation.

The production database lives under the Tauri local application-data location in `MonaRadar/Market/mona-radar-market.sqlite3`; it is created by the collector and is not bundled with the installer. `KONEPS_SERVICE_KEY` is read only by the private Node sidecar process. It is never passed to the web UI, SQLite request URL, or application log.

Views:

- Search: local `bid_notice` query and real item/basis detail.
- Dash and Analysis: real SQLite summary queries.
- Collector: initial, incremental, one-chunk historical resume, stop, checkpoint and redacted event log.

For a first collection, launch the application from a PowerShell session where `KONEPS_SERVICE_KEY` (and, if needed, `KONEPS_SERVICE_KEY_MODE=preserve`) is already set. The app does not persist credentials.
