export interface DeletionKey {
  backspace: boolean;
  delete: boolean;
}

/**
 * Ink 6 reports the DEL byte (0x7f) produced by macOS Backspace as `delete`.
 * Herdr Prompts is currently macOS-only, so both names mean backward deletion.
 */
export function isBackwardDeletionKey(key: DeletionKey): boolean {
  return key.backspace || key.delete;
}
