import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeAnchor, restoreAnchor, bendThrough, closestCurvePoint, magneticPosition } from '../../wwwroot/js/automaton-interaction.js';
import { edgeGeometry } from '../../wwwroot/js/automaton-geometry.js';

const state = (id, x, y) => ({ id, name: id, x, y, radius: 30 });
const edge = (controlX = 150, controlY = 80) => ({ sourceId: 'a', targetId: 'b', controlX, controlY, eventNames: ['go'], labelOffsetX: 20, labelOffsetY: -10 });
const near = (actual, expected, tolerance = .001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('moving and rotating endpoints preserves the curve in the endpoint frame', () => {
  const a = state('a', 0, 0), b = state('b', 300, 0), e = edge();
  const anchor = relativeAnchor(a, b, e);
  b.x = 0; b.y = 300;
  restoreAnchor(a, b, e, anchor);
  near(e.controlX, -80); near(e.controlY, 150);
  near(e.labelOffsetX, 10); near(e.labelOffsetY, 20);
  a.x += 75; a.y -= 40; b.x += 75; b.y -= 40;
  restoreAnchor(a, b, e, anchor);
  near(e.controlX, -5); near(e.controlY, 110);
});

test('a straight edge remains straight after an endpoint moves diagonally', () => {
  const a = state('a', 0, 0), b = state('b', 300, 0), e = edge(150, 0);
  const anchor = relativeAnchor(a, b, e);
  b.x = 350; b.y = 200; restoreAnchor(a, b, e, anchor);
  near(e.controlX, 175); near(e.controlY, 100);
  assert.match(edgeGeometry(a, b, e).path, / L /);
});

test('self loops translate rigidly with their state and preserve label placement', () => {
  const a = state('a', 100, 150), e = { ...edge(75, 10), targetId: 'a' };
  const anchor = relativeAnchor(a, a, e);
  const before = edgeGeometry(a, a, e).at(.5);
  a.x += 220; a.y += 80; restoreAnchor(a, a, e, anchor);
  const after = edgeGeometry(a, a, e).at(.5);
  near(after.x - before.x, 220); near(after.y - before.y, 80);
  near(e.labelOffsetX, 20); near(e.labelOffsetY, -10);
});

for (const t of [.25, .5, .75]) {
  test(`bending tracks the visible grabbed point at t=${t}`, () => {
    const a = state('a', 50, 80), b = state('b', 430, 200), e = edge(240, 190);
    const original = edgeGeometry(a, b, e).at(t), target = { x: original.x + 18, y: original.y + 55 };
    bendThrough(a, b, e, target, t);
    const actual = edgeGeometry(a, b, e).at(t);
    near(actual.x, target.x, .2); near(actual.y, target.y, .2);
    const geometry = edgeGeometry(a, b, e);
    near(Math.hypot(geometry.at(0).x - a.x, geometry.at(0).y - a.y), 31);
    near(Math.hypot(geometry.at(1).x - b.x, geometry.at(1).y - b.y), 31);
  });
}

test('a curved edge snaps straight near the chord and can bend to the opposite side', () => {
  const a = state('a', 0, 0), b = state('b', 300, 0), e = edge();
  bendThrough(a, b, e, { x: 150, y: 3 }, .5, 6);
  assert.match(edgeGeometry(a, b, e).path, / L /);
  bendThrough(a, b, e, { x: 150, y: -65 }, .5, 0);
  near(edgeGeometry(a, b, e).at(.5).y, -65, .1);
  assert.ok(e.controlY < 0);
});

test('loop dragging controls both orientation and size, with cardinal-angle snapping', () => {
  const a = state('a', 100, 100), e = { ...edge(100, -20), targetId: 'a' };
  bendThrough(a, a, e, { x: 280, y: 101 }, .5, 6);
  near(e.controlY, 100);
  near(edgeGeometry(a, a, e).at(.5).x, 280, .1);
});

test('alignment snapping does not force a coarse grid or snap to the moving state itself', () => {
  const a = state('a', 100, 100), b = state('b', 280, 230);
  assert.deepEqual(magneticPosition({ x: 143.4, y: 147.8 }, [a, b], 'a', 6).position, { x: 143.4, y: 147.8 });
  const aligned = magneticPosition({ x: 277, y: 234 }, [a, b], 'a', 6);
  assert.deepEqual(aligned.position, { x: 280, y: 230 });
  assert.equal(aligned.guideX, 280); assert.equal(aligned.guideY, 230);
  assert.deepEqual(magneticPosition({ x: 143.4, y: 147.8 }, [a, b], 'a', 6, true).position, { x: 140, y: 140 });
});

test('SVG coordinates exposed through prototype accessors remain usable when adding a state', () => {
  const point = Object.create({ get x() { return 123.5; }, get y() { return 84.25; } });
  assert.deepEqual(magneticPosition(point, [], null, 6).position, { x: 123.5, y: 84.25 });
});

test('closest-curve picking works on curved arrows rather than the invisible control point', () => {
  const a = state('a', 0, 0), b = state('b', 300, 0), e = edge();
  const onCurve = edgeGeometry(a, b, e).at(.7);
  const picked = closestCurvePoint(a, b, e, onCurve);
  near(picked.t, .7, .002);
  near(picked.point.x, onCurve.x, .2); near(picked.point.y, onCurve.y, .2);
});

test('coincident states never produce invalid geometry and separate normally again', () => {
  const a = state('a', 0, 0), b = state('b', 300, 0), e = edge();
  const anchor = relativeAnchor(a, b, e);
  b.x = 0; restoreAnchor(a, b, e, anchor);
  bendThrough(a, b, e, { x: 90, y: -100 });
  assert.ok(edgeGeometry(a, b, e).samples.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  b.x = 300; restoreAnchor(a, b, e, anchor);
  near(e.controlX, 150); near(e.controlY, 80);
});
