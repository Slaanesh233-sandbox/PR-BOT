// Pure logic library barrel — Phase 1 (composed by Plan 01-03b).
//
// Importers (including `src/index.ts` and Phase 2's action handler) MUST go through this
// file — no deep imports from `src/lib/marker.js` etc. This keeps the public surface of
// the library in one place and lets the dist-drift CI gate (Plan 01-04) detect any
// accidental new export.
//
// NodeNext moduleResolution: TypeScript imports use the `.js` extension (the compiled
// output extension) even when the source file is `.ts`. This is correct ESM behavior.

export * from './types.js';
export * from './marker.js';
export * from './mentions.js';
export * from './bot-filter.js';
export * from './copy.js';
export * from './blocks.js';
export * from './event-router.js';
export * from './config-loader.js';
export * from './business-days.js';
