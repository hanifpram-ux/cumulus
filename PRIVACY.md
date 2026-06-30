# Privacy Policy for Cumulus

**Last updated: 2026-06-30**

Cumulus ("the extension") is a cloud storage file manager Chrome extension. This policy explains what data Cumulus handles and how.

## What Cumulus does

Cumulus lets you connect to a cloud storage account or WebDAV server that you configure yourself (such as Cloudflare R2, Amazon S3, Backblaze B2, Google Cloud Storage, Wasabi, DigitalOcean Spaces, MinIO, another S3-compatible service, or a WebDAV server), and lets you browse, upload, download, rename, copy, move, organize, and delete files in that account directly from your browser.

## Data Cumulus stores

- **Server connection profiles and credentials.** When you add a storage server, Cumulus stores the connection details (protocol, endpoint, bucket/region, and access credentials such as access key/secret key or WebDAV username/password) in your browser's local extension storage (`chrome.storage.local`). Credentials are encrypted with AES-256-GCM (key derived via PBKDF2) before being written to disk.
- **App preferences.** Your last active server and your preferred file view (list or grid) are stored locally so the extension remembers your settings between sessions.

None of the above is ever transmitted to the developer of Cumulus or to any third-party server. It stays on your device, inside Chrome's local extension storage, and is only used to restore your own settings within the extension.

## Data Cumulus transmits

Cumulus communicates directly and exclusively with the storage server(s) you configure, in order to:

- List, upload, download, rename, copy, move, and delete files in your account.
- Authenticate those requests (e.g., AWS Signature V4 for S3-compatible services, or HTTP Basic/Digest auth for WebDAV).

These requests go straight from your browser to the storage endpoint you specified. Cumulus does not route your files, file names, folder structure, or credentials through any server operated by the developer or any other third party. Cumulus has no backend server of its own.

## Downloads

When you choose to download a file, Cumulus uses Chrome's `downloads` API to save it from your storage account to your local computer. No download data is collected or transmitted elsewhere.

## What Cumulus does not do

- Cumulus does not collect, sell, or share your personal information, browsing history, location, or any analytics/telemetry.
- Cumulus does not use your data for advertising, credit, or lending decisions.
- Cumulus does not execute remotely-hosted code; all extension code ships inside the installed package.

## Permissions

- `storage` / `unlimitedStorage` — to save your encrypted server profiles and preferences locally, and to allow browsing large folder listings without hitting the browser's default storage quota.
- `downloads` — to save files you choose to download to your computer.
- Host permissions (`https://*/*`, `http://*/*`) — required because Cumulus connects to whatever storage endpoint you configure, including self-hosted or custom S3-compatible/WebDAV servers, which can be any domain. Cumulus only contacts the server(s) you explicitly add.

## Open source

Cumulus is open source under the GNU General Public License v3.0. You can review exactly what the code does at the project's source repository.

## Changes to this policy

If this policy changes, the updated version will be published at this same location with a new "Last updated" date.

## Contact

Questions about this policy can be directed to the developer via the project's GitHub repository.
