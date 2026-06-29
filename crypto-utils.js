const CryptoUtils = {
  async hmacSha256(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      typeof key === "string" ? new TextEncoder().encode(key) : key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return new Uint8Array(
      await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message))
    );
  },

  async sha256(data) {
    const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
    return new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  },

  toHex(buffer) {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, "0")).join("");
  },

  async sha256Hex(data) {
    return this.toHex(await this.sha256(data));
  },

  async getSigningKey(secretKey, dateStamp, region, service) {
    let key = await this.hmacSha256("AWS4" + secretKey, dateStamp);
    key = await this.hmacSha256(key, region);
    key = await this.hmacSha256(key, service);
    key = await this.hmacSha256(key, "aws4_request");
    return key;
  },

  getAmzDate() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
    const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
    return { amzDate: `${date}T${time}Z`, dateStamp: date };
  },

  async encryptData(plaintext, password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
    const result = new Uint8Array(salt.length + iv.length + ciphertext.length);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(ciphertext, salt.length + iv.length);
    return btoa(String.fromCharCode(...result));
  },

  async decryptData(ciphertextB64, password) {
    const enc = new TextEncoder();
    const data = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const ciphertext = data.slice(28);
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  }
};
