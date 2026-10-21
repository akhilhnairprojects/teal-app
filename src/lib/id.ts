/**
 * RFC 4122 version-4 UUID from Math.random. Used only for idempotency keys (an activity's localId is
 * the server's client_id); it is not a security token, so no crypto dependency is needed.
 */
export function uuidv4(random: () => number = Math.random): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    let byte = Math.floor(random() * 256) & 0xff;
    if (i === 6) byte = (byte & 0x0f) | 0x40; // version 4
    if (i === 8) byte = (byte & 0x3f) | 0x80; // variant 10xx
    hex.push(byte.toString(16).padStart(2, '0'));
  }
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
