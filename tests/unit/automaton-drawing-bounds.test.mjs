import test from 'node:test';
import assert from 'node:assert/strict';
import { bezierBounds, drawingBounds, edgeGeometry } from '../../wwwroot/js/automaton-geometry.js';

test('Bezier bounds use the curve extrema rather than the control polygon', () => {
  assert.deepEqual(bezierBounds([{ x: 0, y: 0 }, { x: 50, y: 200 }, { x: 100, y: 0 }]), { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(bezierBounds([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }]), { x: 0, y: 0, width: 100, height: 75 });
  assert.deepEqual(bezierBounds([{ x: 100, y: -10 }, { x: -20, y: 40 }]), { x: -20, y: -10, width: 120, height: 50 });
});

test('a single initial state includes the initial arrow and stroke with only a small margin', () => {
  assert.deepEqual(drawingBounds([{ id: 'q0', name: 'q0', x: 0, y: 0 }], [], 'q0'), { x: -88.5, y: -43.5, width: 132, height: 87 });
});

const states = [{ id: 'q0', name: 'q0', x: -1300, y: -700 }, { id: 'q1', name: 'q1', x: -950, y: -560 }];
const transitions = [
  { sourceId: 'q0', targetId: 'q1', controlX: -1200, controlY: -1000, eventNames: ['a long event name'], labelOffsetX: 600, labelOffsetY: -300 },
  { sourceId: 'q0', targetId: 'q0', controlX: -1550, controlY: -980, eventNames: ['wait'], labelOffsetX: -250, labelOffsetY: 30 }
];

test('off-canvas states, rotated loops and displaced labels are all inside the drawing bounds', () => {
  const bounds = drawingBounds(states, transitions, 'q0');
  const inside = (x, y) => {
    assert.ok(x >= bounds.x + 10 && x <= bounds.x + bounds.width - 10);
    assert.ok(y >= bounds.y + 10 && y <= bounds.y + bounds.height - 10);
  };
  for (const edge of transitions) {
    const geometry = edgeGeometry(states.find(q => q.id === edge.sourceId), states.find(q => q.id === edge.targetId), edge);
    for (let i = 0; i <= 1000; i++) { const p = geometry.at(i / 1000); inside(p.x, p.y); }
    inside(geometry.label.x - geometry.labelLayout.width / 2, geometry.label.y - geometry.labelLayout.height / 2);
    inside(geometry.label.x + geometry.labelLayout.width / 2, geometry.label.y + geometry.labelLayout.height / 2);
  }
});

test('translating the whole drawing changes only the bounds origin', () => {
  const before = drawingBounds(states, transitions, 'q0');
  const dx = 7000, dy = 4200;
  const after = drawingBounds(states.map(q => ({ ...q, x: q.x + dx, y: q.y + dy })), transitions.map(edge => ({ ...edge, controlX: edge.controlX + dx, controlY: edge.controlY + dy })), 'q0');
  assert.ok(Math.abs(after.x - before.x - dx) < 1e-9);
  assert.ok(Math.abs(after.y - before.y - dy) < 1e-9);
  assert.ok(Math.abs(after.width - before.width) < 1e-9);
  assert.ok(Math.abs(after.height - before.height) < 1e-9);
});

test('an empty drawing has a finite minimal page', () => {
  assert.deepEqual(drawingBounds([], [], null), { x: 0, y: 0, width: 24, height: 24 });
});
