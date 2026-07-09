// Turn an ES-module source string into something safe to drop into a *classic*
// (non-module) inline <script>. We keep the helper modules authored as real ESM
// (so they stay unit-testable via normal imports), then strip the leading
// `export` keyword when inlining them into lesson.astro's `<script is:inline>`
// blocks.
//
// History: lesson.astro used to do `.replace(/^export function /gm, 'function ')`
// inline, which only handled `export function`. When read2lead-book-flow.mjs
// gained its first `export const` (BOOK_READER_SCROLL_ANCHOR_ID, commit ff48675),
// that export leaked verbatim into a classic inline script and the browser threw
// `Unexpected token 'export'` — killing the entire book-flow helper block and
// blanking every book/comic reading pack. This helper strips every top-level
// `export` before a declaration keyword so that class of regression can't recur.
//
// Only declaration exports (`export function|const|let|var|class`, incl.
// `async function`) are stripped. `export { … }` / `export default` are left
// intact on purpose: they can't be trivially inlined, so leaving them to error
// loudly is the desired signal rather than a silent half-transform.
const DECLARATION_EXPORT = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm;

export function stripInlineExports(src) {
  return String(src).replace(DECLARATION_EXPORT, '');
}
