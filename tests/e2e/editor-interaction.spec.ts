import { test, expect, type Locator, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 1000 } });

const fixture = [{ name: 'Dragging', initial_state: 0,
  states: [0, 1, 2].map(id => ({ id, name: `q${id}`, marking: id === 0 ? 'marked' : 'unmarked' })),
  events: ['go', 'back', 'wait', 'side'].map((name, id) => ({ id, name, controllability: id === 1 ? 'uncontrollable' : 'controllable' })),
  transitions: [{ origin: 0, trigger: 0, destination: 1 }, { origin: 1, trigger: 1, destination: 0 }, { origin: 0, trigger: 2, destination: 0 }, { origin: 1, trigger: 3, destination: 2 }]
}];
const layout = { CanvasWidth: 900, CanvasHeight: 600, Zoom: 1, PanX: 0, PanY: 0,
  States: [{ State: 'q0', X: 180, Y: 220, Radius: 30 }, { State: 'q1', X: 520, Y: 220, Radius: 30 }, { State: 'q2', X: 520, Y: 420, Radius: 30 }],
  Transitions: [
    { Source: 'q0', Target: 'q1', Events: ['go'], ControlX: 350, ControlY: 290, LabelOffsetX: 12, LabelOffsetY: -6 },
    { Source: 'q1', Target: 'q0', Events: ['back'], ControlX: 350, ControlY: 150 },
    { Source: 'q0', Target: 'q0', Events: ['wait'], ControlX: 180, ControlY: 70 },
    { Source: 'q1', Target: 'q2', Events: ['side'], ControlX: 520, ControlY: 320 }
  ] };

async function openFixture(page: Page) {
  await page.addInitScript(({ fixture, layout }) => { if (!localStorage.getItem('ultrades.workspace.v2')) localStorage.setItem('ultrades.workspace.v2', JSON.stringify({ Version: 2, States: [], Events: [],
    Automata: [{ Id: 'drag-fixture', Json: JSON.stringify(fixture), Layout: layout }] })); }, { fixture, layout });
  await page.goto('/');
  if (page.viewportSize()!.width <= 600) await page.getByRole('button', { name: 'Select automaton Dragging', exact: true }).click();
  else await page.getByRole('button', { name: 'Dragging 3 states · 4 events', exact: true }).click();
  await page.getByRole('button', { name: 'Visual layout Open or arrange the visual model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Visual Layout/ });
  await expect(dialog.locator('.visual-state')).toHaveCount(3);
  return dialog;
}
const edge = (dialog: Locator, source: string, target: string) => dialog.locator(`.visual-transition[data-source-id="${source}"][data-target-id="${target}"]`);
const path = (group: Locator) => group.locator('path:not(.transition-hit-area)');
const circle = (dialog: Locator, id: string) => dialog.locator(`.visual-state[data-state-id="${id}"] > circle`).first();
async function center(node: Locator) {
  return node.evaluate(el => ({ x: +el.getAttribute('cx')!, y: +el.getAttribute('cy')! }));
}
async function client(svg: Locator, x: number, y: number) {
  return svg.evaluate((svg: SVGSVGElement, p) => { const q = svg.createSVGPoint(); q.x = p.x; q.y = p.y; const screen = q.matrixTransform(svg.getScreenCTM()!); return { x: screen.x, y: screen.y }; }, { x, y });
}
async function dragBy(page: Page, start: { x: number, y: number }, dx: number, dy: number, alt = true) {
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}
async function pathNumbers(group: Locator) {
  return (await path(group).getAttribute('d'))!.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
}

test('state dragging preserves the grab offset and the relative geometry of incoming, outgoing and loop arrows', async ({ page }) => {
  const dialog = await openFixture(page), svg = dialog.locator('svg');
  const source = circle(dialog, 'q0'), forward = edge(dialog, 'q0', 'q1');
  const otherPath = await path(edge(dialog, 'q1', 'q2')).getAttribute('d');
  const loopBefore = await pathNumbers(edge(dialog, 'q0', 'q0'));
  const start = await client(svg, 190, 215), end = await client(svg, 300, 280);
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y + 1);
  expect(await center(source)).toEqual({ x: 180, y: 220 });
  await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up(); await page.keyboard.up('Alt');
  const moved = await center(source);
  expect(moved.x).toBeCloseTo(290, 3); expect(moved.y).toBeCloseTo(285, 3);
  const numbers = await pathNumbers(forward), dx = 520 - moved.x, dy = 220 - moved.y, length = Math.hypot(dx, dy);
  const cx = numbers[2], cy = numbers[3];
  expect(((cx - moved.x) * dx + (cy - moved.y) * dy) / length ** 2).toBeCloseTo(.5, 4);
  expect((dx * (cy - moved.y) - dy * (cx - moved.x)) / length).toBeCloseTo(70, 3);
  const loopAfter = await pathNumbers(edge(dialog, 'q0', 'q0'));
  loopAfter.forEach((value, i) => expect(value - loopBefore[i]).toBeCloseTo(i % 2 === 0 ? 110 : 65, 3));
  expect(await path(edge(dialog, 'q1', 'q2')).getAttribute('d')).toBe(otherPath);
  await expect(dialog.locator('.transition-label.is-uncontrollable')).toHaveAttribute('data-event-name', 'back');
  await dialog.getByRole('button', { name: 'Save Layout', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ultrades.workspace.v2')!).Automata[0]);
  const normalize = (models: typeof fixture) => models.map(model => ({
    name: model.name, initial: model.states[model.initial_state].name,
    states: model.states.map(state => `${state.name}:${state.marking}`).sort(),
    events: model.events.map(event => `${event.name}:${event.controllability}`).sort(),
    transitions: model.transitions.map(edge => `${model.states[edge.origin].name}:${model.events[edge.trigger].name}:${model.states[edge.destination].name}`).sort()
  }));
  expect(normalize(JSON.parse(saved.Json))).toEqual(normalize(fixture));
  expect(saved.Layout.Transitions.find((e: { Source: string, Target: string }) => e.Source === 'q0' && e.Target === 'q1').ControlX).toBeCloseTo(cx, 3);
  const reopened = await openFixture(page);
  expect(await center(circle(reopened, 'q0'))).toEqual(moved);
  const reopenedPath = await pathNumbers(edge(reopened, 'q0', 'q1'));
  expect(reopenedPath[2]).toBeCloseTo(cx, 3); expect(reopenedPath[3]).toBeCloseTo(cy, 3);
});

test('the visible line and its on-curve handle can be dragged without jumping, and labels move separately', async ({ page }, testInfo) => {
  const dialog = await openFixture(page), svg = dialog.locator('svg'), group = edge(dialog, 'q0', 'q1');
  const start = await path(group).evaluate((path: SVGPathElement) => { const p = path.getPointAtLength(path.getTotalLength() * .3).matrixTransform(path.getScreenCTM()!); return { x: p.x, y: p.y }; });
  const beforeNodes = await dialog.locator('.visual-state > circle:first-child').evaluateAll(nodes => nodes.map(n => n.outerHTML));
  await dragBy(page, start, 16, 65);
  const distance = await path(group).evaluate((path: SVGPathElement, target) => {
    const transform = path.getScreenCTM()!, length = path.getTotalLength();
    return Math.min(...Array.from({ length: 501 }, (_, i) => { const p = path.getPointAtLength(length * i / 500).matrixTransform(transform); return Math.hypot(p.x - target.x, p.y - target.y); }));
  }, { x: start.x + 16, y: start.y + 65 });
  expect(distance).toBeLessThan(2);
  const handle = group.locator('.transition-control');
  await expect(handle).toBeVisible();
  const anchor = await center(handle), anchorClient = await client(svg, anchor.x, anchor.y);
  const originalPath = await path(group).getAttribute('d');
  await page.mouse.move(anchorClient.x, anchorClient.y); await page.mouse.down(); await page.mouse.up();
  expect(await path(group).getAttribute('d')).toBe(originalPath);
  await dragBy(page, anchorClient, -5, 35);
  const afterHandle = await center(handle), afterClient = await client(svg, afterHandle.x, afterHandle.y);
  expect(afterClient.x).toBeCloseTo(anchorClient.x - 5, 0); expect(afterClient.y).toBeCloseTo(anchorClient.y + 35, 0);
  expect(await dialog.locator('.visual-state > circle:first-child').evaluateAll(nodes => nodes.map(n => n.outerHTML))).toEqual(beforeNodes);

  const label = group.locator('.transition-label rect'), beforeLabel = await label.boundingBox();
  const pathBeforeLabel = await path(group).getAttribute('d');
  await dragBy(page, { x: beforeLabel!.x + beforeLabel!.width / 2, y: beforeLabel!.y + beforeLabel!.height / 2 }, 35, -25);
  const afterLabel = await label.boundingBox();
  expect(afterLabel!.x - beforeLabel!.x).toBeCloseTo(35, 0); expect(afterLabel!.y - beforeLabel!.y).toBeCloseTo(-25, 0);
  expect(await path(group).getAttribute('d')).toBe(pathBeforeLabel);
  const beforeMirror = await pathNumbers(group);
  await dialog.getByRole('button', { name: 'Mirror curve', exact: true }).click();
  const afterMirror = await pathNumbers(group);
  expect(afterMirror[3]).toBeCloseTo(440 - beforeMirror[3], 3);
  await dialog.getByRole('button', { name: 'Center label', exact: true }).click();
  await dialog.getByRole('button', { name: 'Straighten', exact: true }).click();
  await expect(path(group)).toHaveAttribute('d', / L /);
  await testInfo.attach('transition-editing', { body: await dialog.locator('.visual-canvas-shell').screenshot(), contentType: 'image/png' });
});

test('loop handles rotate and resize the loop; Escape cancels a move without closing the editor', async ({ page }) => {
  const dialog = await openFixture(page), svg = dialog.locator('svg'), loop = edge(dialog, 'q0', 'q0');
  const click = await path(loop).evaluate((path: SVGPathElement) => { const p = path.getPointAtLength(path.getTotalLength() * .5).matrixTransform(path.getScreenCTM()!); return { x: p.x, y: p.y }; });
  await page.mouse.click(click.x, click.y);
  const handle = loop.locator('.transition-control'), anchor = await center(handle), begin = await client(svg, anchor.x, anchor.y);
  const destination = await client(svg, 350, 220);
  await dragBy(page, begin, destination.x - begin.x, destination.y - begin.y);
  const moved = await center(handle);
  expect(moved.x).toBeCloseTo(350, 0); expect(moved.y).toBeCloseTo(220, 0);
  await dialog.getByRole('button', { name: 'Rotate loop', exact: true }).click();
  const rotated = await center(handle);
  expect(rotated.x).toBeCloseTo(180, 1); expect(rotated.y).toBeGreaterThan(330);
  const before = await center(circle(dialog, 'q0')), beforePath = await path(loop).getAttribute('d');
  const start = await client(svg, before.x, before.y);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 90, start.y + 40, { steps: 8 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(dialog).toBeVisible();
  expect(await center(circle(dialog, 'q0'))).toEqual(before);
  expect(await path(loop).getAttribute('d')).toBe(beforePath);
  await expect(dialog.locator('.alignment-guide')).toHaveCount(0);
  const viewport = await svg.getAttribute('viewBox'), empty = await client(svg, 750, 80);
  await page.mouse.move(empty.x, empty.y); await page.mouse.down();
  await page.mouse.move(empty.x - 40, empty.y + 30, { steps: 6 });
  expect(await svg.getAttribute('viewBox')).not.toBe(viewport);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await svg.getAttribute('viewBox')).toBe(viewport);
});

test('new drawing mode supports direct bending and background pan without changing transition symbols', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'New visual automaton' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a Visual Automaton', exact: true }), svg = dialog.locator('svg');
  await dialog.getByLabel('Automaton name').fill('Interactive');
  for (let i = 0; i < 2; i++) {
    await dialog.getByTitle(i ? 'Add state' : 'Add initial state', { exact: true }).click();
    await svg.click({ position: { x: 170 + i * 300, y: 200 } }); await page.keyboard.type(`q${i}`);
  }
  await dialog.getByTitle('Add transition', { exact: true }).click();
  await dialog.locator('.visual-state').filter({ hasText: 'q0' }).locator('circle').first().click();
  await dialog.locator('.visual-state').filter({ hasText: 'q1' }).locator('circle').first().click(); await page.keyboard.type('start');
  const group = dialog.locator('.visual-transition');
  const location = await path(group).evaluate((path: SVGPathElement) => { const p = path.getPointAtLength(path.getTotalLength() * .35).matrixTransform(path.getScreenCTM()!); return { x: p.x, y: p.y }; });
  await dragBy(page, location, 0, -55);
  await expect(path(group)).toHaveAttribute('d', / Q /);
  await expect(group.locator('.transition-label')).toHaveAttribute('data-event-name', 'start');
  const before = await svg.getAttribute('viewBox');
  const empty = await svg.boundingBox();
  await dragBy(page, { x: empty!.x + empty!.width - 30, y: empty!.y + 120 }, -45, -30);
  expect(await svg.getAttribute('viewBox')).not.toBe(before);
  await dialog.getByRole('button', { name: 'Create Automaton', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('ultrades.workspace.v2')!).Automata[0]);
  expect(JSON.parse(data.Json)[0].events[0].name).toBe('start');
  expect(JSON.parse(data.Json)[0].events[0].controllability).toBe('controllable');
});

test.describe('touch gestures', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('touch movement preserves connected arrows and cancellation restores the previous geometry', async ({ page }) => {
    const dialog = await openFixture(page), svg = dialog.locator('svg');
    const start = await client(svg, 180, 220), before = await center(circle(dialog, 'q0'));
    const session = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', x = start.x, y = start.y) => session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart'); await touch('touchMove', start.x + 35, start.y + 20); await touch('touchEnd');
    const moved = await center(circle(dialog, 'q0'));
    expect(moved.x).toBeGreaterThan(before.x + 30);
    const pathBefore = await path(edge(dialog, 'q0', 'q1')).getAttribute('d');
    const again = await client(svg, moved.x, moved.y);
    await touch('touchStart', again.x, again.y); await touch('touchMove', again.x + 25, again.y + 20); await touch('touchCancel');
    expect(await center(circle(dialog, 'q0'))).toEqual(moved);
    expect(await path(edge(dialog, 'q0', 'q1')).getAttribute('d')).toBe(pathBefore);
    await expect(dialog.getByRole('textbox', { name: 'Edit selected item' })).not.toBeFocused();
    await session.detach();
  });
});
