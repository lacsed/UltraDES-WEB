import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`generates and downloads supervised Structured Text on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const openOperations = async () => {
      if (viewport.name === 'mobile') await page.getByRole('button', { name: 'Options', exact: true }).click();
      else await page.getByRole('button', { name: /Operations/ }).first().hover();
    };
    await openOperations();
    const generate = page.getByRole('button', { name: 'Generate Structured Text', exact: true });
    await expect(generate).toBeDisabled();
    await page.getByRole('button', { name: 'Try an example Load the Small Factory' }).click();
    await openOperations();
    await expect(generate).toBeEnabled();
    await generate.click();

    const dialog = page.getByRole('dialog', { name: 'Generate Structured Text', exact: true });
    await dialog.getByRole('button', { name: 'Generate code', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Select at least one plant.');
    const plants = dialog.getByRole('group', { name: 'Plants', exact: true });
    const supervisors = dialog.getByRole('group', { name: 'Supervisors', exact: true });
    await plants.getByRole('checkbox', { name: 'M1', exact: false }).check();
    await dialog.getByRole('button', { name: 'Generate code', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Select at least one supervisor.');
    await plants.getByRole('checkbox', { name: 'M2', exact: false }).check();
    await plants.getByRole('checkbox', { name: 'E 2 states', exact: true }).check();
    await supervisors.getByRole('checkbox', { name: 'E 2 states', exact: true }).check();
    await expect(plants.getByRole('checkbox', { name: 'E 2 states', exact: true })).not.toBeChecked();

    await dialog.getByLabel('Program name', { exact: true }).fill('Factory_Control');
    await dialog.getByRole('button', { name: 'Generate code', exact: true }).click();
    const result = dialog.getByRole('region', { name: 'Structured Text result' });
    await expect(result).toContainText('2 plant(s), 1 supervisor(s), 4 event(s).');
    const source = await result.getByLabel('Generated Structured Text', { exact: true }).textContent();
    expect(source).toContain('PROGRAM PRG_Factory_Control');
    expect(source).toContain('TODO onState: actions while plant M1 is in state q0.');
    expect(source).toContain('TODO onControllableEvent: a2');
    expect(source).toContain('dis_E2_a2 := NOT ((S1_E_q = 0));');
    expect(source).not.toContain('dis_E3_b1');
    expect(source).toContain('S1_E_q : DINT := 0;');
    expect(source).not.toContain('FUNCTION_BLOCK');

    const downloadPromise = page.waitForEvent('download');
    await result.getByRole('button', { name: 'Download .st', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Factory_Control.st');
    const file = testInfo.outputPath('Factory_Control.st');
    await download.saveAs(file);
    expect(await readFile(file, 'utf8')).toBe(source);
    await testInfo.attach('structured-text-output', { path: file, contentType: 'text/plain' });
    await testInfo.attach('structured-text-preview', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    // An edited selection must not allow downloading an obsolete result.
    await plants.getByRole('checkbox', { name: 'M2', exact: false }).uncheck();
    await expect(result).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Download .st', exact: true })).toHaveCount(0);
  });
}
