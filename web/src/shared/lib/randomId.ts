/** Also available on local-network HTTP, where crypto.randomUUID is unavailable. */
export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),
  (byte) => byte.toString(16).padStart(2, "0")).join("");
