class R2Client {
  constructor(config) {
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.accountId = config.accountId;
    this.bucket = config.bucket;
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.region = "auto";
    this.service = "s3";
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
      throw new R2Error(resp.status, text, method, path);
    }
    return resp;
  }

  async listBuckets() {
    const resp = await this.request("GET", "/");
    const xml = await resp.text();
    return this.parseListBuckets(xml);
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
        else reject(new R2Error(xhr.status, xhr.responseText, "PUT", key));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(file);
    });
  }

  async downloadFile(key) {
    const resp = await this.request("GET", `/${this.bucket}/${encodeS3Key(key)}`);
    return resp.blob();
  }

  async deleteObject(key) {
    await this.request("DELETE", `/${this.bucket}/${encodeS3Key(key)}`);
  }

  async deleteObjects(keys) {
    for (const key of keys) {
      await this.deleteObject(key);
    }
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

  parseListBuckets(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const buckets = [];
    for (const b of doc.querySelectorAll("Bucket")) {
      buckets.push({
        name: b.querySelector("Name")?.textContent || "",
        creationDate: b.querySelector("CreationDate")?.textContent || "",
      });
    }
    return buckets;
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

class R2Error extends Error {
  constructor(status, body, method, path) {
    super(`R2 ${method} ${path} failed: ${status}`);
    this.status = status;
    this.body = body;
  }
}

function encodeS3Key(key) {
  return key.split("/").map(s => encodeURIComponent(s)).join("/");
}

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
