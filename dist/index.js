import './sourcemap-register.cjs';/******/ // The require scope
/******/ var __nccwpck_require__ = {};
/******/ 
/************************************************************************/
/******/ /* webpack/runtime/define property getters */
/******/ (() => {
/******/ 	// define getter functions for harmony exports
/******/ 	__nccwpck_require__.d = (exports, definition) => {
/******/ 		for(var key in definition) {
/******/ 			if(__nccwpck_require__.o(definition, key) && !__nccwpck_require__.o(exports, key)) {
/******/ 				Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 			}
/******/ 		}
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/hasOwnProperty shorthand */
/******/ (() => {
/******/ 	__nccwpck_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ })();
/******/ 
/******/ /* webpack/runtime/compat */
/******/ 
/******/ if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = new URL('.', import.meta.url).pathname.slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "/";
/******/ 
/************************************************************************/
var __webpack_exports__ = {};

// EXPORTS
__nccwpck_require__.d(__webpack_exports__, {
  V: () => (/* reexport */ __pr_bot_lib_placeholder__)
});

;// CONCATENATED MODULE: ./src/lib/index.ts
// Pure logic library barrel.
// Plan 03 will populate this with: export * from './marker.js'; export * from './mentions.js'; etc.
// Importers MUST go through this file — no deep imports from src/lib/marker.js etc.
//
// NodeNext moduleResolution: TypeScript imports use .js extension (the compiled output extension)
// even when the source file is .ts. This is correct ESM behavior.
const __pr_bot_lib_placeholder__ = true;

;// CONCATENATED MODULE: ./src/index.ts
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


var __webpack_exports___pr_bot_lib_placeholder_ = __webpack_exports__.V;
export { __webpack_exports___pr_bot_lib_placeholder_ as __pr_bot_lib_placeholder__ };

//# sourceMappingURL=index.js.map