import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`downloads all automaton model and image formats on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'Try an example Load the Small Factory' }).click();
    if (viewport.name === 'mobile') {
      await page.getByRole('button', { name: 'All automata', exact: true }).click();
      await page.getByRole('button', { name: 'Export automaton M1', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'M1 2 states · 2 events', exact: true }).click();
      await page.getByRole('button', { name: 'Export Choose a model or drawing format', exact: true }).click();
    }
    const dialog = page.getByRole('dialog', { name: 'Export automaton', exact: true });
    await expect(dialog.getByLabel('Automaton', { exact: true })).toHaveValue('M1');

    for (const format of ['json', 'xml', 'ads', 'fsm', 'fm', 'wmod', 'dot', 'svg', 'png']) {
      await test.step(`download ${format}`, async () => {
        await dialog.getByLabel('Format', { exact: true }).selectOption(format);
        const downloadPromise = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Download file', exact: true }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe(`M1.${format}`);
        const file = testInfo.outputPath(`M1.${format}`);
        await download.saveAs(file);
        const bytes = await readFile(file);
        expect(bytes.length).toBeGreaterThan(20);
        const text = bytes.toString('utf8');
        if (format === 'json') {
          const [automaton] = JSON.parse(text);
          expect(automaton.name).toBe('M1');
          expect(automaton.states).toHaveLength(2);
          expect(automaton.transitions).toHaveLength(2);
          expect(automaton.events.map((e: { name: string }) => e.name).sort()).toEqual(['a1', 'b1']);
        }
        if (format === 'xml') expect(text).toContain('<Automaton Name="M1">');
        if (format === 'ads') expect(text).toContain('UltraDES ADS FILE');
        if (format === 'fsm') expect(text).toContain('a1\tq1\tc\to');
        if (format === 'fm') expect(text).toContain('(START) |- q0');
        if (format === 'wmod') {
          expect(text).toContain('Kind="PLANT" Name="M1"');
          expect(text).toContain('encoding="utf-8"');
        }
        if (format === 'dot') expect(text).toContain('digraph');
        if (format === 'svg') {
          expect(text).toContain('<svg');
          expect(text).toContain('q0');
          expect(await page.evaluate(svg => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror') === null, text)).toBe(true);
        }
        if (format === 'png') {
          expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
          expect(bytes.readUInt32BE(16)).toBeGreaterThan(0);
          expect(bytes.readUInt32BE(20)).toBeGreaterThan(0);
        }
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await expect(dialog.getByRole('status')).toHaveText('Download started.');
      });
    }

    await dialog.getByLabel('Format', { exact: true }).selectOption('wmod');
    await dialog.getByLabel('WMOD component role').selectOption('specification');
    const specDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download file', exact: true }).click();
    const spec = await specDownload;
    await spec.saveAs(testInfo.outputPath('M1-spec.wmod'));
    expect(await readFile(testInfo.outputPath('M1-spec.wmod'), 'utf8')).toContain('Kind="SPEC" Name="M1"');

    // All formats share the same automaton selector, and conversions leave the source intact.
    await dialog.getByLabel('Automaton', { exact: true }).selectOption('M2');
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await dialog.getByLabel('Format', { exact: true }).selectOption('json');
    const secondDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download file', exact: true }).click();
    const second = await secondDownload;
    expect(second.suggestedFilename()).toBe('M2.json');
    await second.saveAs(testInfo.outputPath('M2.json'));
    expect(JSON.parse(await readFile(testInfo.outputPath('M2.json'), 'utf8'))[0].events.map((e: { name: string }) => e.name).sort()).toEqual(['a2', 'b2']);

    await dialog.getByLabel('Automaton', { exact: true }).selectOption('M1');
    await expect(dialog.getByLabel('Format', { exact: true }).locator('option')).toHaveCount(9);
    await expect(dialog.getByLabel('Format', { exact: true })).not.toContainText('Structured Text');
  });
}

test('guards large image rendering and keeps DOT and combined WMOD export available', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible({ timeout: 30_000 });
  const states = Array.from({ length: 101 }, (_, id) => ({ id, name: `q${id}`, marking: id === 0 ? 'marked' : 'unmarked' }));
  const model = [{ name: 'Large', states, initial_state: 0,
    events: [{ id: 0, name: 'tick', controllability: 'controllable' }],
    transitions: states.map(({ id }) => ({ origin: id, trigger: 0, destination: (id + 1) % states.length })) }];
  await page.locator('#loadjson').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await page.getByRole('button', { name: 'Export Choose a model or drawing format', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export automaton', exact: true });
  await dialog.getByLabel('Format', { exact: true }).selectOption('svg');
  await dialog.getByRole('button', { name: 'Download file', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('exactly 101 states');
  await dialog.getByRole('button', { name: 'Cancel rendering', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByLabel('Format', { exact: true }).selectOption('dot');
  const dotPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download file', exact: true }).click();
  expect((await dotPromise).suggestedFilename()).toBe('Large.dot');

  await dialog.getByLabel('Format', { exact: true }).selectOption('wmod');
  await dialog.getByRole('button', { name: 'Export multiple automata as WMOD', exact: true }).click();
  const combined = page.getByRole('dialog', { name: 'Export Wmod', exact: true });
  await combined.getByRole('checkbox', { name: 'Automaton Large', exact: true }).first().check();
  const modulePromise = page.waitForEvent('download');
  await combined.getByRole('button', { name: 'Export', exact: true }).click();
  const module = await modulePromise;
  expect(module.suggestedFilename()).toBe('system.wmod');
  await module.saveAs(testInfo.outputPath('system.wmod'));
  const xml = await readFile(testInfo.outputPath('system.wmod'), 'utf8');
  expect(xml).toContain('Kind="PLANT" Name="Large"');
  expect(xml).toContain('encoding="utf-8"');
});
