import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { ScenarioEnvelope } from './types';

export const MODULES = ['scheduler', 'memory', 'deadlock', 'sync'] as const;
export type ModuleId = (typeof MODULES)[number];

/** Envelope -> URL-safe string for `#s=...`. */
export function encodeScenario(env: ScenarioEnvelope<ModuleId, unknown>): string {
  return compressToEncodedURIComponent(JSON.stringify(env));
}

/**
 * Inverse of encodeScenario. Returns null for anything malformed: a share link is untrusted input.
 * Only the envelope is checked here; each module validates its own params before running.
 */
export function decodeScenario(s: string): ScenarioEnvelope<ModuleId, unknown> | null {
  try {
    const json = decompressFromEncodedURIComponent(s);
    if (!json) return null;
    const env = JSON.parse(json);
    if (env?.v !== 1 || !MODULES.includes(env.module) || typeof env.params !== 'object' || env.params === null) return null;
    return env;
  } catch {
    return null;
  }
}
