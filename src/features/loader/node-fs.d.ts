/** Minimal Node fs declarations for the integration tests (the app itself stays browser-only). */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): Uint8Array;
}
