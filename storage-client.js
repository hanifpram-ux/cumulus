class StorageClient {
  constructor(config) {
    this.config = config;
  }

  async testConnection() { throw new Error("Not implemented"); }
  async listObjects(prefix, delimiter, continuationToken) { throw new Error("Not implemented"); }
  async uploadFile(key, file, onProgress) { throw new Error("Not implemented"); }
  async downloadFile(key, onProgress) { throw new Error("Not implemented"); }
  async deleteObject(key) { throw new Error("Not implemented"); }
  async deleteObjects(keys) {
    for (const key of keys) await this.deleteObject(key);
  }
  async createFolder(prefix) { throw new Error("Not implemented"); }
  async copyObject(sourceKey, destKey) { throw new Error("Not implemented"); }
  async renameObject(oldKey, newKey) {
    await this.copyObject(oldKey, newKey);
    await this.deleteObject(oldKey);
  }
  async headObject(key) { throw new Error("Not implemented"); }
  getPublicUrl(key, customDomain) { return ""; }
  getDisplayName() { return "Storage"; }
  getProtocol() { return "unknown"; }
}

class S3Client extends StorageClient {
  constructor(config) {
    super(config);
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.bucket = config.bucket;
    this.region = config.region || "auto";
    this.service = "s3";

    if (config.protocol === "r2") {
      this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
      this.region = "auto";
    } else if (config.protocol === "s3") {
      this.endpoint = config.endpoint || `https://s3.${config.region || "us-east-1"}.amazonaws.com`;
      this.region = config.region || "us-east-1";
    } else if (config.protocol === "b2") {
      this.endpoint = config.endpoint || `https://s3.${config.region || "us-west-004"}.backblazeb2.com`;
      this.region = config.region || "us-west-004";
    } else if (config.protocol === "gcs") {
      this.endpoint = config.endpoint || "https://storage.googleapis.com";
      this.region = config.region || "auto";
    } else if (config.protocol === "wasabi") {
      this.endpoint = config.endpoint || `https://s3.${config.region || "us-east-1"}.wasabisys.com`;
      this.region = config.region || "us-east-1";
    } else if (config.protocol === "do-spaces") {
      this.endpoint = config.endpoint || `https://${config.region || "nyc3"}.digitaloceanspaces.com`;
      this.region = config.region || "nyc3";
    } else if (config.protocol === "minio") {
      this.endpoint = config.endpoint;
      this.region = config.region || "us-east-1";
    } else {
      this.endpoint = config.endpoint || `https://s3.${config.region || "us-east-1"}.amazonaws.com`;
      this.region = config.region || "us-east-1";
    }
  }

  getProtocol() { return this.config.protocol || "s3"; }

  getDisplayName() {
    const names = {
      r2: "Cloudflare R2",
      s3: "Amazon S3",
      b2: "Backblaze B2",
      gcs: "Google Cloud Storage",
      wasabi: "Wasabi",
      "do-spaces": "DigitalOcean Spaces",
      minio: "MinIO",
    };
    return names[this.config.protocol] || "S3-Compatible";
  }

  async signRequest(method, path, queryParams = {}, headers = {}, body = "") {
    const { amzDate, dateStamp } = CryptoUtils.getAmzDate();
    const url = new URL(`${this.endpoint}${path}`);
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }

    const payloadHash = await CryptoUtils.sha256Hex(body || "");

    const signedHeaders = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...headers,
    };

    const sortedHeaderKeys = Object.keys(signedHeaders).sort();
    const canonicalHeaders = sortedHeaderKeys.map(k => `${k.toLowerCase()}:${signedHeaders[k].trim()}`).join("\n") + "\n";
    const signedHeaderStr = sortedHeaderKeys.map(k => k.toLowerCase()).join(";");

    const sortedQuery = [...url.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQuery = sortedQuery.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaderStr,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      await CryptoUtils.sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = await CryptoUtils.getSigningKey(this.secretAccessKey, dateStamp, this.region, this.service);
    const signature = CryptoUtils.toHex(await CryptoUtils.hmacSha256(signingKey, stringToSign));

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaderStr}, Signature=${signature}`;

    return {
      url: url.toString(),
      headers: {
        ...signedHeaders,
        Authorization: authorization,
      },
    };
  }

  async request(method, path, queryParams = {}, extraHeaders = {}, body = "") {
    const { url, headers } = await this.signRequest(method, path, queryParams, extraHeaders, body);
    const fetchOpts = { method, headers };
    if (body && method !== "GET" && method !== "HEAD") {
      fetchOpts.body = body;
    }
    const resp = await fetch(url, fetchOpts);
    if (!resp.ok) {
      const text = await resp.text();
      throw new StorageError(resp.status, text, method, path);
    }
    return resp;
  }

  async listObjects(prefix = "", delimiter = "/", continuationToken = null) {
    const params = { "list-type": "2", prefix };
    if (delimiter) params.delimiter = delimiter;
    if (continuationToken) params["continuation-token"] = continuationToken;
    const resp = await this.request("GET", `/${this.bucket}`, params);
    const xml = await resp.text();
    return this.parseListObjects(xml);
  }

  async uploadFile(key, file, onProgress = null) {
    const { amzDate, dateStamp } = CryptoUtils.getAmzDate();

    const arrayBuffer = await file.arrayBuffer();
    const payloadHash = await CryptoUtils.sha256Hex(new Uint8Array(arrayBuffer));

    const url = new URL(`${this.endpoint}/${this.bucket}/${encodeS3Key(key)}`);
    const signedHeaders = {
      "content-type": file.type || "application/octet-stream",
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };

    const sortedHeaderKeys = Object.keys(signedHeaders).sort();
    const canonicalHeaders = sortedHeaderKeys.map(k => `${k.toLowerCase()}:${signedHeaders[k].trim()}`).join("\n") + "\n";
    const signedHeaderStr = sortedHeaderKeys.map(k => k.toLowerCase()).join(";");

    const canonicalRequest = [
      "PUT",
      `/${this.bucket}/${encodeS3Key(key)}`,
      "",
      canonicalHeaders,
      signedHeaderStr,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      await CryptoUtils.sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = await CryptoUtils.getSigningKey(this.secretAccessKey, dateStamp, this.region, this.service);
    const signature = CryptoUtils.toHex(await CryptoUtils.hmacSha256(signingKey, stringToSign));
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaderStr}, Signature=${signature}`;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url.toString());

      for (const [k, v] of Object.entries(signedHeaders)) {
        xhr.setRequestHeader(k, v);
      }
      xhr.setRequestHeader("Authorization", authorization);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new StorageError(xhr.status, xhr.responseText, "PUT", key));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(file);
    });
  }

  async downloadFile(key, onProgress = null) {
    if (!onProgress) {
      const resp = await this.request("GET", `/${this.bucket}/${encodeS3Key(key)}`);
      return resp.blob();
    }

    const { url, headers } = await this.signRequest("GET", `/${this.bucket}/${encodeS3Key(key)}`);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.responseType = "blob";
      for (const [k, v] of Object.entries(headers)) {
        xhr.setRequestHeader(k, v);
      }
      xhr.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
        else if (e.loaded) onProgress(e.loaded, 0);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1, 1);
          resolve(xhr.response);
        } else {
          reject(new StorageError(xhr.status, "", "GET", key));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during download"));
      xhr.send();
    });
  }

  async deleteObject(key) {
    await this.request("DELETE", `/${this.bucket}/${encodeS3Key(key)}`);
  }

  async createFolder(prefix) {
    const key = prefix.endsWith("/") ? prefix : prefix + "/";
    await this.request("PUT", `/${this.bucket}/${encodeS3Key(key)}`, {}, { "content-type": "application/x-directory" }, "");
  }

  async copyObject(sourceKey, destKey) {
    const copySource = `/${this.bucket}/${sourceKey}`;
    await this.request("PUT", `/${this.bucket}/${encodeS3Key(destKey)}`, {}, { "x-amz-copy-source": copySource });
  }

  async renameObject(oldKey, newKey) {
    await this.copyObject(oldKey, newKey);
    await this.deleteObject(oldKey);
  }

  async headObject(key) {
    const resp = await this.request("HEAD", `/${this.bucket}/${encodeS3Key(key)}`);
    return {
      contentType: resp.headers.get("content-type"),
      contentLength: parseInt(resp.headers.get("content-length") || "0"),
      lastModified: resp.headers.get("last-modified"),
      etag: resp.headers.get("etag"),
    };
  }

  async testConnection() {
    await this.listObjects("", "/");
    return true;
  }

  parseListObjects(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");

    const folders = [];
    for (const cp of doc.querySelectorAll("CommonPrefixes")) {
      folders.push(cp.querySelector("Prefix")?.textContent || "");
    }

    const files = [];
    for (const c of doc.querySelectorAll("Contents")) {
      const key = c.querySelector("Key")?.textContent || "";
      if (key.endsWith("/")) continue;
      files.push({
        key,
        size: parseInt(c.querySelector("Size")?.textContent || "0"),
        lastModified: c.querySelector("LastModified")?.textContent || "",
        etag: c.querySelector("ETag")?.textContent || "",
      });
    }

    const isTruncated = doc.querySelector("IsTruncated")?.textContent === "true";
    const nextToken = doc.querySelector("NextContinuationToken")?.textContent || null;

    return { folders, files, isTruncated, nextToken };
  }

  getPublicUrl(key, customDomain = null) {
    if (customDomain) {
      const domain = customDomain.replace(/\/+$/, "");
      return `${domain}/${key}`;
    }
    return `${this.endpoint}/${this.bucket}/${key}`;
  }
}

class WebDAVClient extends StorageClient {
  constructor(config) {
    super(config);
    this.serverUrl = config.serverUrl.replace(/\/+$/, "");
    this.username = config.username || "";
    this.password = config.password || "";
    this.basePath = config.basePath || "/";
  }

  getProtocol() { return "webdav"; }
  getDisplayName() { return "WebDAV"; }

  _authHeaders() {
    const headers = {};
    if (this.username) {
      headers["Authorization"] = "Basic " + btoa(this.username + ":" + this.password);
    }
    return headers;
  }

  _resolvePath(path) {
    const base = this.basePath.replace(/\/+$/, "");
    if (!path) return base + "/";
    return base + "/" + path;
  }

  _fullUrl(path) {
    return this.serverUrl + this._resolvePath(path);
  }

  async testConnection() {
    const resp = await fetch(this._fullUrl(""), {
      method: "PROPFIND",
      headers: { ...this._authHeaders(), Depth: "0" },
    });
    if (!resp.ok) throw new StorageError(resp.status, await resp.text(), "PROPFIND", "/");
    return true;
  }

  async listObjects(prefix = "", delimiter = "/", continuationToken = null) {
    const url = this._fullUrl(prefix);
    const resp = await fetch(url, {
      method: "PROPFIND",
      headers: { ...this._authHeaders(), Depth: "1", "Content-Type": "application/xml" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>',
    });

    if (!resp.ok) throw new StorageError(resp.status, await resp.text(), "PROPFIND", prefix);

    const xml = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");

    const folders = [];
    const files = [];
    const basePath = this._resolvePath(prefix).replace(/\/+$/, "");
    const responses = doc.querySelectorAll("response, d\\:response, D\\:response");

    for (const r of responses) {
      const hrefEl = r.querySelector("href, d\\:href, D\\:href");
      if (!hrefEl) continue;
      let href = decodeURIComponent(hrefEl.textContent).replace(/\/+$/, "");
      if (href === basePath) continue;

      const name = href.split("/").pop();
      const isCollection = r.querySelector("collection, d\\:collection, D\\:collection");

      if (isCollection) {
        folders.push(prefix + name + "/");
      } else {
        const sizeEl = r.querySelector("getcontentlength, d\\:getcontentlength, D\\:getcontentlength");
        const modEl = r.querySelector("getlastmodified, d\\:getlastmodified, D\\:getlastmodified");
        const etagEl = r.querySelector("getetag, d\\:getetag, D\\:getetag");
        files.push({
          key: prefix + name,
          size: parseInt(sizeEl?.textContent || "0"),
          lastModified: modEl?.textContent || "",
          etag: etagEl?.textContent || "",
        });
      }
    }

    return { folders, files, isTruncated: false, nextToken: null };
  }

  async uploadFile(key, file, onProgress = null) {
    const url = this._fullUrl(key);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      const auth = this._authHeaders();
      for (const [k, v] of Object.entries(auth)) xhr.setRequestHeader(k, v);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new StorageError(xhr.status, xhr.responseText, "PUT", key));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(file);
    });
  }

  async downloadFile(key, onProgress = null) {
    if (!onProgress) {
      const resp = await fetch(this._fullUrl(key), { method: "GET", headers: this._authHeaders() });
      if (!resp.ok) throw new StorageError(resp.status, await resp.text(), "GET", key);
      return resp.blob();
    }

    const url = this._fullUrl(key);
    const auth = this._authHeaders();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.responseType = "blob";
      for (const [k, v] of Object.entries(auth)) xhr.setRequestHeader(k, v);
      xhr.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
        else if (e.loaded) onProgress(e.loaded, 0);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1, 1);
          resolve(xhr.response);
        } else {
          reject(new StorageError(xhr.status, "", "GET", key));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during download"));
      xhr.send();
    });
  }

  async deleteObject(key) {
    const resp = await fetch(this._fullUrl(key), {
      method: "DELETE",
      headers: this._authHeaders(),
    });
    if (!resp.ok) throw new StorageError(resp.status, await resp.text(), "DELETE", key);
  }

  async createFolder(prefix) {
    const path = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    const resp = await fetch(this._fullUrl(path), {
      method: "MKCOL",
      headers: this._authHeaders(),
    });
    if (!resp.ok && resp.status !== 405) {
      throw new StorageError(resp.status, await resp.text(), "MKCOL", path);
    }
  }

  async copyObject(sourceKey, destKey) {
    const resp = await fetch(this._fullUrl(sourceKey), {
      method: "COPY",
      headers: {
        ...this._authHeaders(),
        Destination: this._fullUrl(destKey),
        Overwrite: "F",
      },
    });
    if (!resp.ok) throw new StorageError(resp.status, await resp.text(), "COPY", sourceKey);
  }

  async renameObject(oldKey, newKey) {
    const resp = await fetch(this._fullUrl(oldKey), {
      method: "MOVE",
      headers: {
        ...this._authHeaders(),
        Destination: this._fullUrl(newKey),
        Overwrite: "F",
      },
    });
    if (!resp.ok) throw new StorageError(resp.status, await resp.text(), "MOVE", oldKey);
  }

  async headObject(key) {
    const resp = await fetch(this._fullUrl(key), {
      method: "HEAD",
      headers: this._authHeaders(),
    });
    if (!resp.ok) throw new StorageError(resp.status, "", "HEAD", key);
    return {
      contentType: resp.headers.get("content-type") || "application/octet-stream",
      contentLength: parseInt(resp.headers.get("content-length") || "0"),
      lastModified: resp.headers.get("last-modified") || "",
      etag: resp.headers.get("etag") || "",
    };
  }

  getPublicUrl(key, customDomain = null) {
    if (customDomain) {
      return customDomain.replace(/\/+$/, "") + "/" + key;
    }
    return this._fullUrl(key);
  }
}

class StorageError extends Error {
  constructor(status, body, method, path) {
    super(`${method} ${path} failed: ${status}`);
    this.status = status;
    this.body = body;
  }
}

function createStorageClient(config) {
  const protocol = config.protocol || "r2";
  const s3Protocols = ["r2", "s3", "b2", "gcs", "wasabi", "do-spaces", "minio", "s3-compatible"];
  if (s3Protocols.includes(protocol)) return new S3Client(config);
  if (protocol === "webdav") return new WebDAVClient(config);
  throw new Error(`Unsupported protocol: ${protocol}`);
}

function encodeS3Key(key) {
  return key.split("/").map(s => encodeURIComponent(s)).join("/");
}

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
