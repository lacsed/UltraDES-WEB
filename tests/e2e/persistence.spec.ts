import { test, expect } from '@playwright/test';

test('persists compact UltraDES JSON and restores workspace summaries', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try an example Load the Small Factory' }).click();
  await expect(page.getByRole('button', { name: 'M1 2 states · 2 events', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ultrades.workspace.v2')!));
  expect(saved.Automata).toHaveLength(3);
  const stored = saved.Automata.find((entry: { Json: string }) => JSON.parse(entry.Json)[0].name === 'M1');
  const [model] = JSON.parse(stored.Json);
  expect(model.states).toHaveLength(2);
  expect(model.events).toHaveLength(2);
  expect(model.transitions).toHaveLength(2);
  expect(model.states[model.initial_state].marking).toBe('marked');
  expect(stored.Json).not.toContain('\n');
  await page.reload();
  await expect(page.getByRole('button', { name: 'M1 2 states · 2 events', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'M1 2 states · 2 events', exact: true }).click();
  await expect(page.getByText('2 states · 2 events · 2 transitions', { exact: true })).toBeVisible();
});
