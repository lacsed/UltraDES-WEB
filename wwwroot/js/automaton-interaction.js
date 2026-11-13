/* Relative-anchor/grab-offset interaction inspired by FSM Designer (madebyevan.com/fsm/).
 * Copyright (c) 2010 Evan Wallace. MIT License:
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE. See also THIRD_PARTY_NOTICES.md.
 */
import { edgeGeometry, radiusOf } from './automaton-geometry.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;
const plus = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const minus = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const times = (a, k) => ({ x: a.x * k, y: a.y * k });
const length = p => Math.hypot(p.x, p.y);
const frame = (a, b, fallback = { x: 1, y: 0 }) => {
    const delta = minus(b, a), distance = length(delta);
    const u = distance > .001 ? times(delta, 1 / distance) : fallback;
    return { u, n: { x: -u.y, y: u.x }, distance };
};

export function relativeAnchor(a, b, edge) {
    const control = { x: edge.controlX, y: edge.controlY };
    const offset = { x: edge.labelOffsetX || 0, y: edge.labelOffsetY || 0 };
    if (a.id === b.id) return { loop: true, control: minus(control, a), offset };
    const { u, n, distance } = frame(a, b);
    const delta = minus(control, a);
    return { loop: false, parallel: distance > .001 ? dot(delta, u) / distance : .5,
        perpendicular: dot(delta, n), labelAlong: dot(offset, u), labelNormal: dot(offset, n), direction: u };
}

export function restoreAnchor(a, b, edge, anchor) {
    if (anchor.loop) {
        edge.controlX = a.x + anchor.control.x; edge.controlY = a.y + anchor.control.y;
        edge.labelOffsetX = anchor.offset.x; edge.labelOffsetY = anchor.offset.y;
        return;
    }
    const { u, n, distance } = frame(a, b, anchor.direction);
    const control = plus(a, plus(times(u, distance * anchor.parallel), times(n, anchor.perpendicular)));
    const offset = plus(times(u, anchor.labelAlong), times(n, anchor.labelNormal));
    edge.controlX = control.x; edge.controlY = control.y;
    edge.labelOffsetX = offset.x; edge.labelOffsetY = offset.y;
}

export function closestCurvePoint(a, b, edge, point) {
    const geometry = edgeGeometry(a, b, edge);
    let t = .5, distance = Infinity;
    for (let i = 0; i <= 32; i++) {
        const candidate = i / 32, d = length(minus(geometry.at(candidate), point));
        if (d < distance) { distance = d; t = candidate; }
    }
    let low = Math.max(.15, t - 1 / 32), high = Math.min(.85, t + 1 / 32);
    if (low > high) low = high = Math.max(.15, Math.min(.85, t));
    for (let i = 0; i < 12; i++) {
        const left = (2 * low + high) / 3, right = (low + 2 * high) / 3;
        if (length(minus(geometry.at(left), point)) < length(minus(geometry.at(right), point))) high = right;
        else low = left;
    }
    t = (low + high) / 2;
    return { t, point: geometry.at(t) };
}

export function bendThrough(a, b, edge, target, t = .5, snapTolerance = 0) {
    const delta = minus(b, a), distance = length(delta);
    if (a.id === b.id || distance < .001) {
        const relative = minus(target, a);
        let angle = Math.atan2(relative.y, relative.x);
        const quarter = Math.round(angle / (Math.PI / 2)) * Math.PI / 2;
        if (snapTolerance > 0 && Math.abs(angle - quarter) < .09) angle = quarter;
        // The midpoint of this cubic is .75 * extent + .25 * radius * cos(.65).
        const extent = Math.max(radiusOf(a) + 75, (length(relative) - (radiusOf(a) + 1) * Math.cos(.65) * .25) / .75);
        edge.controlX = a.x + Math.cos(angle) * extent; edge.controlY = a.y + Math.sin(angle) * extent;
        return;
    }
    const { u, n } = frame(a, b);
    const along = dot(minus(target, a), u), perpendicular = dot(minus(target, a), n);
    if (distance > radiusOf(a) + radiusOf(b) + 12 && along > 0 && along < distance && Math.abs(perpendicular) <= snapTolerance) {
        edge.controlX = (a.x + b.x) / 2; edge.controlY = (a.y + b.y) / 2;
        return;
    }
    // Solve for the *visible point* being dragged, including clipping at the circles.
    // A raw Bezier control point would move about twice as far as the visible curve.
    for (let iteration = 0; iteration < 12; iteration++) {
        const current = edgeGeometry(a, b, edge).at(t), error = minus(target, current);
        if (length(error) < .03) break;
        const epsilon = .5;
        const gx = edgeGeometry(a, b, { ...edge, controlX: edge.controlX + epsilon }).at(t);
        const gy = edgeGeometry(a, b, { ...edge, controlY: edge.controlY + epsilon }).at(t);
        const jx = times(minus(gx, current), 1 / epsilon), jy = times(minus(gy, current), 1 / epsilon);
        const determinant = jx.x * jy.y - jy.x * jx.y;
        let step = Math.abs(determinant) > .00001
            ? { x: (error.x * jy.y - jy.x * error.y) / determinant, y: (jx.x * error.y - error.x * jx.y) / determinant }
            : times(error, 1 / Math.max(.1, 2 * t * (1 - t)));
        const limit = Math.max(150, distance * 2);
        if (length(step) > limit) step = times(step, limit / length(step));
        edge.controlX += step.x; edge.controlY += step.y;
    }
}

export function magneticPosition(raw, states, exceptId, tolerance, grid = false) {
    const position = grid ? { x: Math.round(raw.x / 20) * 20, y: Math.round(raw.y / 20) * 20 } : { x: raw.x, y: raw.y };
    let bestX = tolerance, bestY = tolerance, guideX = null, guideY = null;
    for (const state of states) {
        if (state.id === exceptId) continue;
        const dx = Math.abs(raw.x - state.x), dy = Math.abs(raw.y - state.y);
        if (dx < bestX) { bestX = dx; position.x = state.x; guideX = state.x; }
        if (dy < bestY) { bestY = dy; position.y = state.y; guideY = state.y; }
    }
    return { position, guideX, guideY };
}
