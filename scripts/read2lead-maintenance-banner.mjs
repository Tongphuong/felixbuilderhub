import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Normal releases remove the old overlay. An emergency overlay is opt-in only.
// No runtime bindings, application scripts, accounts or stored data are changed.
const args = process.argv.slice(2);
const enable = args.includes('--enable');
const paths = args.filter(arg => !arg.startsWith('--'));
if (args.some(arg => arg.startsWith('--') && arg !== '--enable') || paths.length > 1 || args.filter(arg => arg === '--enable').length > 1) throw new Error('Usage: node read2lead-maintenance-banner.mjs [directory] [--enable]');
const root = resolve(paths[0] || 'dist');
const marker = 'id="r2l-maintenance-notice"';
const banner = `<aside id="r2l-maintenance-notice" role="region" aria-label="Thông báo bảo trì" lang="vi" style="position:relative;z-index:2147483647;display:block;box-sizing:border-box;width:100%;padding:28px 20px 30px;background:#fef3c7;color:#422006;border-bottom:6px solid #f59e0b;text-align:center;font-family:system-ui,sans-serif;isolation:isolate"><strong style="display:block;font-size:clamp(28px,4.5vw,52px);font-weight:900;line-height:1.2;letter-spacing:.01em">WEBSITE ĐANG BẢO TRÌ</strong><p style="margin:14px auto 0;max-width:850px;font-size:clamp(17px,2vw,22px);line-height:1.5">Coach Felix đang nâng cấp Read2Lead.<br>Vui lòng quay lại sau. Cảm ơn bạn đã chờ!</p></aside>`;
let changed = 0;
let existing = 0;
let scanned = 0;
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const original = await readFile(path, 'utf8');
      scanned++;
      if (!enable) {
        const html = original.replace(/<aside\b(?=[^>]*\sid\s*=\s*(["'])r2l-maintenance-notice\1)[^>]*>[\s\S]*?<\/aside>/gi, '');
        if (html !== original) { await writeFile(path, html); changed++; }
        continue;
      }
      // The seasonal modal otherwise dims the maintenance notice on first visit.
      // Its existing client code safely returns when this dialog is absent.
      const html = original.replace(/<dialog\b[^>]*\bid="honors-broadcast"[^>]*>[\s\S]*?<\/dialog>/gi, '');
      if (html.includes(marker)) {
        if (html !== original) await writeFile(path, html);
        existing++; continue;
      }
      if (!/<body\b[^>]*>/i.test(html)) throw new Error(`Missing body: ${path}`);
      await writeFile(path, html.replace(/<body\b[^>]*>/i, opening => opening + banner));
      changed++;
    }
  }
}
await visit(root);
if (!scanned) throw new Error('No HTML pages found');
console.log(JSON.stringify({ root, mode: enable ? 'enabled' : 'removed', scanned, changed, existing }));
