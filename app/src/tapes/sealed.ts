// The Tapes' sealed pack: the learner's study material, locked with their own
// password (PBKDF2-SHA256 then AES-256-GCM) so it can sit on the public site
// as noise. Only the password opens it; it is never in the code or the repo.
//
// Sealed file:  "PHITAPES" | version u8 | iterations u32 | salt 16 | iv 12 | ciphertext
// Opened body:  "PTB1" | header length u32 | header JSON | clip bytes
//   header = { pack: Pack, clips: [key, offset, length, type][] } (offsets into the clip bytes)

import type { Pack, RawClip } from './pack';

const MAGIC = 'PHITAPES';
const BODY = 'PTB1';
export const SEALED_PATH = 't/tapes-1.dat';

export class WrongPassword extends Error {}
export class NotSealed extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function keyFor(password: string, salt: Uint8Array, iterations: number, use: KeyUsage): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [use]);
}

export interface Opened {
  pack: Pack;
  clips: { key: string; blob: Blob }[];
}

/** Build the plain body from a parsed pack and its clips (bytes already decoded). */
export function packBody(pack: Pack, clips: { key: string; bytes: Uint8Array; type: string }[]): Uint8Array {
  let off = 0;
  const index = clips.map((c) => {
    const row = [c.key, off, c.bytes.length, c.type] as const;
    off += c.bytes.length;
    return row;
  });
  const header = enc.encode(JSON.stringify({ pack, clips: index }));
  const out = new Uint8Array(4 + 4 + header.length + off);
  out.set(enc.encode(BODY), 0);
  new DataView(out.buffer).setUint32(4, header.length);
  out.set(header, 8);
  let at = 8 + header.length;
  for (const c of clips) {
    out.set(c.bytes, at);
    at += c.bytes.length;
  }
  return out;
}

export async function seal(body: Uint8Array, password: string, iterations = 400_000): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, iterations, 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body as BufferSource));
  const out = new Uint8Array(8 + 1 + 4 + 16 + 12 + ct.length);
  out.set(enc.encode(MAGIC), 0);
  out[8] = 1;
  new DataView(out.buffer).setUint32(9, iterations);
  out.set(salt, 13);
  out.set(iv, 29);
  out.set(ct, 41);
  return out;
}

/** Open a sealed pack with the password. Throws WrongPassword or NotSealed. */
export async function unseal(sealed: ArrayBuffer, password: string): Promise<Opened> {
  const u = new Uint8Array(sealed);
  if (u.length < 41 || dec.decode(u.subarray(0, 8)) !== MAGIC || u[8] !== 1) throw new NotSealed('not a sealed pack');
  const iterations = new DataView(sealed).getUint32(9);
  const key = await keyFor(password, u.slice(13, 29), iterations, 'decrypt');
  let body: ArrayBuffer;
  try {
    body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(29, 41) }, key, u.subarray(41));
  } catch {
    throw new WrongPassword('wrong password');
  }
  return openBody(body);
}

export function openBody(body: ArrayBuffer): Opened {
  const b = new Uint8Array(body);
  if (dec.decode(b.subarray(0, 4)) !== BODY) throw new NotSealed('not a pack body');
  const len = new DataView(body).getUint32(4);
  const header = JSON.parse(dec.decode(b.subarray(8, 8 + len))) as { pack: Pack; clips: [string, number, number, string][] };
  const base = 8 + len;
  return {
    pack: header.pack,
    clips: header.clips.map(([key, off, n, type]) => ({ key, blob: new Blob([b.subarray(base + off, base + off + n)], { type }) })),
  };
}

/** A data: URL's bytes and type (used when sealing). */
export function dataUrlBytes(c: RawClip): { key: string; bytes: Uint8Array; type: string } {
  const comma = c.dataUrl.indexOf(',');
  const type = c.dataUrl.slice(5, c.dataUrl.indexOf(';'));
  const bin = atob(c.dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { key: c.key, bytes, type };
}
