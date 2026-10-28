import { test, expect } from '@playwright/test';

test('loads the automata workspace and opens the Petri-net workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('main')).toBeVisible();
  await page.getByRole('group', { name: 'Modeling workspace' }).getByRole('link', { name: 'Petri nets' }).click();
  await expect(page).toHaveURL(/\/petri-nets$/);
  await expect(page.getByRole('heading', { name: 'Petri nets', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await page.getByRole('button', { name: 'Create first place' }).click();
  await page.getByPlaceholder('e.g. idle, busy').fill('idle');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete idle', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Delete idle', exact: true })).toBeVisible({ timeout: 30_000 });
});
