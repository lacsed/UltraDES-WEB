import { test, expect } from '@playwright/test';

test('synthesizes a nonblocking monolithic supervisor and restores it after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try an example Load the Small Factory' }).click();
  await page.locator('button[aria-controls="operations"]').hover();
  await page.locator('#operations').getByRole('button', { name: 'Supervisor Synthesis', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a Supervisor', exact: true });
  const plants = dialog.locator('article').filter({ hasText: 'Plants' });
  const specs = dialog.locator('article').filter({ hasText: 'Specification' });
  await plants.getByLabel('Automaton M1', { exact: true }).check();
  await plants.getByLabel('Automaton M2', { exact: true }).check();
  await specs.getByLabel('Automaton E', { exact: true }).check();
  await dialog.getByLabel('Operation', { exact: true }).selectOption('mon');
  await dialog.getByRole('button', { name: 'Create supervisor', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Sup\(/ })).toBeVisible();
  await expect(page.getByText('6 states · 4 events · 8 transitions', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ultrades.workspace.v2')!));
  const model = saved.Automata.map((a: { Json: string }) => JSON.parse(a.Json)[0]).find((a: { name: string }) => a.name.startsWith('Sup('));
  expect(model.states).toHaveLength(6);
  expect(model.transitions).toHaveLength(8);
  expect(model.states.filter((s: { marking: string }) => s.marking === 'marked')).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: /Sup\(.*6 states · 4 events/ })).toBeVisible();
});
