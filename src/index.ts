// Placeholder action entry point.
//
// Phase 1 (this phase): re-exports the pure-logic library so `ncc build src/index.ts -o dist`
//   produces a non-empty dist/index.js — this wires the dist-drift CI gate from day 1.
//
// Phase 2: this file will be REPLACED with the real action handler that:
//   - reads $GITHUB_EVENT_PATH
//   - calls bot-filter / event-router / mentions / marker / blocks
//   - performs chat.postMessage and pulls.update
//
// Per D-19, the file path and bundle target stay constant across phases.

export * from './lib/index.js';
