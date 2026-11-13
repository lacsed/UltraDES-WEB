import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ viewport: { width: 1440, height: 1000 } });

for (const offset of [{ x: -1600, y: -1100 }, { x: 1900, y: 1300 }]) {
  test(`SVG export fits and centers the complete drawing independently of pan and zoom at (${offset.x}, ${offset.y})`, async ({ page }, testInfo) => {
    const model = [{ name: 'Export bounds', initial_state: 0,
      states: [0, 1].map(id => ({ id, name: `q${id}`, marking: id ? 'unmarked' : 'marked' })),
      events: ['a_long_transition_label', 'return', 'wait'].map((name, id) => ({ id, name, controllability: id === 1 ? 'uncontrollable' : 'controllable' })),
      transitions: [{ origin: 0, trigger: 0, destination: 1 }, { origin: 1, trigger: 1, destination: 0 }, { origin: 0, trigger: 2, destination: 0 }] }];
    const layout = { CanvasWidth: 900, CanvasHeight: 600, Zoom: 1, PanX: offset.x, PanY: offset.y,
      States: [{ State: 'q0', X: offset.x + 100, Y: offset.y + 250 }, { State: 'q1', X: offset.x + 450, Y: offset.y + 250 }],
      Transitions: [
        { Source: 'q0', Target: 'q1', Events: ['a_long_transition_label'], ControlX: offset.x + 280, ControlY: offset.y + 450, LabelOffsetX: 350, LabelOffsetY: -300 },
        { Source: 'q1', Target: 'q0', Events: ['return'], ControlX: offset.x + 280, ControlY: offset.y + 80 },
        { Source: 'q0', Target: 'q0', Events: ['wait'], ControlX: offset.x - 120, ControlY: offset.y + 40, LabelOffsetX: -260, LabelOffsetY: 60 }
      ] };
    await page.addInitScript(({ model, layout }) => localStorage.setItem('ultrades.workspace.v2', JSON.stringify({ Version: 2, States: [], Events: [],
      Automata: [{ Id: 'bounds-fixture', Json: JSON.stringify(model), Layout: layout }] })), { model, layout });
    await page.goto('/');
    await page.getByRole('button', { name: 'Export bounds 2 states · 3 events', exact: true }).click();
    await page.getByRole('button', { name: 'Visual layout Open or arrange the visual model', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Visual Layout/ }), svg = dialog.locator('svg');
    await expect(dialog.locator('.visual-state')).toHaveCount(2);
    const download = async (name: string) => {
      const pending = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export SVG', exact: true }).click();
      const file = await pending;
      await file.saveAs(testInfo.outputPath(name));
      return readFile(testInfo.outputPath(name), 'utf8');
    };
    const before = await download('before.svg');
    const originalPaths = await svg.locator('.visual-transition > path:not(.transition-hit-area)').evaluateAll(paths => paths.map(p => p.getAttribute('d')));
    const originalView = await svg.getAttribute('viewBox');
    const area = await svg.boundingBox();
    const start = { x: area!.x + area!.width - 35, y: area!.y + 120 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x - 440, start.y + 170, { steps: 12 }); await page.mouse.up();
    await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(originalView);
    const pannedView = await svg.getAttribute('viewBox');
    await page.mouse.wheel(0, -800);
    await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(pannedView);
    const movedView = await svg.getAttribute('viewBox');
    const after = await download('after.svg');
    expect(after).toBe(before);
    expect(await svg.getAttribute('viewBox')).toBe(movedView);
    expect(await svg.locator('.visual-transition > path:not(.transition-hit-area)').evaluateAll(paths => paths.map(p => p.getAttribute('d')))).toEqual(originalPaths);

    const rendered = await page.evaluate(async source => {
      const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
      const root = xml.documentElement;
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] > 10) {
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
        return { width: canvas.width, height: canvas.height, viewBox: root.getAttribute('viewBox'),
          margins: [left, top, canvas.width - right - 1, canvas.height - bottom - 1],
          states: root.querySelectorAll('.visual-state').length, labels: root.querySelectorAll('.transition-label').length,
          controls: root.querySelectorAll('.transition-control,.transition-guide,.alignment-guide,.transition-preview,.is-selected').length };
      } finally { URL.revokeObjectURL(url); }
    }, after);
    expect(rendered.viewBox).toBe(`0 0 ${rendered.width} ${rendered.height}`);
    expect(rendered.states).toBe(2); expect(rendered.labels).toBe(3); expect(rendered.controls).toBe(0);
    for (const margin of rendered.margins) { expect(margin).toBeGreaterThanOrEqual(10); expect(margin).toBeLessThanOrEqual(15); }
    expect(Math.abs(rendered.margins[0] - rendered.margins[2])).toBeLessThanOrEqual(2);
    expect(Math.abs(rendered.margins[1] - rendered.margins[3])).toBeLessThanOrEqual(2);
    await testInfo.attach('centered-svg', { body: Buffer.from(after), contentType: 'image/svg+xml' });
  });
}
