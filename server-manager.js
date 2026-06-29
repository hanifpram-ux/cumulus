const ServerManager = {
  STORAGE_KEY: "r2fm_servers",
  ACTIVE_KEY: "r2fm_active_server",
  ENCRYPTION_PASS: null,

  init(encryptionPass) {
    this.ENCRYPTION_PASS = encryptionPass;
  },

  async _loadRaw() {
    return new Promise(resolve => {
      chrome.storage.local.get(this.STORAGE_KEY, (result) => {
        resolve(result[this.STORAGE_KEY] || null);
      });
    });
  },

  async _saveRaw(data) {
    return new Promise(r => chrome.storage.local.set({ [this.STORAGE_KEY]: data }, r));
  },

  async loadServers() {
    const encrypted = await this._loadRaw();
    if (!encrypted) return [];
    try {
      const json = await CryptoUtils.decryptData(encrypted, this.ENCRYPTION_PASS);
      return JSON.parse(json);
    } catch {
      return [];
    }
  },

  async saveServers(servers) {
    const json = JSON.stringify(servers);
    const encrypted = await CryptoUtils.encryptData(json, this.ENCRYPTION_PASS);
    await this._saveRaw(encrypted);
  },

  async addServer(server) {
    const servers = await this.loadServers();
    server.id = server.id || this._generateId();
    server.createdAt = server.createdAt || new Date().toISOString();
    server.updatedAt = new Date().toISOString();
    servers.push(server);
    await this.saveServers(servers);
    return server;
  },

  async updateServer(id, updates) {
    const servers = await this.loadServers();
    const idx = servers.findIndex(s => s.id === id);
    if (idx === -1) throw new Error("Server not found");
    servers[idx] = { ...servers[idx], ...updates, updatedAt: new Date().toISOString() };
    await this.saveServers(servers);
    return servers[idx];
  },

  async deleteServer(id) {
    let servers = await this.loadServers();
    servers = servers.filter(s => s.id !== id);
    await this.saveServers(servers);
    const active = await this.getActiveServerId();
    if (active === id) await this.setActiveServer(null);
  },

  async getServer(id) {
    const servers = await this.loadServers();
    return servers.find(s => s.id === id) || null;
  },

  async getActiveServerId() {
    return new Promise(resolve => {
      chrome.storage.local.get(this.ACTIVE_KEY, (result) => {
        resolve(result[this.ACTIVE_KEY] || null);
      });
    });
  },

  async setActiveServer(id) {
    return new Promise(r => chrome.storage.local.set({ [this.ACTIVE_KEY]: id }, r));
  },

  async getActiveServer() {
    const id = await this.getActiveServerId();
    if (!id) return null;
    return this.getServer(id);
  },

  async migrateFromLegacy() {
    const servers = await this.loadServers();
    if (servers.length > 0) return null;

    const legacy = await new Promise(resolve => {
      chrome.storage.local.get("r2credentials", async (result) => {
        if (!result.r2credentials) return resolve(null);
        try {
          const json = await CryptoUtils.decryptData(result.r2credentials, this.ENCRYPTION_PASS);
          resolve(JSON.parse(json));
        } catch {
          resolve(null);
        }
      });
    });

    if (!legacy) return null;

    const server = {
      id: this._generateId(),
      name: `R2 - ${legacy.bucket}`,
      protocol: "r2",
      accessKeyId: legacy.accessKeyId,
      secretAccessKey: legacy.secretAccessKey,
      accountId: legacy.accountId,
      bucket: legacy.bucket,
      customDomain: legacy.customDomain || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.addServer(server);
    await this.setActiveServer(server.id);
    return server;
  },

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  getProtocolInfo(protocol) {
    const protocols = {
      r2: {
        name: "Cloudflare R2",
        icon: "R2",
        iconColor: "#f6821f",
        fields: ["accessKeyId", "secretAccessKey", "accountId", "bucket", "customDomain"],
        category: "s3",
      },
      s3: {
        name: "Amazon S3",
        icon: "S3",
        iconColor: "#ff9900",
        fields: ["accessKeyId", "secretAccessKey", "region", "bucket", "endpoint", "customDomain"],
        category: "s3",
      },
      b2: {
        name: "Backblaze B2",
        icon: "B2",
        iconColor: "#e03526",
        fields: ["accessKeyId", "secretAccessKey", "region", "bucket", "endpoint", "customDomain"],
        category: "s3",
      },
      gcs: {
        name: "Google Cloud Storage",
        icon: "GC",
        iconColor: "#4285f4",
        fields: ["accessKeyId", "secretAccessKey", "region", "bucket", "endpoint", "customDomain"],
        category: "s3",
      },
      wasabi: {
        name: "Wasabi",
        icon: "WA",
        iconColor: "#56b847",
        fields: ["accessKeyId", "secretAccessKey", "region", "bucket", "endpoint", "customDomain"],
        category: "s3",
      },
      "do-spaces": {
        name: "DigitalOcean Spaces",
        icon: "DO",
        iconColor: "#0080ff",
        fields: ["accessKeyId", "secretAccessKey", "region", "bucket", "endpoint", "customDomain"],
        category: "s3",
      },
      minio: {
        name: "MinIO",
        icon: "MI",
        iconColor: "#c72c48",
        fields: ["accessKeyId", "secretAccessKey", "region", "bucket", "endpoint", "customDomain"],
        category: "s3",
      },
      "s3-compatible": {
        name: "S3-Compatible",
        icon: "S3",
        iconColor: "#89b4fa",
        fields: ["accessKeyId", "secretAccessKey", "region", "bucket", "endpoint", "customDomain"],
        category: "s3",
      },
      webdav: {
        name: "WebDAV",
        icon: "WD",
        iconColor: "#cba6f7",
        fields: ["serverUrl", "username", "password", "basePath", "customDomain"],
        category: "webdav",
      },
    };
    return protocols[protocol] || protocols["s3-compatible"];
  },

  getAllProtocols() {
    return [
      { value: "r2", label: "Cloudflare R2", group: "Object Storage" },
      { value: "s3", label: "Amazon S3", group: "Object Storage" },
      { value: "b2", label: "Backblaze B2", group: "Object Storage" },
      { value: "gcs", label: "Google Cloud Storage", group: "Object Storage" },
      { value: "wasabi", label: "Wasabi", group: "Object Storage" },
      { value: "do-spaces", label: "DigitalOcean Spaces", group: "Object Storage" },
      { value: "minio", label: "MinIO (Self-hosted)", group: "Object Storage" },
      { value: "s3-compatible", label: "S3-Compatible (Custom)", group: "Object Storage" },
      { value: "webdav", label: "WebDAV", group: "Other" },
    ];
  },

  getFieldConfig() {
    return {
      accessKeyId: { label: "Access Key ID", type: "text", placeholder: "e.g. AKIAIOSFODNN7...", required: true },
      secretAccessKey: { label: "Secret Access Key", type: "password", placeholder: "Your secret access key", required: true },
      accountId: { label: "Account ID", type: "text", placeholder: "Cloudflare Account ID", required: true, hint: "Found in Cloudflare Dashboard → R2 → Overview" },
      bucket: { label: "Bucket Name", type: "text", placeholder: "my-bucket", required: true },
      region: { label: "Region", type: "text", placeholder: "e.g. us-east-1, auto", required: false },
      endpoint: { label: "Endpoint URL", type: "text", placeholder: "https://s3.region.amazonaws.com", required: false, hint: "Leave blank for default" },
      customDomain: { label: "Custom Domain (Optional)", type: "text", placeholder: "https://cdn.example.com", required: false, hint: "Public domain for copying URLs" },
      serverUrl: { label: "Server URL", type: "text", placeholder: "https://dav.example.com", required: true },
      username: { label: "Username", type: "text", placeholder: "username", required: false },
      password: { label: "Password", type: "password", placeholder: "password", required: false },
      basePath: { label: "Base Path", type: "text", placeholder: "/", required: false, hint: "Root path on the server" },
    };
  },
};
