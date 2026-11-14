import crypto from "node:crypto";

/**
 * Envelope crypto utility reversed from CloudStream 3 CNCVerse providers
 * (Cricify, LivXow, PlayZTV, SKTech, Sportzx, PlayFy).
 *
 * Payload structure:
 *  - Characters 0..10: Encrypted data part 1
 *  - Characters 10..34: Base64-encoded IV (16 bytes = 24 chars)
 *  - Characters 34..len-54: Encrypted data part 2
 *  - Characters len-54..len-10: Base64-encoded Key (32 bytes = 44 chars)
 *  - Characters len-10..: Encrypted data part 3
 *
 * Cipher: AES/CBC/PKCS5Padding (key size 256-bit or 128-bit)
 */
export class EnvelopeCrypto {
  /**
   * Decrypts an SC3 embedded-envelope ciphertext string.
   * If the content is already plaintext (e.g. starts with #EXTM3U) or too short, returns as-is.
   */
  static decryptContent(content: string): string {
    if (!content) return "";
    const trimmed = content.trim();

    // Check if content is already valid plaintext
    if (
      trimmed.startsWith("#EXTM3U") ||
      trimmed.startsWith("#EXTINF") ||
      trimmed.startsWith("#KODIPROP") ||
      trimmed.startsWith("{") ||
      trimmed.startsWith("[")
    ) {
      return trimmed;
    }

    if (trimmed.length < 79) {
      return trimmed;
    }

    try {
      const part1 = trimmed.substring(0, 10);
      const ivBase64 = trimmed.substring(10, 34);
      const part2 = trimmed.substring(34, trimmed.length - 54);
      const keyBase64 = trimmed.substring(trimmed.length - 54, trimmed.length - 10);
      const part3 = trimmed.substring(trimmed.length - 10);
      const encryptedData = part1 + part2 + part3;

      const iv = Buffer.from(ivBase64, "base64");
      const key = Buffer.from(keyBase64, "base64");
      const encrypted = Buffer.from(encryptedData, "base64");

      const algorithm = key.length === 32 ? "aes-256-cbc" : "aes-128-cbc";
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString("utf-8");
    } catch {
      return trimmed;
    }
  }

  /**
   * Encrypts a plaintext string into an SC3 embedded-envelope ciphertext string.
   */
  static encryptContent(plainText: string): string {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]).toString("base64");

    const ivBase64 = iv.toString("base64"); // 24 chars
    const keyBase64 = key.toString("base64"); // 44 chars

    const part1 = encrypted.substring(0, 10);
    const part2 = encrypted.substring(10, encrypted.length - 10);
    const part3 = encrypted.substring(encrypted.length - 10);

    return part1 + ivBase64 + part2 + keyBase64 + part3;
  }
}
