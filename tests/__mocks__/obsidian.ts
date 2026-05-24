/**
 * Minimal Obsidian stub for unit tests.
 *
 * The real `obsidian` package is types-only (no JS entry point).  Vitest
 * can't resolve it at runtime, so vitest.config.ts aliases the module here.
 *
 * Only TFile needs a real class — tracker.ts uses `instanceof TFile` at
 * runtime.  App and WorkspaceLeaf are referenced only as TypeScript types,
 * so empty classes are enough to satisfy the import.
 */

export class TFile {
  path = '';
  extension = '';
  name = '';
  basename = '';
}

export class App {}

export class WorkspaceLeaf {}
