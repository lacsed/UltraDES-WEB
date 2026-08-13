const NS = "http://www.w3.org/2000/svg";

export function createAutomatonEditor(host, layoutOnly = false) {
    const draft = { states: [], events: [], transitions: [], initialStateId: null };
    let selection = null, drag = null, preview = null, suppressNextDoubleClick = false, clickRenderTimer = null, lastClick = null;
    let viewport = { canvasWidth: 900, canvasHeight: 520, zoom: 1, panX: 0, panY: 0 };
    const svg = document.createElementNS(NS, "svg");
    const updateViewBox = () => svg.setAttribute("viewBox", `${viewport.panX} ${viewport.panY} ${viewport.canvasWidth / viewport.zoom} ${viewport.canvasHeight / viewport.zoom}`);
    updateViewBox();
    svg.setAttribute("aria-label", "Automaton diagram");
    host.append(svg);

    const point = event => { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const stateAt = id => draft.states.find(q => q.id === id);
    const edgeAt = id => draft.transitions.find(t => t.id === id);
    const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
    const svgElement = (name, attributes = {}) => { const element = document.createElementNS(NS, name); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value); return element; };

    function addStateAt(p, initial) {
        const state = { id: uid("state"), name: "", marked: false, x: p.x, y: p.y };
        draft.states.push(state);
        if (initial) draft.initialStateId = state.id;
        selection = { type: "state", id: state.id, replaceOnType: true };
        render();
    }

    function parseEvents(text) {
        return [...new Set(text.split(",").map(name => name.trim()).filter(Boolean))];
    }

    function commitTransition(edge) {
        if (!edge) return;
        const previous = new Map(draft.events.map(event => [event.name, event.controllable]));
        edge.eventNames = parseEvents(edge.text ?? edge.eventNames.join(", "));
        syncEvents(previous);
    }

    function commitSelection() {
        if (selection?.type === "transition") commitTransition(edgeAt(selection.id));
    }

    function syncEvents(controllability = new Map(draft.events.map(event => [event.name, event.controllable]))) {
        const used = new Set(draft.transitions.flatMap(t => t.eventNames).filter(Boolean));
        draft.events = [...used].map(name => ({
            id: draft.events.find(event => event.name === name)?.id ?? uid("event"),
            name,
            controllable: controllability.get(name) ?? true
        }));
    }

    function toggleControllability(edge) {
        commitTransition(edge);
        const makeControllable = edge.eventNames.some(name => draft.events.find(item => item.name === name)?.controllable === false);
        for (const name of edge.eventNames) {
            const item = draft.events.find(candidate => candidate.name === name);
            if (item) item.controllable = makeControllable;
        }
        selection = null;
    }

    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const pointToward = (from, to, amount) => { const length = distance(from, to) || 1; return { x: from.x + (to.x - from.x) * amount / length, y: from.y + (to.y - from.y) * amount / length }; };

    function edgeGeometry(edge) {
        const a = stateAt(edge.sourceId), b = stateAt(edge.targetId), control = { x: edge.controlX, y: edge.controlY };
        if (a.id === b.id) {
            const angle = Math.atan2(control.y - a.y, control.x - a.x);
            const center = { x: a.x + 48 * Math.cos(angle), y: a.y + 48 * Math.sin(angle) };
            const radius = 24, startAngle = angle - Math.PI * .8, endAngle = angle + Math.PI * .8;
            const start = { x: center.x + radius * Math.cos(startAngle), y: center.y + radius * Math.sin(startAngle) };
            const end = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) };
            const sweep = 1;
            return { path: `M ${start.x} ${start.y} A ${radius} ${radius} 0 1 ${sweep} ${end.x} ${end.y}`, label: { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }, handle: control };
        }
        const start = pointToward(a, control, 31), end = pointToward(b, control, 31);
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
        const bend = Math.abs(dx * (control.y - a.y) - dy * (control.x - a.x)) / length;
        if (bend < 7) {
            const label = { x: (start.x + end.x) / 2 - dy / length * 16, y: (start.y + end.y) / 2 + dx / length * 16 };
            return { path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, label, handle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        }
        return { path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`, label: control, handle: control };
    }

    function addTransitionLabel(group, edge, geometry, selected) {
        const labelGroup = svgElement("g", { class: "transition-label", "data-transition-id": edge.id });
        const text = svgElement("text", { x: geometry.label.x, y: geometry.label.y + 5, "text-anchor": "middle" });
        const value = selected ? (edge.text ?? edge.eventNames.join(", ")) : edge.eventNames.join(", ");
        text.textContent = selected ? `${value}\u00a0|` : value;
        labelGroup.append(text);
        group.append(labelGroup);
        if (!value && !selected) return;
        const width = Math.max(18, text.getComputedTextLength() + 14);
        const rect = svgElement("rect", { x: geometry.label.x - width / 2, y: geometry.label.y - 13, width, height: 26 });
        labelGroup.prepend(rect);
    }

    function render() {
        svg.replaceChildren();
        const defs = svgElement("defs");
        const marker = svgElement("marker", { id: "visual-arrow", viewBox: "0 -5 10 10", refX: "9", refY: "0", markerWidth: "8", markerHeight: "8", orient: "auto", markerUnits: "strokeWidth" });
        marker.append(svgElement("path", { class: "visual-arrow-head", d: "M 0 -5 L 10 0 L 0 5 z" })); defs.append(marker); svg.append(defs);

        for (const edge of draft.transitions) {
            const selected = selection?.type === "transition" && selection.id === edge.id;
            const uncontrollable = edge.eventNames.some(name => draft.events.find(event => event.name === name)?.controllable === false);
            const geometry = edgeGeometry(edge), group = svgElement("g", { class: `visual-transition${selected ? " is-selected" : ""}${uncontrollable ? " is-uncontrollable" : ""}` });
            group.append(svgElement("path", { class: "transition-hit-area", d: geometry.path, "data-transition-id": edge.id }));
            group.append(svgElement("path", { d: geometry.path, "marker-end": "url(#visual-arrow)", "data-transition-id": edge.id }));
            svg.append(group);
            addTransitionLabel(group, edge, geometry, selected);
            if (selected) group.append(svgElement("circle", { cx: geometry.handle.x, cy: geometry.handle.y, r: 6, class: "transition-control", "data-control-id": edge.id }));
        }
        if (draft.initialStateId) {
            const q = stateAt(draft.initialStateId);
            if (q) svg.append(svgElement("path", { d: `M ${q.x - 75} ${q.y} L ${q.x - 31} ${q.y}`, "marker-end": "url(#visual-arrow)", class: "initial-arrow" }));
        }
        for (const q of draft.states) {
            const group = svgElement("g", { class: `visual-state${selection?.type === "state" && selection.id === q.id ? " is-selected" : ""}`, "data-state-id": q.id });
            group.append(svgElement("circle", { cx: q.x, cy: q.y, r: 30 }));
            if (q.marked) group.append(svgElement("circle", { cx: q.x, cy: q.y, r: 24 }));
            const text = svgElement("text", { x: q.x, y: q.y + 5, "text-anchor": "middle" }); text.textContent = q.name; group.append(text); svg.append(group);
        }
        if (preview) svg.append(svgElement("path", { class: "transition-preview", d: `M ${preview.from.x} ${preview.from.y} L ${preview.to.x} ${preview.to.y}` }));
    }

    svg.addEventListener("pointerdown", event => {
        host.focus();
        const p = point(event), control = event.target.closest?.("[data-control-id]"), stateElement = event.target.closest?.("[data-state-id]"), edgeElement = event.target.closest?.("[data-transition-id]");
        const clickedObject = edgeElement ? `transition:${edgeElement.dataset.transitionId}` : stateElement ? `state:${stateElement.dataset.stateId}` : null;
        const isSecondClick = clickedObject && lastClick?.object === clickedObject && performance.now() - lastClick.time < 450;
        lastClick = clickedObject ? { object: clickedObject, time: performance.now() } : null;
        // Rendering replaces SVG children, so handle the second click before it
        // can replace the target that the browser needs to emit `dblclick`.
        if (!layoutOnly && (event.detail === 2 || isSecondClick) && (edgeElement || stateElement)) {
            lastClick = null;
            clearTimeout(clickRenderTimer); clickRenderTimer = null;
            if (edgeElement) toggleControllability(edgeAt(edgeElement.dataset.transitionId));
            else { const state = stateAt(stateElement.dataset.stateId); state.marked = !state.marked; }
            suppressNextDoubleClick = true; drag = null; render(); return;
        }
        if (selection && (!edgeElement || selection.id !== edgeElement.dataset.transitionId)) commitSelection();
        if (control) { selection = { type: "transition", id: control.dataset.controlId }; drag = { type: "control", id: control.dataset.controlId }; }
        else if (stateElement) { const createEdge = !layoutOnly && event.shiftKey; selection = { type: "state", id: stateElement.dataset.stateId }; drag = { type: createEdge ? "transition" : "state", id: stateElement.dataset.stateId, start: p }; }
        else if (edgeElement) { const edge = edgeAt(edgeElement.dataset.transitionId); edge.text ??= edge.eventNames.join(", "); selection = { type: "transition", id: edge.id }; }
        else { selection = null; drag = { type: "canvas", start: p, originX: viewport.panX, originY: viewport.panY }; }
        svg.setPointerCapture(event.pointerId);
        if (!layoutOnly && event.detail === 1 && (edgeElement || stateElement)) {
            clearTimeout(clickRenderTimer);
            clickRenderTimer = setTimeout(() => { clickRenderTimer = null; render(); }, 250);
        } else render();
    });

    svg.addEventListener("pointermove", event => {
        if (!drag) return;
        const p = point(event);
        if (drag.type === "state" && distance(p, drag.start) > 5) { const q = stateAt(drag.id); q.x = p.x; q.y = p.y; }
        if (drag.type === "transition" && distance(p, drag.start) > 5) preview = { from: stateAt(drag.id), to: p };
        if (drag.type === "canvas" && layoutOnly) { viewport.panX = drag.originX - (p.x - drag.start.x); viewport.panY = drag.originY - (p.y - drag.start.y); updateViewBox(); }
        if (drag.type === "control") { const edge = edgeAt(drag.id); edge.controlX = p.x; edge.controlY = p.y; }
        render();
    });

    svg.addEventListener("pointerup", event => {
        if (!drag) return;
        if (drag.type === "transition") {
            const releasePoint = point(event), target = draft.states.find(state => distance(state, releasePoint) <= 34);
            if (target) createTransition(drag.id, target.id);
        }
        drag = null; preview = null; host.focus(); render();
    });

    svg.addEventListener("dblclick", event => {
        if (layoutOnly) return;
        if (suppressNextDoubleClick) { suppressNextDoubleClick = false; return; }
        const p = point(event), edgeElement = event.target.closest?.("[data-transition-id]"), stateElement = event.target.closest?.("[data-state-id]");
        if (edgeElement) {
            toggleControllability(edgeAt(edgeElement.dataset.transitionId)); render();
        } else if (stateElement) { const q = stateAt(stateElement.dataset.stateId); q.marked = !q.marked; render(); }
        else addStateAt(p, event.ctrlKey || event.metaKey);
    });

    function createTransition(sourceId, targetId) {
        const a = stateAt(sourceId), b = stateAt(targetId), midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const reciprocal = draft.transitions.some(edge => edge.sourceId === targetId && edge.targetId === sourceId);
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, curve = reciprocal ? 45 : 0;
        const edge = { id: uid("transition"), sourceId, targetId, eventNames: [], text: "", controlX: sourceId === targetId ? a.x : midpoint.x - dy / length * curve, controlY: sourceId === targetId ? a.y - 80 : midpoint.y + dx / length * curve };
        draft.transitions.push(edge); selection = { type: "transition", id: edge.id, replaceOnType: true }; render();
    }

    host.addEventListener("keydown", event => {
        if (event.key === "Escape") { commitSelection(); drag = null; preview = null; selection = null; render(); return; }
        if (!layoutOnly && event.key === "Delete" && selection) {
            event.preventDefault();
            if (selection.type === "state") { draft.states = draft.states.filter(q => q.id !== selection.id); draft.transitions = draft.transitions.filter(t => t.sourceId !== selection.id && t.targetId !== selection.id); if (draft.initialStateId === selection.id) draft.initialStateId = null; }
            else draft.transitions = draft.transitions.filter(t => t.id !== selection.id);
            syncEvents(); selection = null; render(); return;
        }
        if (layoutOnly || !selection || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = selection.type === "state" ? stateAt(selection.id) : edgeAt(selection.id);
        let value = selection.type === "state" ? target?.name : (target?.text ?? target?.eventNames.join(", ") ?? "");
        if (event.key === "Backspace" && target) { event.preventDefault(); value = value.slice(0, -1); }
        else if (event.key.length === 1 && target && (selection.type === "transition" || !/\s/.test(event.key))) { event.preventDefault(); value = selection.replaceOnType ? event.key : value + event.key; selection.replaceOnType = false; }
        else return;
        if (selection.type === "state") { if (!draft.states.some(q => q.id !== target.id && q.name === value)) target.name = value; }
        else target.text = value;
        render();
    });

    svg.addEventListener("wheel", event => {
        if (!layoutOnly) return;
        event.preventDefault(); const before = point(event), factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        viewport.zoom = Math.max(.25, Math.min(4, viewport.zoom * factor)); updateViewBox(); const after = point(event);
        viewport.panX += before.x - after.x; viewport.panY += before.y - after.y; updateViewBox();
    }, { passive: false });

    render();
    return {
        loadAutomaton(value, layout) {
            Object.assign(draft, structuredClone(value));
            const savedStates = new Map((layout?.states || []).map(q => [q.state, q]));
            draft.states.forEach((q, i) => { const saved = savedStates.get(q.name); q.x = saved?.x ?? 100 + (i % 6) * 130; q.y = saved?.y ?? 100 + Math.floor(i / 6) * 120; });
            draft.transitions.forEach(t => { t.text = t.eventNames.join(", "); const events = [...t.eventNames].sort().join("\u001f"), saved = (layout?.transitions || []).find(x => x.source === t.sourceId && x.target === t.targetId && [...x.events].sort().join("\u001f") === events), a = stateAt(t.sourceId), b = stateAt(t.targetId); t.controlX = saved?.controlX ?? (a.x + b.x) / 2; t.controlY = saved?.controlY ?? (t.sourceId === t.targetId ? a.y - 80 : (a.y + b.y) / 2); });
            if (layout) viewport = { canvasWidth: layout.canvasWidth || 900, canvasHeight: layout.canvasHeight || 520, zoom: layout.zoom || 1, panX: layout.panX || 0, panY: layout.panY || 0 };
            updateViewBox(); render();
        },
        getDraft() { commitSelection(); syncEvents(); return structuredClone(draft); },
        getLayout() { return { ...viewport, states: draft.states.map(q => ({ state: q.name, x: q.x, y: q.y })), transitions: draft.transitions.map(t => ({ source: t.sourceId, target: t.targetId, events: t.eventNames, controlX: t.controlX, controlY: t.controlY })) }; },
        dispose() { host.replaceChildren(); }
    };
}
