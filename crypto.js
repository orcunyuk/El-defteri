// Şifreleme: Parola → PBKDF2 → anahtar sarmalama (AES-KW) → veri anahtarı (AES-GCM 256)
const enc = new TextEncoder();
const dec = new TextDecoder();
export const ITERATIONS = 310000;

export const randBytes = n => crypto.getRandomValues(new Uint8Array(n));

async function deriveKek(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

// Veri anahtarını verilen parolayla sarmalar; kasaya yazılacak nesneyi döndürür.
export async function wrapWith(dek, password) {
  const salt = randBytes(16);
  const kek = await deriveKek(password, salt, ITERATIONS);
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', dek, kek, 'AES-KW'));
  return { salt, iterations: ITERATIONS, wrapped };
}

export async function createVault(password) {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const vault = await wrapWith(dek, password);
  const key = await openVault(password, vault);
  return { vault, key };
}

// Parola yanlışsa null döner (AES-KW bütünlük kontrolü başarısız olur).
export async function openVault(password, vault, extractable = false) {
  const kek = await deriveKek(password, vault.salt, vault.iterations);
  try {
    return await crypto.subtle.unwrapKey('raw', vault.wrapped, kek, 'AES-KW',
      { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

export async function encBytes(key, buf) {
  const iv = randBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf);
  return { iv, data };
}
export const decBytes = (key, iv, data) => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);

export const encJSON = (key, obj) => encBytes(key, enc.encode(JSON.stringify(obj)));
export const decJSON = async (key, iv, data) => JSON.parse(dec.decode(await decBytes(key, iv, data)));

export function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export const vaultToJSON = v => ({ salt: b64(v.salt), iterations: v.iterations, wrapped: b64(v.wrapped) });
export const vaultFromJSON = v => ({ salt: unb64(v.salt), iterations: v.iterations, wrapped: unb64(v.wrapped) });
