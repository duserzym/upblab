import { expect, test } from '@playwright/test';
import { installFakeTauri } from './fake-tauri';

for (const view of ['Home', 'Images']) {
  test(`${view} leaves the local database stopped until Sessions is opened`, async ({ page }) => {
    await page.addInitScript(installFakeTauri, { store: { mode: 'local', lastTab: view.toLowerCase() } });
    await page.goto('./');
    await expect(page.getByRole('tab', { name: view, exact: true })).toHaveAttribute('aria-selected', 'true');
    const starts = () => page.evaluate(() => (window as unknown as { __fake: { calls: [string, unknown][] } })
      .__fake.calls.filter(([name]) => name === 'local_service_start').length);
    expect(await starts()).toBe(0);
    await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
    await expect.poll(starts).toBe(1);
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
    expect(await starts()).toBe(1);
  });
}
