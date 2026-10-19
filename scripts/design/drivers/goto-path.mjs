// Plain driver: navigate to base + contract.built.path and do nothing else (no login, NO state
// verification). Used by the harness's own bite tests, whose synthetic pages are not a real app.
// Do not use it for real screens: the default driver is the one that verifies states.
export default async function gotoPath(page, contract, base) {
  await page.goto(base + contract.built.path, { waitUntil: 'load' });
}
