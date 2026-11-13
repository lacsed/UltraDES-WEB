import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function model(name: string, count: number, edges: Array<[number, number, string, boolean]>) {
  return [{ name, initial_state: 0,
    states: Array.from({ length: count }, (_, id) => ({ id, name: `q${id}`, marking: id % 2 === 0 ? 'marked' : 'unmarked' })),
    events: edges.map(([, , event, controllable], id) => ({ id, name: event, controllability: controllable ? 'controllable' : 'uncontrollable' })),
    transitions: edges.map(([origin, destination], trigger) => ({ origin, destination, trigger })) }];
}

for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`hybrid layout preserves the model, supports strategies, undo and saved geometry on ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible({ timeout: 30_000 });
    const fixture = model('Diamond', 4, [[0, 1, 'left', true], [0, 2, 'right', true], [1, 3, 'finish_left', true], [2, 3, 'finish_right', false]]);
    await page.locator('#loadjson').setInputFiles({ name: 'diamond.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await page.getByRole('button', { name: 'Visual layout Open or arrange the visual model', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Visual Layout/ });
    await expect(dialog.locator('.visual-state')).toHaveCount(4, { timeout: 30_000 });
    await expect(dialog.locator('.visual-transition')).toHaveCount(4);
    await expect(dialog.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled();
    await expect(dialog.locator('.transition-label.is-uncontrollable')).toHaveAttribute('data-event-name', 'finish_right');
    const originalModel = await page.evaluate(() => JSON.parse(localStorage.getItem('ultrades.workspace.v2')!).Automata[0].Json);
    const geometry = () => dialog.locator('svg').evaluate(svg => ({
      nodes: Array.from(svg.querySelectorAll('.visual-state')).map(g => ({ name: g.textContent, circle: g.querySelector('circle')!.outerHTML })),
      paths: Array.from(svg.querySelectorAll('.visual-transition > path:not(.transition-hit-area)')).map(p => p.getAttribute('d')),
      labels: Array.from(svg.querySelectorAll('.transition-label')).map(g => g.outerHTML),
      viewBox: svg.getAttribute('viewBox')
    }));
    const initial = await geometry();

    // Measure label/circle collisions on the DOM geometry that is actually rendered.
    const overlaps = await dialog.locator('svg').evaluate(svg => {
      const circles = Array.from(svg.querySelectorAll('.visual-state > circle:first-child')).map(c => ({ x: +(c.getAttribute('cx')!), y: +(c.getAttribute('cy')!), r: +(c.getAttribute('r')!) }));
      const boxes = Array.from(svg.querySelectorAll<SVGGraphicsElement>('.transition-label')).map(g => g.getBBox());
      let hits = 0;
      for (const c of circles) for (const box of boxes) {
        const x = Math.max(box.x, Math.min(c.x, box.x + box.width));
        const y = Math.max(box.y, Math.min(c.y, box.y + box.height));
        if (Math.hypot(c.x - x, c.y - y) < c.r) hits++;
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) hits++;
      }
      return hits;
    });
    expect(overlaps).toBe(0);
    const labelPixels = await dialog.locator('.transition-label text').first().evaluate(text => {
      const transform = text.getScreenCTM()!;
      return 14 * Math.hypot(transform.a, transform.b);
    });
    expect(labelPixels).toBeGreaterThan(viewport.name === 'mobile' ? 8 : 12);

    await dialog.getByLabel('Layout strategy', { exact: true }).selectOption('Circular');
    await dialog.getByRole('button', { name: 'Auto layout', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Layout ready. Save to keep this arrangement, or use Undo layout.', { timeout: 30_000 });
    const circular = await geometry();
    await dialog.getByLabel('Layout strategy', { exact: true }).selectOption('Layered');
    await dialog.getByRole('button', { name: 'Auto layout', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Auto layout', exact: true })).toBeEnabled({ timeout: 30_000 });
    expect(await geometry()).not.toEqual(circular);
    await dialog.getByRole('button', { name: 'Undo layout', exact: true }).click();
    expect(await geometry()).toEqual(circular);
    await expect(dialog.getByRole('button', { name: 'Undo layout', exact: true })).toBeDisabled();

    const svgDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export SVG', exact: true }).click();
    const downloaded = await svgDownload;
    await downloaded.saveAs(testInfo.outputPath('layout.svg'));
    const drawing = await readFile(testInfo.outputPath('layout.svg'), 'utf8');
    expect(drawing).toContain('finish_right');
    expect(drawing).toContain('is-uncontrollable');
    expect(drawing).toContain('monospace');
    await testInfo.attach('layout-preview', { body: await dialog.locator('.visual-canvas-shell').screenshot(), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await dialog.getByRole('button', { name: 'Save Layout', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ultrades.workspace.v2')!).Automata[0].Json)).toBe(originalModel);
    await page.getByRole('button', { name: 'Visual layout Open or arrange the visual model', exact: true }).click();
    await expect(dialog.locator('.visual-state')).toHaveCount(4);
    expect(await geometry()).toEqual(circular);
    expect(initial.nodes.map(n => n.name).sort()).toEqual(circular.nodes.map(n => n.name).sort());
  });
}

test('regular preview and SVG export use the same hybrid geometry, including loops and grouped labels', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible({ timeout: 30_000 });
  const edges: Array<[number, number, string, boolean]> = [
    [0, 1, 'out', true], [0, 1, 'out_auxiliary', true], [1, 0, 'back', false], [0, 0, 'wait', true], [1, 2, 'finish', false]
  ];
  await page.locator('#loadjson').setInputFiles({ name: 'loops.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model('Loops', 3, edges))) });
  await page.getByRole('button', { name: 'Show automaton Render the state-transition graph', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Loops', exact: true });
  await expect(dialog.locator('.visual-state')).toHaveCount(3, { timeout: 30_000 });
  await expect(dialog.locator('.visual-transition')).toHaveCount(4);
  await expect(dialog.locator('.transition-label')).toHaveCount(5);
  const loop = dialog.locator('.visual-transition').filter({ has: page.locator('[data-event-name="wait"]') });
  await expect(loop.locator('path:not(.transition-hit-area)')).toHaveAttribute('d', / C /);
  const promise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save as SVG', exact: true }).click();
  const file = await promise;
  expect(file.suggestedFilename()).toBe('Loops.svg');
  await file.saveAs(testInfo.outputPath('Loops.svg'));
  const source = await readFile(testInfo.outputPath('Loops.svg'), 'utf8');
  const paths = await dialog.locator('.visual-transition > path').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  for (const path of paths) expect(source).toContain(path);
  await testInfo.attach('preview-loops', { body: await dialog.locator('.automaton-preview').screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Visual layout Open or arrange the visual model', exact: true }).click();
  const editor = page.getByRole('dialog', { name: /Visual Layout/ });
  await expect(editor.locator('.visual-state')).toHaveCount(3);
  const tikzDownload = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'Export TikZ', exact: true }).click();
  const tikz = await tikzDownload;
  await tikz.saveAs(testInfo.outputPath('Loops.tex'));
  const tex = await readFile(testInfo.outputPath('Loops.tex'), 'utf8');
  expect(tex).toContain('.. controls');
  expect(tex).toContain('out\\_auxiliary');
  expect(tex).toContain('draw=red');
});

test('a newly drawn automaton keeps its automatic layout when created', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New visual automaton' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a Visual Automaton', exact: true });
  await dialog.getByLabel('Automaton name', { exact: true }).fill('Draft layout');
  const canvas = dialog.locator('.visual-editor-canvas svg');
  await expect(canvas).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await dialog.getByTitle(i === 0 ? 'Add initial state' : 'Add state', { exact: true }).click();
    await canvas.click({ position: { x: 140 + i * 180, y: 180 + (i % 2) * 90 } });
    await page.keyboard.type(`q${i}`);
  }
  for (let i = 0; i < 2; i++) {
    await dialog.getByTitle('Add transition', { exact: true }).click();
    await dialog.locator('.visual-state').filter({ hasText: `q${i}` }).locator('circle').first().click();
    await dialog.locator('.visual-state').filter({ hasText: `q${i + 1}` }).locator('circle').first().click();
    await page.keyboard.type(i === 0 ? 'go' : 'done');
  }
  await dialog.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Layout ready. Save to keep this arrangement, or use Undo layout.');
  const positions = () => page.locator('.visual-state > circle:first-child').evaluateAll(nodes => nodes.map(node => [node.getAttribute('cx'), node.getAttribute('cy'), node.getAttribute('r')]));
  const arranged = await positions();
  await dialog.getByRole('button', { name: 'Create Automaton', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Visual layout Open or arrange the visual model', exact: true }).click();
  await expect(page.locator('.visual-state')).toHaveCount(3);
  expect(await positions()).toEqual(arranged);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ultrades.workspace.v2')!).Automata[0]);
  expect(JSON.parse(saved.Json).length).toBe(1);
  expect(JSON.parse(saved.Json)[0].transitions).toHaveLength(2);
  expect(saved.Layout.Transitions.map((edge: { Source: string }) => edge.Source).sort()).toEqual(['q0', 'q1']);
});

test('cyclic graph with chords reduces crossings without curves cutting through states', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible({ timeout: 30_000 });
  const edges: Array<[number, number, string, boolean]> = Array.from({ length: 12 }, (_, i) =>
    [[i, (i + 1) % 12, `next${i}`, true], [i, (i + 5) % 12, `jump${i}`, false]] as Array<[number, number, string, boolean]>).flat();
  await page.locator('#loadjson').setInputFiles({ name: 'chords.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model('Chord cycle', 12, edges))) });
  await page.getByRole('button', { name: 'Show automaton Render the state-transition graph', exact: true }).click();
  const drawing = page.getByRole('dialog', { name: 'Chord cycle', exact: true }).locator('.automaton-preview');
  await expect(drawing.locator('.visual-state')).toHaveCount(12, { timeout: 30_000 });
  await expect(drawing.locator('.transition-label')).toHaveCount(24);
  const hits = await drawing.evaluate(host => {
    const circles = Array.from(host.querySelectorAll('.visual-state')).map(g => {
      const circle = g.querySelector('circle')!;
      return { id: g.getAttribute('data-state-id'), x: +circle.getAttribute('cx')!, y: +circle.getAttribute('cy')!, r: +circle.getAttribute('r')! };
    });
    let hits = 0;
    for (const group of host.querySelectorAll('.visual-transition')) {
      const path = group.querySelector('path') as SVGPathElement;
      for (const state of circles) {
        if ([group.getAttribute('data-source-id'), group.getAttribute('data-target-id')].includes(state.id)) continue;
        const length = path.getTotalLength();
        for (let i = 0; i <= 100; i++) {
          const p = path.getPointAtLength(length * i / 100);
          if (Math.hypot(p.x - state.x, p.y - state.y) < state.r + 1) { hits++; break; }
        }
      }
    }
    return hits;
  });
  expect(hits).toBe(0);
  await testInfo.attach('chord-cycle', { body: await drawing.screenshot(), contentType: 'image/png' });
});
