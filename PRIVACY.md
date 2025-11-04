### Tabox Privacy Policy

Last updated: 2025-11-02

**Privacy is our core principle. Tabox never sends your data to our servers.** We do not collect, sell, or share personal data. Your data stays on your device unless you explicitly enable Google Drive sync, in which case your data is stored in your own Google account.

### What Tabox is

Tabox is a Chrome extension that lets you save, organize, and reopen sets of browser tabs as “collections,” including optional folders and Chrome Tab Groups metadata.

### WHAT INFORMATION DO WE COLLECT?

- **Collections and folders (local)**: names, colors, creation/update timestamps, and the tabs you choose to save (tab titles, URLs, and optional Chrome Tab Group information).
- **Settings and preferences (local)**: feature toggles such as badges, auto‑backups, and UI choices.
- **Backups and minimal logs (local)**:
  - Auto‑backups of your collections to help with recovery.
  - Limited sync/debug logs stored locally (recent entries only) to aid troubleshooting.
- **If you enable Google sync**:
  - We sync the collections you explicitly saved to a single JSON file (`appSettings.json`) in your Google Drive `appDataFolder` using Google OAuth.
  - We may retrieve basic Google Drive “user” info (e.g., name/email provided by the API) to display your sign‑in state in the UI. This is stored only on your device.
  - Access/refresh tokens are stored locally in the extension’s storage and are used only to call Google APIs.

We do not collect analytics, usage telemetry, or browsing history beyond the tabs you explicitly save.

This local data is kept in your browser’s extension storage. Removing the extension or clearing its data will remove the local data.

### Optional sync with your Google account (off by default)

If you sign in, Tabox uses Google OAuth 2.0 and Google Drive to sync your collections across devices:

- **What is synced**: only your Tabox collections (tab titles, URLs, colors, timestamps, and folder/group metadata) that you chose to save.
- **Where it goes**: a single JSON file named `appSettings.json` in your Google Drive `appDataFolder` (hidden app‑only location).
- **Permissions and scopes**:
  - `https://www.googleapis.com/auth/drive.appdata` and `https://www.googleapis.com/auth/drive.file` to create/read/update the sync file.
  - Chrome `identity` to complete the OAuth flow securely.
- **Tokens**: stored locally in your browser and sent only to Google over HTTPS.
- **Security**: data is transmitted via HTTPS and stored by Google (encrypted at rest by Google). Tabox does not add extra client‑side encryption.

You can revoke access at `myaccount.google.com/permissions`. To delete synced data, in Google Drive settings → Manage Apps → find Tabox → Delete hidden app data. Signing out of Tabox removes local tokens and stops sync.

### No tracking, no ads, no analytics

- Tabox does not include advertising, behavioral tracking, or analytics SDKs.
- We do not use Google Analytics, Mixpanel, Segment, Sentry, or similar services.
- The extension’s content security policy restricts scripts to run from the extension itself.

### Third-party services and libraries

- **Google services (only if you enable sync)**:
  - Google OAuth 2.0 (`accounts.google.com`, `oauth2.googleapis.com`)
  - Google Drive API (`www.googleapis.com`) for reading/writing the single sync file.
- **Chrome platform services** (built into your browser):
  - `storage.local` for local data.
  - `storage.sync` for storing minimal sync metadata (e.g., the Drive file ID) across Chrome profiles if your Chrome Sync is enabled.
  - Extension update delivery by the Chrome Web Store.
- **Open‑source UI/utilities**: React, dnd-kit, Recoil, and similar client-side libraries that run entirely within the extension. These libraries do not, by themselves, send your data to external services.

### Permissions we request and why

Tabox requests the following Chrome extension permissions to provide core functionality:

- **tabs, tabGroups**: read the current window’s tabs and group info when you save or update a collection.
- **storage, unlimitedStorage**: store your collections, settings, and local backups in the browser.
- **sessions**: enable session-saving and recovery features locally.
- **identity**: authenticate with Google for optional Drive sync.
- **contextMenus**: add the “Add tab to Tabox Collection” right-click menu.
- **system.display**: used for advanced windowing workflows; no personal data is transmitted.
- **alarms**: schedule local auto-backups and maintenance tasks.

These permissions do not send your data anywhere by themselves; they only enable Tabox features within your browser.

### WILL YOUR INFORMATION BE SHARED WITH ANYONE?

- **No.** Tabox does not send your data to our servers and does not share or sell your data to third parties.
- If you enable sync, your data is stored in your own Google Drive account and is processed by Google under their terms. Tabox does not receive your synced content.
- You may choose to export or share collections yourself; such sharing is fully under your control.

### HOW DO WE HANDLE YOUR SOCIAL LOGINS?

- Tabox supports sign‑in with **Google** solely to access Google Drive for optional sync.
- We request only the scopes needed to manage the single sync file. We do not request access to your contacts or social graph.
- We may read basic user info returned by the Drive “about” API to confirm your sign‑in state. This info is stored locally and not sent to us.
- OAuth access/refresh tokens are stored locally and used only for Google APIs. You can revoke access anytime in your Google Account.

### HOW LONG DO WE KEEP YOUR INFORMATION?

- **Local data (collections, settings, backups, logs)**: remains on your device until you remove it or uninstall the extension. Logs are kept to a small rolling window (recent entries only).
- **Google Drive sync file**: remains in your `appDataFolder` until you delete it or revoke Tabox’s access.
- **OAuth tokens**: stored locally and removed when you sign out; access tokens also expire automatically per Google.

### HOW DO WE KEEP YOUR INFORMATION SAFE?

- **On device**: data is stored in Chrome extension storage; tokens are local to your browser profile.
- **In transit**: communication with Google APIs uses HTTPS.
- **At rest (sync)**: your sync file is stored in Google Drive, encrypted at rest by Google.
- **Principle of minimal access**: only the permissions necessary for features are requested; no analytics SDKs are included.
- No method of transmission or storage is 100% secure; use strong OS/browser security practices.

### DO WE COLLECT INFORMATION FROM MINORS?

Tabox is not directed to children under 13 and does not knowingly collect personal information from children.

### WHAT ARE YOUR PRIVACY RIGHTS?

- Since we do not operate servers for your data, you control your data directly:
  - Remove local data by clearing the extension’s storage or uninstalling the extension.
  - Stop sync and delete tokens by signing out in Tabox.
  - Revoke Google access at `myaccount.google.com/permissions`.
  - Delete synced data by removing the Tabox hidden app data in Google Drive settings → Manage Apps.
- You may contact us to ask questions about this policy or your data choices.

### CONTROLS FOR DO‑NOT‑TRACK FEATURES

We do not track you. Because there is no analytics or cross‑site tracking, browser “Do Not Track” signals do not change Tabox behavior.

### DO CALIFORNIA RESIDENTS HAVE SPECIFIC PRIVACY RIGHTS?

- We do not sell or share personal information as defined by the CCPA/CPRA.
- We do not run servers that hold your personal data; your Tabox data remains on your device or in your own Google Drive if you enable sync.
- To exercise applicable rights, you can manage or delete your data as described above, and you may contact us with any questions.

### DO WE MAKE UPDATES TO THIS POLICY?

We may update this policy as Tabox evolves. Material changes will be reflected by updating the “Last updated” date above. Continued use of Tabox after changes take effect constitutes acceptance of the updated policy.

### HOW CAN YOU CONTACT US ABOUT THIS POLICY?

Email: `info@tabox.co`

You can also open an issue at `https://github.com/gilgold/tabox/issues` or visit `https://tabox.co`.

