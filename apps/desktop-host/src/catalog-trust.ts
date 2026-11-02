/** Release-pinned trust key for signed curated catalogue metadata.
 *
 * Rotated 2026-11-03: the previous signing key was lost in the backend server
 * migration, so the catalogue trust chain was rebuilt — a new Ed25519 keypair
 * was generated, the private half stays offline with the operator
 * (`C:\Users\Rover\.asterhub-catalog\`), and this public half pins the
 * catalogue in every release built from this commit on. Catalogues signed
 * with the retired key are rejected from now on. */
export const ASTERHUB_CATALOG_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAgFDzOJKXAwUfQa/azeqxWmDY6/zNRPuAt+RotFMSzpM=\n-----END PUBLIC KEY-----\n'
