// Encrypts OAuth tokens at rest (AES-256-GCM) using a key that lives only
// in env vars, never in Supabase. Protects against a DB export/leak or a
// compromised service-role key yielding usable Google Calendar access —
// RLS alone doesn't help here since the service role bypasses RLS anyway.
//
// TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key. Generate one
// with: openssl rand -base64 32

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // standard for GCM
const PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set — cannot encrypt OAuth tokens.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes. Generate one with: openssl rand -base64 32'
    );
  }
  return key;
}

export function encryptToken(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
}

// Tokens written before this feature shipped are still plaintext in the DB
// — recognized by the missing PREFIX and returned as-is (no key needed for
// that path) rather than erroring, so existing connections keep working
// until they're naturally rewritten (next refresh or reconnect), at which
// point encryptToken() upgrades them.
export function decryptToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;

  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = stored.slice(PREFIX.length).split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
