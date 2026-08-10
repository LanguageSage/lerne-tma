# Offline Mode Architecture

If the user asks to enable offline mode, build for PC standalone, or build for Android offline:
- The full offline mock API implementation is backed up at: `app/src/services/offlineApi.js.bak`.
- To restore offline mode, copy the contents of `offlineApi.js.bak` back into `offlineApi.js`.
