// Keep these geometry rules aligned with AutomatonLayoutGeometry.cs: candidate scoring uses the same paths and label boxes.
const columns = 26;
const rowWidth = 260;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const unit = a => Math.hypot(a.x, a.y) < .001 ? { x: 1, y: 0 } : mul(a, 1 / Math.hypot(a.x, a.y));
const quadratic = (a, c, b, t) => add(add(mul(a, (1 - t) ** 2), mul(c, 2 * t * (1 - t))), mul(b, t * t));
const cubic = (a, c1, c2, b, t) => add(add(mul(a, (1 - t) ** 3), mul(c1, 3 * (1 - t) ** 2 * t)), add(mul(c2, 3 * (1 - t) * t * t), mul(b, t ** 3)));
const pointText = p => `${p.x} ${p.y}`;

// Evaluate the true extrema, rather than the polyline samples used for scoring.
export function bezierBounds(points) {
    const at = points.length === 4 ? t => cubic(...points, t)
        : points.length === 3 ? t => quadratic(...points, t)
        : t => add(points[0], mul(sub(points[1], points[0]), t));
    const parameters = [0, 1];
    for (const axis of ['x', 'y']) {
        const p = points.map(point => point[axis]);
        if (p.length === 3) {
            const denominator = p[0] - 2 * p[1] + p[2];
            if (Math.abs(denominator) > 1e-10) parameters.push((p[0] - p[1]) / denominator);
        } else if (p.length === 4) {
            const a = -p[0] + 3 * p[1] - 3 * p[2] + p[3], b = 2 * (p[0] - 2 * p[1] + p[2]), c = p[1] - p[0];
            if (Math.abs(a) < 1e-10) { if (Math.abs(b) > 1e-10) parameters.push(-c / b); }
            else {
                const discriminant = b * b - 4 * a * c;
                if (discriminant >= 0) parameters.push((-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a));
            }
        }
    }
    const extrema = parameters.filter(t => t >= 0 && t <= 1).map(at);
    const left = Math.min(...extrema.map(p => p.x)), top = Math.min(...extrema.map(p => p.y));
    return { x: left, y: top, width: Math.max(...extrema.map(p => p.x)) - left, height: Math.max(...extrema.map(p => p.y)) - top };
}

export function textLines(value) {
    const chars = Array.from(value || '');
    return Array.from({ length: Math.max(1, Math.ceil(chars.length / columns)) }, (_, i) => chars.slice(i * columns, (i + 1) * columns).join(''));
}
const textWidth = value => Array.from(value).reduce((width, c) => width + (c.codePointAt(0) >= 0x2E80 ? 18 : 9), 0);
export function stateRadius(name) {
    const lines = textLines(name);
    return Math.max(30, Math.ceil(Math.hypot(Math.max(...lines.map(textWidth)) / 2 + 9, lines.length * 9 + 7)));
}
export const radiusOf = state => Math.max(state.radius || 30, stateRadius(state.name));

export function labelLayout(events) {
    const rows = [];
    let row = { chips: [], width: 0, height: 0 };
    for (const name of events) {
        const lines = textLines(name);
        const chip = { name, lines, width: Math.max(24, Math.max(...lines.map(textWidth)) + 14), height: lines.length * 18 + 8 };
        if (row.width && row.width + 5 + chip.width > rowWidth) { rows.push(row); row = { chips: [], width: 0, height: 0 }; }
        row.width += (row.width ? 5 : 0) + chip.width;
        row.height = Math.max(row.height, chip.height);
        row.chips.push(chip);
    }
    if (row.chips.length) rows.push(row);
    return { rows, width: Math.max(0, ...rows.map(r => r.width)), height: rows.reduce((height, r) => height + r.height, 0) + Math.max(0, rows.length - 1) * 5 };
}

export function edgeGeometry(a, b, edge) {
    const control = { x: edge.controlX, y: edge.controlY };
    const layout = labelLayout(edge.eventNames || edge.events || []);
    let path, label, samples, at, curve, endTangent;
    if (a.id === b.id || Math.hypot(b.x - a.x, b.y - a.y) < .001) {
        const u = unit(sub(control, a)), normal = { x: -u.y, y: u.x };
        const radius = radiusOf(a) + 1;
        const extent = Math.max(radiusOf(a) + 75, Math.hypot(control.x - a.x, control.y - a.y));
        const base = add(a, mul(u, radius * Math.cos(.65)));
        const start = add(base, mul(normal, radius * Math.sin(.65))), end = sub(base, mul(normal, radius * Math.sin(.65)));
        const c1 = add(add(a, mul(u, extent)), mul(normal, extent * .75)), c2 = sub(add(a, mul(u, extent)), mul(normal, extent * .75));
        path = `M ${pointText(start)} C ${pointText(c1)} ${pointText(c2)} ${pointText(end)}`;
        const clearance = Math.abs(u.x) * layout.width / 2 + Math.abs(u.y) * layout.height / 2 + 8;
        label = add(cubic(start, c1, c2, end, .5), mul(u, clearance));
        at = t => cubic(start, c1, c2, end, t);
        curve = [start, c1, c2, end]; endTangent = sub(end, c2);
        samples = Array.from({ length: 13 }, (_, i) => at(i / 12));
    } else {
        const chord = sub(b, a), normal = unit({ x: -chord.y, y: chord.x });
        const cross = chord.x * (control.y - a.y) - chord.y * (control.x - a.x);
        const straight = Math.abs(cross) / Math.max(1, Math.hypot(chord.x, chord.y)) < 7;
        const start = add(a, mul(straight ? unit(chord) : unit(sub(control, a)), radiusOf(a) + 1));
        const end = add(b, mul(straight ? mul(unit(chord), -1) : unit(sub(control, b)), radiusOf(b) + 1));
        path = straight ? `M ${pointText(start)} L ${pointText(end)}` : `M ${pointText(start)} Q ${pointText(control)} ${pointText(end)}`;
        const clearance = Math.abs(normal.x) * layout.width / 2 + Math.abs(normal.y) * layout.height / 2 + 7;
        label = add(straight ? mul(add(start, end), .5) : quadratic(start, control, end, .5), mul(normal, (!straight && cross < 0 ? -1 : 1) * clearance));
        at = t => straight ? add(start, mul(sub(end, start), t)) : quadratic(start, control, end, t);
        curve = straight ? [start, end] : [start, control, end]; endTangent = sub(end, straight ? start : control);
        samples = Array.from({ length: 13 }, (_, i) => at(i / 12));
    }
    label = add(label, { x: edge.labelOffsetX || 0, y: edge.labelOffsetY || 0 });
    return { path, label, handle: control, samples, labelLayout: layout, at, bounds: bezierBounds(curve), endTangent };
}

export function drawingBounds(states, transitions, initialStateId, margin = 12) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    const include = (box, stroke = 0) => {
        left = Math.min(left, box.x - stroke / 2); top = Math.min(top, box.y - stroke / 2);
        right = Math.max(right, box.x + box.width + stroke / 2); bottom = Math.max(bottom, box.y + box.height + stroke / 2);
    };
    // Matches the editor's marker: viewBox="0 -5 10 10", refX=9,
    // markerWidth=markerHeight=8, markerUnits=strokeWidth.
    const arrow = (end, tangent, stroke) => {
        const u = unit(tangent), n = { x: -u.y, y: u.x }, scale = .8 * stroke;
        for (const [x, y] of [[-9, -5], [1, 0], [-9, 5]]) {
            const p = add(end, add(mul(u, x * scale), mul(n, y * scale)));
            include({ ...p, width: 0, height: 0 });
        }
    };
    const byId = new Map(states.map(state => [state.id, state]));
    for (const state of states) {
        const radius = radiusOf(state);
        include({ x: state.x - radius, y: state.y - radius, width: radius * 2, height: radius * 2 }, 3);
    }
    for (const edge of transitions) {
        const g = edgeGeometry(byId.get(edge.sourceId), byId.get(edge.targetId), edge);
        include(g.bounds, 2.5); arrow(g.at(1), g.endTangent, 2.5);
        if (g.labelLayout.rows.length) include({ x: g.label.x - g.labelLayout.width / 2, y: g.label.y - g.labelLayout.height / 2,
            width: g.labelLayout.width, height: g.labelLayout.height }, 2);
    }
    const initial = byId.get(initialStateId);
    if (initial) {
        const radius = radiusOf(initial), end = { x: initial.x - radius - 1, y: initial.y };
        include({ x: initial.x - radius - 45, y: initial.y, width: 44, height: 0 }, 3);
        arrow(end, { x: 1, y: 0 }, 3);
    }
    if (!Number.isFinite(left)) return { x: 0, y: 0, width: margin * 2, height: margin * 2 };
    return { x: left - margin, y: top - margin, width: right - left + margin * 2, height: bottom - top + margin * 2 };
}
