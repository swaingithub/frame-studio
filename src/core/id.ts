/** Collision-free id generator built on the Web Crypto UUID. */
export function newId(prefix = ''): string {
  return `${prefix}${crypto.randomUUID()}`
}
