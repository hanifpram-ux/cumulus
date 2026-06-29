# Cumulus ☁️

**Multi-protocol cloud storage file manager — right in your browser.**

A Chrome extension that lets you browse, upload, download, rename, and manage files across multiple cloud storage providers. Think FileZilla, but as a browser extension.

## Supported Protocols

### Object Storage (S3-Compatible)
| Provider | Status |
|----------|--------|
| Cloudflare R2 | ✅ |
| Amazon S3 | ✅ |
| Backblaze B2 | ✅ |
| Google Cloud Storage | ✅ |
| Wasabi | ✅ |
| DigitalOcean Spaces | ✅ |
| MinIO (Self-hosted) | ✅ |
| Any S3-Compatible | ✅ |

### Other
| Protocol | Status |
|----------|--------|
| WebDAV | ✅ |

## Features

- **Multi-server management** — Save and switch between multiple storage servers (like FileZilla's Site Manager)
- **File operations** — Upload, download, delete, rename, create folders
- **Drag & drop** — Drop files or entire folders to upload
- **Parallel uploads** — Configurable concurrent upload count (1-50)
- **Batch rename** — Advanced batch rename with stackable rules:
  - Find & Replace (with regex support)
  - Add numbering (prefix/suffix, configurable start/step/padding)
  - Change case (lower/upper/title/sentence)
  - Trim & clean whitespace
  - Insert/remove text at position
  - Replace spaces with custom character
  - Change file extension
  - Add date/time stamps
- **File preview** — Preview images, videos, and text files directly in the browser
- **Copy public URLs** — Single or bulk copy of file URLs with custom domain support
- **Activity log** — Real-time operation log with timestamps
- **Encrypted credentials** — All credentials are encrypted with AES-256-GCM before storage
- **Dark theme** — Catppuccin Mocha theme

## Installation

### From source (Developer mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/hanifpram-ux/cumulus.git
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the cloned folder
5. Click the Cumulus icon in the toolbar to open

### CORS Configuration

For S3-compatible storage, you need to configure CORS on your bucket. Example for Cloudflare R2:

```json
[
  {
    "AllowedOrigins": ["chrome-extension://*"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Last-Modified"],
    "MaxAgeSeconds": 3600
  }
]
```

## Project Structure

```
cumulus/
├── manifest.json          # Chrome extension manifest (v3)
├── popup.html/js          # Extension popup (launcher)
├── manager.html           # Main file manager UI
├── manager.js             # Application logic & state management
├── storage-client.js      # Storage protocol implementations (S3, WebDAV)
├── server-manager.js      # Multi-server management & encrypted storage
├── batch-rename.js        # Batch rename engine with stackable rules
├── crypto-utils.js        # AES-GCM encryption, HMAC-SHA256, AWS Sig V4
├── styles.css             # Catppuccin dark theme
└── icons/                 # Extension icons
```

## Tech Stack

- **Pure JavaScript** — No frameworks, no build tools, no dependencies
- **Chrome Extension Manifest V3**
- **WebCrypto API** — AES-256-GCM encryption, PBKDF2 key derivation, AWS Signature V4
- **S3 API** — Direct AWS Signature V4 signing without SDK

## License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.

## Credits

Made with ❤️ by [Hanif Pramono](https://hanifprm.my.id)

---

> **Cumulus** — *a type of cloud with a flat base and rounded top, often seen on fair-weather days.*
