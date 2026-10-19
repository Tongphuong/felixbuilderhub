// Calibration/bite driver: "builds" the page by loading the MOCK itself.
// Used to measure mock-vs-mock (must be ~0) and mock-vs-lightly-perturbed-mock.
// Perturbation comes from env DESIGN_PERTURB: "" (none) | "tiny" | "shift".
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export default async function mockSelf(page, contract, base, ctx) {
  const mock = path.resolve(ctx.designDir, contract.mock[String(ctx.width)]);
  await page.goto(pathToFileURL(mock).href, { waitUntil: 'load' });
  const mode = process.env.DESIGN_PERTURB || '';
  if (mode === 'tiny') await page.addStyleTag({ content: '.r2l{letter-spacing:.15px}' });
  else if (mode === 'shift') await page.addStyleTag({ content: '.r2l > div:nth-of-type(1){margin-top:6px}' });
}
