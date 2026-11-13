import { edgeGeometry as calculateEdgeGeometry, textLines, radiusOf, drawingBounds as calculateDrawingBounds } from './automaton-geometry.js';
import { relativeAnchor, restoreAnchor, closestCurvePoint, bendThrough, magneticPosition } from './automaton-interaction.js';

const NS = "http://www.w3.org/2000/svg";

export function createAutomatonEditor(host, layoutOnly = false) {
    const draft = { states: [], events: [], transitions: [], initialStateId: null };
    let selection = null, drag = null, preview = null, activeTool = "select", transitionSourceId = null, suppressNextDoubleClick = false, lastClick = null, touchHoldTimer = null;
    let snapToGrid = false, guides = null, renderFrame = null, activePointerId = null;
    let viewport = { canvasWidth: 900, canvasHeight: 520, zoom: 1, panX: 0, panY: 0 };
    const svg = document.createElementNS(NS, "svg");
    const aspectRatio = () => svg.clientWidth && svg.clientHeight ? svg.clientWidth / svg.clientHeight : viewport.canvasWidth / viewport.canvasHeight;
    const maximumZoom = () => Math.max(4, viewport.canvasWidth / Math.max(svg.clientWidth || 900, 200) * 2);
    const updateViewBox = () => svg.setAttribute("viewBox", `${viewport.panX} ${viewport.panY} ${viewport.canvasWidth / viewport.zoom} ${viewport.canvasWidth / viewport.zoom / aspectRatio()}`);
    updateViewBox();
    svg.setAttribute("aria-label", "Automaton diagram");
    host.append(svg);
    const resizeObserver = new ResizeObserver(updateViewBox);
    resizeObserver.observe(host);
    const keyboard = document.createElement("input");
    keyboard.className = "visual-editor-keyboard"; keyboard.setAttribute("aria-label", "Edit selected item"); keyboard.autocomplete = "off";
    host.append(keyboard);
    let contextMenu = null;
    const selectionTools = document.createElement('div');
    selectionTools.className = 'visual-selection-tools'; selectionTools.hidden = true;
    selectionTools.setAttribute('role', 'toolbar'); selectionTools.setAttribute('aria-label', 'Transition geometry');
    const geometryButton = (label, action) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = action; selectionTools.append(button); return button; };
    const straightenButton = geometryButton('Straighten', () => changeCurve('straighten'));
    const mirrorButton = geometryButton('Mirror curve', () => changeCurve('mirror'));
    geometryButton('Center label', () => changeCurve('label'));
    host.append(selectionTools);

    const point = event => { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const value = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: value.x, y: value.y }; };
    const pixelsPerUnit = () => { const matrix = svg.getScreenCTM(); return Math.max(.001, matrix ? Math.hypot(matrix.a, matrix.b) : 1); };
    const stateAt = id => draft.states.find(q => q.id === id);
    const edgeAt = id => draft.transitions.find(t => t.id === id);
    const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
    const svgElement = (name, attributes = {}) => { const element = document.createElementNS(NS, name); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value); return element; };

    function selectedText() {
        const target = selection?.type === "state" ? stateAt(selection.id) : selection?.type === "transition" ? edgeAt(selection.id) : null;
        return selection?.type === "state" ? target?.name ?? "" : target?.text ?? target?.eventNames.join(", ") ?? "";
    }

    function summonKeyboard() {
        if (layoutOnly || !selection) return;
        const selected = selection.type === 'state' ? stateAt(selection.id) : edgeAt(selection.id);
        const world = selection.type === 'state' ? selected : edgeGeometry(selected).label;
        const p = svg.createSVGPoint(); p.x = world.x; p.y = world.y;
        const screen = p.matrixTransform(svg.getScreenCTM()), bounds = host.getBoundingClientRect();
        // Keep the native input/caret next to the selected item. An input at the
        // canvas bottom makes browsers scroll the whole dialog while typing.
        const visibleX = Math.max(8, Math.min(window.innerWidth - 20, screen.x));
        const visibleY = Math.max(8, Math.min(window.innerHeight - 35, screen.y));
        keyboard.style.left = `${Math.max(2, Math.min(bounds.width - 4, visibleX - bounds.left))}px`;
        keyboard.style.top = `${Math.max(2, Math.min(bounds.height - 4, visibleY - bounds.top))}px`;
        keyboard.style.bottom = 'auto';
        keyboard.value = selectedText();
        keyboard.focus({ preventScroll: true });
        keyboard.setSelectionRange(0, keyboard.value.length);
    }

    function applyKeyboardValue() {
        if (!selection) return;
        const target = selection.type === "state" ? stateAt(selection.id) : edgeAt(selection.id);
        if (!target) return;
        if (selection.type === "state") {
            const value = keyboard.value.replace(/\s/g, "");
            if (!draft.states.some(q => q.id !== target.id && q.name === value)) target.name = value;
        } else { target.text = keyboard.value; commitTransition(target); }
        render();
    }
    keyboard.addEventListener("input", applyKeyboardValue);

    function closeContextMenu() { contextMenu?.remove(); contextMenu = null; }
    function showContextMenu(clientX, clientY) {
        if (!selection) return;
        closeContextMenu();
        const menu = document.createElement("div"); menu.className = "visual-editor-context-menu"; menu.setAttribute("role", "menu");
        const action = (label, callback, danger = false) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; if (danger) button.className = "is-danger"; button.onclick = () => { callback(); closeContextMenu(); }; menu.append(button); };
        if (selection.type === 'transition') {
            const edge = edgeAt(selection.id), loop = edge.sourceId === edge.targetId;
            action(loop ? 'Reset loop' : 'Straighten transition', () => changeCurve('straighten'));
            action(loop ? 'Rotate loop' : 'Mirror curve', () => changeCurve('mirror'));
            action('Center label', () => changeCurve('label'));
        }
        if (!layoutOnly) {
            action("Edit text", () => { closeContextMenu(); summonKeyboard(); });
            if (selection.type === "state") { action("Set as initial", () => { draft.initialStateId = selection.id; render(); }); action("Toggle marked", () => { const q = stateAt(selection.id); q.marked = !q.marked; render(); }); }
            else action("Toggle event controllability", () => { toggleControllability(edgeAt(selection.id), selection.eventName); render(); });
            action(selection.type === "state" ? "Remove state" : "Remove transition", deleteSelection, true);
        }
        if (!menu.childElementCount) return;
        host.append(menu); contextMenu = menu;
        const bounds = host.getBoundingClientRect(), width = menu.offsetWidth, height = menu.offsetHeight;
        menu.style.left = `${Math.max(4, Math.min(clientX - bounds.left, bounds.width - width - 4))}px`;
        menu.style.top = `${Math.max(4, Math.min(clientY - bounds.top, bounds.height - height - 4))}px`;
        menu.querySelector("button")?.focus();
    }

    function addStateAt(p, initial) {
        const position = magneticPosition(p, draft.states, null, 6 / pixelsPerUnit(), snapToGrid).position;
        const state = { id: uid("state"), name: "", marked: false, x: position.x, y: position.y };
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

    function toggleControllability(edge, eventName = null) {
        commitTransition(edge);
        const names = eventName ? [eventName] : edge.eventNames;
        const makeControllable = names.some(name => draft.events.find(item => item.name === name)?.controllable === false);
        for (const name of names) {
            const item = draft.events.find(candidate => candidate.name === name);
            if (item) item.controllable = makeControllable;
        }
        selection = null;
    }

    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    function edgeGeometry(edge) {
        return calculateEdgeGeometry(stateAt(edge.sourceId), stateAt(edge.targetId), edge);
    }

    function changeCurve(action) {
        if (selection?.type !== 'transition') return;
        const edge = edgeAt(selection.id), a = stateAt(edge.sourceId), b = stateAt(edge.targetId);
        if (action === 'label') { edge.labelOffsetX = 0; edge.labelOffsetY = 0; }
        else if (edge.sourceId === edge.targetId) {
            const dx = edge.controlX - a.x, dy = edge.controlY - a.y;
            edge.controlX = action === 'mirror' ? a.x - dy : a.x;
            edge.controlY = action === 'mirror' ? a.y + dx : a.y - radiusOf(a) - 85;
            edge.labelOffsetX = 0; edge.labelOffsetY = 0;
        } else {
            const anchor = relativeAnchor(a, b, edge);
            anchor.parallel = action === 'straighten' ? .5 : anchor.parallel;
            anchor.perpendicular = action === 'straighten' ? 0 : -anchor.perpendicular;
            anchor.labelNormal = action === 'straighten' ? 0 : -anchor.labelNormal;
            restoreAnchor(a, b, edge, anchor);
        }
        host.focus({ preventScroll: true }); render();
    }

    function requestRender() {
        if (renderFrame === null) renderFrame = requestAnimationFrame(() => { renderFrame = null; render(); });
    }

    function addTransitionLabel(group, edge, geometry, selected) {
        if (!edge.eventNames.length) return;
        let y = geometry.label.y - geometry.labelLayout.height / 2;
        for (const row of geometry.labelLayout.rows) {
            let x = geometry.label.x - row.width / 2;
            for (const chip of row.chips) {
                const label = svgElement("g", { class: `transition-label${draft.events.find(e => e.name === chip.name)?.controllable === false ? " is-uncontrollable" : ""}`, "data-transition-id": edge.id, "data-event-name": chip.name });
                label.append(svgElement("rect", { x, y, width: chip.width, height: chip.height }));
                const text = svgElement("text", { "text-anchor": "middle" });
                chip.lines.forEach((line, index) => { const span = svgElement('tspan', { x: x + chip.width / 2, y: y + 17 + index * 18 }); span.textContent = line; text.append(span); });
                label.append(text); group.append(label); x += chip.width + 5;
            }
            y += row.height + 5;
        }
    }

    function render() {
        host.closest('.visual-automaton-editor')?.querySelectorAll('[data-tool]').forEach(button => {
            const active = button.dataset.tool === activeTool;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        if (renderFrame !== null) { cancelAnimationFrame(renderFrame); renderFrame = null; }
        svg.replaceChildren();
        const defs = svgElement("defs");
        const marker = svgElement("marker", { id: "visual-arrow", viewBox: "0 -5 10 10", refX: "9", refY: "0", markerWidth: "8", markerHeight: "8", orient: "auto", markerUnits: "strokeWidth" });
        marker.append(svgElement("path", { class: "visual-arrow-head", d: "M 0 -5 L 10 0 L 0 5 z" })); defs.append(marker); svg.append(defs);

        if (guides) {
            const box = svg.viewBox.baseVal;
            if (guides.guideX !== null) svg.append(svgElement('line', { x1: guides.guideX, x2: guides.guideX, y1: box.y, y2: box.y + box.height, class: 'alignment-guide' }));
            if (guides.guideY !== null) svg.append(svgElement('line', { y1: guides.guideY, y2: guides.guideY, x1: box.x, x2: box.x + box.width, class: 'alignment-guide' }));
        }

        for (const edge of draft.transitions) {
            const selected = selection?.type === "transition" && selection.id === edge.id;
            const geometry = edgeGeometry(edge), group = svgElement("g", { class: `visual-transition${selected ? " is-selected" : ""}`, "data-source-id": edge.sourceId, "data-target-id": edge.targetId });
            group.append(svgElement("path", { class: "transition-hit-area", d: geometry.path, "data-transition-id": edge.id, 'vector-effect': 'non-scaling-stroke' }));
            group.append(svgElement("path", { d: geometry.path, "marker-end": "url(#visual-arrow)", "data-transition-id": edge.id }));
            svg.append(group);
            addTransitionLabel(group, edge, geometry, selected);
            if (selected) {
                const anchor = geometry.at(.5), a = stateAt(edge.sourceId), b = stateAt(edge.targetId);
                if (a.id !== b.id) group.append(svgElement('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'transition-guide' }));
                group.append(svgElement("circle", { cx: anchor.x, cy: anchor.y, r: 7 / pixelsPerUnit(), class: "transition-control", "data-control-id": edge.id, 'vector-effect': 'non-scaling-stroke' }));
            }
        }
        if (draft.initialStateId) {
            const q = stateAt(draft.initialStateId);
            if (q) svg.append(svgElement("path", { d: `M ${q.x - radiusOf(q) - 45} ${q.y} L ${q.x - radiusOf(q) - 1} ${q.y}`, "marker-end": "url(#visual-arrow)", class: "initial-arrow" }));
        }
        for (const q of draft.states) {
            const group = svgElement("g", { class: `visual-state${selection?.type === "state" && selection.id === q.id ? " is-selected" : ""}`, "data-state-id": q.id });
            group.append(svgElement("circle", { cx: q.x, cy: q.y, r: radiusOf(q) }));
            if (q.marked) group.append(svgElement("circle", { cx: q.x, cy: q.y, r: radiusOf(q) - 6 }));
            const lines = textLines(q.name);
            const text = svgElement("text", { "text-anchor": "middle" });
            lines.forEach((line, index) => { const span = svgElement('tspan', { x: q.x, y: q.y + 5 + (index - (lines.length - 1) / 2) * 18 }); span.textContent = line; text.append(span); });
            group.append(text); svg.append(group);
        }
        if (preview) {
            const a = preview.from, target = stateAt(preview.targetId);
            let path;
            if (target) path = calculateEdgeGeometry(a, target, { sourceId: a.id, targetId: target.id, eventNames: [],
                controlX: a.id === target.id ? a.x : (a.x + target.x) / 2, controlY: a.id === target.id ? a.y - radiusOf(a) - 85 : (a.y + target.y) / 2 }).path;
            else { const length = Math.max(1, distance(a, preview.to)); path = `M ${a.x + (preview.to.x - a.x) / length * (radiusOf(a) + 1)} ${a.y + (preview.to.y - a.y) / length * (radiusOf(a) + 1)} L ${preview.to.x} ${preview.to.y}`; }
            svg.append(svgElement("path", { class: "transition-preview", d: path, 'marker-end': 'url(#visual-arrow)' }));
        }
        const selectedEdge = selection?.type === 'transition' ? edgeAt(selection.id) : null;
        selectionTools.hidden = !selectedEdge;
        if (selectedEdge) {
            const loop = selectedEdge.sourceId === selectedEdge.targetId;
            straightenButton.textContent = loop ? 'Reset loop' : 'Straighten';
            mirrorButton.textContent = loop ? 'Rotate loop' : 'Mirror curve';
        }
    }

    const edgeSnapshot = edge => ({ controlX: edge.controlX, controlY: edge.controlY, labelOffsetX: edge.labelOffsetX || 0, labelOffsetY: edge.labelOffsetY || 0 });
    function releasePointer() {
        const pointer = activePointerId; activePointerId = null;
        if (pointer !== null && svg.hasPointerCapture(pointer)) svg.releasePointerCapture(pointer);
        host.classList.remove('is-dragging'); delete host.dataset.dragMode;
    }
    function cancelDrag() {
        drag?.restore?.(); drag = null; preview = null; guides = null; lastClick = null;
        clearTimeout(touchHoldTimer); touchHoldTimer = null; releasePointer(); updateViewBox(); render();
    }

    svg.addEventListener("pointerdown", event => {
        if (activePointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
        suppressNextDoubleClick = false;
        closeContextMenu(); host.focus({ preventScroll: true });
        const p = point(event), control = event.target.closest?.("[data-control-id]"), stateElement = event.target.closest?.("[data-state-id]"), edgeElement = event.target.closest?.("[data-transition-id]"), eventElement = event.target.closest?.("[data-event-name]");
        const clickedObject = edgeElement ? `transition:${edgeElement.dataset.transitionId}` : stateElement ? `state:${stateElement.dataset.stateId}` : null;
        const isSecondClick = clickedObject && lastClick?.object === clickedObject && performance.now() - lastClick.time < 450;
        if (!layoutOnly && !control && activeTool === "select" && isSecondClick) {
            lastClick = null;
            if (edgeElement) toggleControllability(edgeAt(edgeElement.dataset.transitionId), eventElement?.dataset.eventName);
            else { const state = stateAt(stateElement.dataset.stateId); state.marked = !state.marked; }
            suppressNextDoubleClick = true; render(); return;
        }
        if (activeTool === "add-state" || activeTool === "add-initial") { const initial = activeTool === "add-initial"; activeTool = "select"; if (!stateElement && !edgeElement) addStateAt(p, initial); else render(); return; }
        if (activeTool === "transition" && stateElement) { if (!transitionSourceId) { transitionSourceId = stateElement.dataset.stateId; selection = { type: "state", id: transitionSourceId }; render(); } else { suppressNextDoubleClick = transitionSourceId === stateElement.dataset.stateId; const source = transitionSourceId; transitionSourceId = null; preview = null; activeTool = "select"; createTransition(source, stateElement.dataset.stateId); } return; }
        if (selection && (!edgeElement || selection.id !== edgeElement.dataset.transitionId)) commitSelection();
        if (stateElement && !control) {
            const state = stateAt(stateElement.dataset.stateId), original = { x: state.x, y: state.y };
            const attached = draft.transitions.filter(edge => edge.sourceId === state.id || edge.targetId === state.id)
                .map(edge => ({ edge, anchor: relativeAnchor(stateAt(edge.sourceId), stateAt(edge.targetId), edge), original: edgeSnapshot(edge) }));
            selection = { type: 'state', id: state.id };
            drag = { type: !layoutOnly && event.shiftKey ? 'transition' : 'state', id: state.id,
                grab: { x: state.x - p.x, y: state.y - p.y }, attached,
                restore: () => { Object.assign(state, original); attached.forEach(item => Object.assign(item.edge, item.original)); } };
        } else if (control || edgeElement) {
            const edge = edgeAt(control?.dataset.controlId || edgeElement.dataset.transitionId), original = edgeSnapshot(edge);
            edge.text ??= edge.eventNames.join(', ');
            selection = { type: 'transition', id: edge.id, eventName: eventElement?.dataset.eventName };
            if (eventElement && !control) drag = { type: 'label', id: edge.id, original, restore: () => Object.assign(edge, original) };
            else {
                const a = stateAt(edge.sourceId), b = stateAt(edge.targetId), geometry = edgeGeometry(edge);
                const anchor = control || a.id === b.id ? { t: .5, point: geometry.at(.5) } : closestCurvePoint(a, b, edge, p);
                drag = { type: 'bend', id: edge.id, t: anchor.t, handle: !!control, grab: { x: anchor.point.x - p.x, y: anchor.point.y - p.y }, restore: () => Object.assign(edge, original) };
            }
        } else {
            selection = null;
            const original = { panX: viewport.panX, panY: viewport.panY };
            drag = { type: 'canvas', originX: viewport.panX, originY: viewport.panY, restore: () => Object.assign(viewport, original) };
        }
        Object.assign(drag, { start: p, clientX: event.clientX, clientY: event.clientY, scale: pixelsPerUnit(), pointerType: event.pointerType, moved: false, held: false, object: clickedObject });
        activePointerId = event.pointerId; svg.setPointerCapture(event.pointerId);
        if (event.pointerType === 'touch' && !layoutOnly) touchHoldTimer = setTimeout(() => { if (drag && !drag.moved) drag.held = true; }, 400);
        render();
    });

    svg.addEventListener("pointermove", event => {
        if (!drag && activeTool === 'transition' && transitionSourceId) {
            const p = point(event), target = draft.states.find(state => distance(state, p) <= radiusOf(state) + 4);
            preview = { from: stateAt(transitionSourceId), to: p, targetId: target?.id }; requestRender(); return;
        }
        if (!drag || event.pointerId !== activePointerId) return;
        if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) return;
        const p = point(event);
        if (!drag.moved && drag.type === 'state' && drag.held && !layoutOnly) drag.type = 'transition';
        drag.moved = true; lastClick = null; clearTimeout(touchHoldTimer);
        host.classList.add('is-dragging'); host.dataset.dragMode = drag.type;
        if (drag.type === 'state') {
            const state = stateAt(drag.id), raw = { x: p.x + drag.grab.x, y: p.y + drag.grab.y };
            guides = event.altKey ? null : magneticPosition(raw, draft.states, state.id, 6 / pixelsPerUnit(), snapToGrid);
            Object.assign(state, guides?.position || raw);
            drag.attached.forEach(item => restoreAnchor(stateAt(item.edge.sourceId), stateAt(item.edge.targetId), item.edge, item.anchor));
        } else if (drag.type === 'transition') {
            const target = draft.states.find(state => distance(state, p) <= radiusOf(state) + 4);
            preview = { from: stateAt(drag.id), to: p, targetId: target?.id };
        }
        else if (drag.type === 'canvas') {
            viewport.panX = drag.originX - (event.clientX - drag.clientX) / drag.scale;
            viewport.panY = drag.originY - (event.clientY - drag.clientY) / drag.scale;
            updateViewBox();
        } else if (drag.type === 'label') {
            const edge = edgeAt(drag.id);
            edge.labelOffsetX = drag.original.labelOffsetX + p.x - drag.start.x;
            edge.labelOffsetY = drag.original.labelOffsetY + p.y - drag.start.y;
        } else if (drag.type === 'bend') {
            const edge = edgeAt(drag.id), target = { x: p.x + drag.grab.x, y: p.y + drag.grab.y };
            if (snapToGrid && !event.altKey) { target.x = Math.round(target.x / 20) * 20; target.y = Math.round(target.y / 20) * 20; }
            bendThrough(stateAt(edge.sourceId), stateAt(edge.targetId), edge, target, drag.t, event.altKey ? 0 : 6 / pixelsPerUnit());
        }
        requestRender();
    });

    svg.addEventListener("pointerup", event => {
        if (activePointerId !== null && event.pointerId !== activePointerId) return;
        if (!drag) { if (selection && !suppressNextDoubleClick && !(activeTool === 'transition' && transitionSourceId)) summonKeyboard(); return; }
        const completed = drag;
        clearTimeout(touchHoldTimer); touchHoldTimer = null;
        if (completed.type === 'transition' && completed.moved) {
            const release = point(event), target = draft.states.find(state => distance(state, release) <= radiusOf(state) + 4);
            if (target) createTransition(completed.id, target.id);
        }
        lastClick = !completed.moved && completed.object ? { object: completed.object, time: performance.now() } : null;
        drag = null; preview = null; guides = null; releasePointer(); render();
        if (completed.pointerType === 'touch' && completed.held && !completed.moved) showContextMenu(event.clientX, event.clientY);
        else if (selection && !completed.moved && !completed.handle) summonKeyboard();
        else host.focus({ preventScroll: true });
    });

    svg.addEventListener("pointercancel", event => { if (event.pointerId === activePointerId) cancelDrag(); });
    svg.addEventListener('lostpointercapture', event => { if (drag && event.pointerId === activePointerId) cancelDrag(); });

    svg.addEventListener("contextmenu", event => {
        const stateElement = event.target.closest?.("[data-state-id]"), edgeElement = event.target.closest?.("[data-transition-id]");
        if (!stateElement && !edgeElement) return;
        event.preventDefault();
        selection = stateElement ? { type: "state", id: stateElement.dataset.stateId } : { type: "transition", id: edgeElement.dataset.transitionId, eventName: event.target.closest?.("[data-event-name]")?.dataset.eventName };
        render(); showContextMenu(event.clientX, event.clientY);
    });

    svg.addEventListener("dblclick", event => {
        if (layoutOnly) return;
        if (suppressNextDoubleClick) { suppressNextDoubleClick = false; return; }
        const p = point(event), edgeElement = event.target.closest?.("[data-transition-id]"), stateElement = event.target.closest?.("[data-state-id]");
        if (edgeElement) {
            toggleControllability(edgeAt(edgeElement.dataset.transitionId), event.target.closest?.("[data-event-name]")?.dataset.eventName); render();
        } else if (stateElement) { const q = stateAt(stateElement.dataset.stateId); q.marked = !q.marked; render(); }
        else addStateAt(p, false);
    });

    function createTransition(sourceId, targetId) {
        const a = stateAt(sourceId), b = stateAt(targetId), midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const reciprocal = draft.transitions.some(edge => edge.sourceId === targetId && edge.targetId === sourceId);
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, curve = reciprocal ? 60 : 0;
        if (reciprocal && sourceId !== targetId) {
            for (const other of draft.transitions.filter(edge => edge.sourceId === targetId && edge.targetId === sourceId)) {
                const anchor = relativeAnchor(b, a, other);
                if (Math.abs(anchor.perpendicular) < 7) { anchor.perpendicular = 60; restoreAnchor(b, a, other, anchor); }
            }
        }
        const edge = { id: uid("transition"), sourceId, targetId, eventNames: [], text: "", controlX: sourceId === targetId ? a.x : midpoint.x - dy / length * curve, controlY: sourceId === targetId ? a.y - 80 : midpoint.y + dx / length * curve };
        draft.transitions.push(edge); selection = { type: "transition", id: edge.id, replaceOnType: true }; render();
    }

    host.addEventListener("keydown", event => {
        if (event.key === 'Escape' && (drag || selection || transitionSourceId)) {
            event.preventDefault(); event.stopPropagation(); commitSelection(); cancelDrag(); selection = null; transitionSourceId = null; activeTool = 'select';
            closeContextMenu(); host.focus({ preventScroll: true }); render(); return;
        }
        if (event.target === keyboard || event.target?.closest?.(".visual-editor-context-menu,.visual-selection-tools")) return;
        if (!layoutOnly && event.key === "Delete" && selection) {
            event.preventDefault();
            deleteSelection(); return;
        }
        if (layoutOnly || !selection || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = selection.type === "state" ? stateAt(selection.id) : edgeAt(selection.id);
        let value = selection.type === "state" ? target?.name : (target?.text ?? target?.eventNames.join(", ") ?? "");
        if (event.key === "Backspace" && target) { event.preventDefault(); value = value.slice(0, -1); }
        else if (event.key.length === 1 && target && (selection.type === "transition" || !/\s/.test(event.key))) { event.preventDefault(); value = selection.replaceOnType ? event.key : value + event.key; selection.replaceOnType = false; }
        else return;
        if (selection.type === "state") { if (!draft.states.some(q => q.id !== target.id && q.name === value)) target.name = value; }
        else { target.text = value; commitTransition(target); }
        render();
    });

    svg.addEventListener("wheel", event => {
        event.preventDefault(); if (drag) return;
        const before = point(event), factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        viewport.zoom = Math.max(.25, Math.min(maximumZoom(), viewport.zoom * factor)); updateViewBox(); const after = point(event);
        viewport.panX += before.x - after.x; viewport.panY += before.y - after.y; updateViewBox();
    }, { passive: false });

    render();
    function download(content, mimeType, extension) {
        const safeName = (host.closest(".modal-card")?.querySelector(".modal-card-title")?.textContent || "automaton").trim().replace(/[^a-z0-9_-]+/gi, "-");
        window.saveFile(`${safeName}.${extension}`, content, mimeType);
    }

    function drawingBounds() {
        return calculateDrawingBounds(draft.states, draft.transitions, draft.initialStateId);
    }

    function svgContent() {
        const copy = svg.cloneNode(true);
        const bounds = drawingBounds(), width = Math.ceil(bounds.width), height = Math.ceil(bounds.height);
        copy.setAttribute("xmlns", NS);
        copy.setAttribute("viewBox", `0 0 ${width} ${height}`);
        copy.setAttribute("width", width);
        copy.setAttribute("height", height);
        copy.querySelectorAll(".transition-hit-area,.transition-control,.transition-guide,.alignment-guide,.transition-preview").forEach(item => item.remove());
        copy.querySelectorAll('.is-selected').forEach(item => item.classList.remove('is-selected'));
        // Normalize the drawing on the exported page, without changing the draft or camera.
        // Split subpixel rounding equally between the two margins.
        const content = svgElement('g', { transform: `translate(${(width - bounds.width) / 2 - bounds.x} ${(height - bounds.height) / 2 - bounds.y})` });
        for (const child of [...copy.children]) if (child.localName !== 'defs') content.append(child);
        copy.append(content);
        const style = document.createElementNS(NS, "style");
        style.textContent = `.visual-state circle{fill:#fff;stroke:#1f2937;stroke-width:3}.visual-state text,.visual-transition text{fill:#111827;font:600 14px monospace}.visual-transition>path{fill:none;stroke:#374151;stroke-width:2.5}.visual-arrow-head{fill:#374151}.initial-arrow{fill:none;stroke:#111827;stroke-width:3}.transition-label rect{fill:#fafafa;stroke:#3273dc;stroke-width:2;rx:4}.transition-label.is-uncontrollable rect{stroke:#e53935}.transition-label.is-uncontrollable text{fill:#c62828}`;
        copy.prepend(style);
        return new XMLSerializer().serializeToString(copy);
    }

    function exportSvg() { download(svgContent(), "image/svg+xml;charset=utf-8", "svg"); }

    function fitDiagram() {
        const bounds = drawingBounds(), aspect = aspectRatio();
        const worldWidth = Math.max(bounds.width, bounds.height * aspect);
        viewport.zoom = Math.max(.25, Math.min(maximumZoom(), viewport.canvasWidth / worldWidth));
        viewport.panX = bounds.x + bounds.width / 2 - viewport.canvasWidth / viewport.zoom / 2;
        viewport.panY = bounds.y + bounds.height / 2 - viewport.canvasWidth / viewport.zoom / aspect / 2;
        updateViewBox();
    }

    const texEscape = value => String(value).replace(/[\\#$%&_{}~^]/g, char => ({ '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[char] || `\\${char}`));
    function exportTikz() {
        const lines = ["\\begin{tikzpicture}[>=stealth,auto,node distance=2cm,semithick,font=\\ttfamily\\fontsize{7}{9}\\selectfont,", "  state/.style={circle,draw,minimum size=16mm},", "  marked/.style={state,double,double distance=2pt}]" ];
        const ids = new Map(draft.states.map((q, index) => [q.id, `q${index}`]));
        for (const q of draft.states) {
            const x = (q.x / 60).toFixed(3), y = ((viewport.canvasHeight - q.y) / 60).toFixed(3);
            const label = textLines(q.name).map(texEscape).join('\\\\');
            lines.push(`  \\node[${q.marked ? "marked" : "state"},minimum size=${(radiusOf(q) / 30).toFixed(3)}cm,inner sep=0pt] (${ids.get(q.id)}) at (${x},${y}) {\\shortstack{${label}}};`);
        }
        if (draft.initialStateId && ids.has(draft.initialStateId)) lines.push(`  \\draw[->] ([xshift=-7.5mm]${ids.get(draft.initialStateId)}.west) -- (${ids.get(draft.initialStateId)}.west);`);
        for (const edge of draft.transitions) {
            const geometry = edgeGeometry(edge), tokens = geometry.path.split(/\s+/);
            const coord = (x, y) => `(${(+x / 60).toFixed(3)},${((viewport.canvasHeight - +y) / 60).toFixed(3)})`;
            const start = { x: +tokens[1], y: +tokens[2] };
            let path;
            if (tokens[3] === 'C') path = `${coord(start.x, start.y)} .. controls ${coord(tokens[4], tokens[5])} and ${coord(tokens[6], tokens[7])} .. ${coord(tokens[8], tokens[9])}`;
            else if (tokens[3] === 'Q') {
                const control = { x: +tokens[4], y: +tokens[5] }, end = { x: +tokens[6], y: +tokens[7] };
                path = `${coord(start.x, start.y)} .. controls ${coord(start.x + 2 / 3 * (control.x - start.x), start.y + 2 / 3 * (control.y - start.y))} and ${coord(end.x + 2 / 3 * (control.x - end.x), end.y + 2 / 3 * (control.y - end.y))} .. ${coord(end.x, end.y)}`;
            } else path = `${coord(start.x, start.y)} -- ${coord(tokens[4], tokens[5])}`;
            lines.push(`  \\draw[->] ${path};`);
            let labelY = geometry.label.y - geometry.labelLayout.height / 2;
            for (const row of geometry.labelLayout.rows) {
                let labelX = geometry.label.x - row.width / 2;
                for (const chip of row.chips) {
                    const color = draft.events.find(event => event.name === chip.name)?.controllable === false ? 'red' : 'blue';
                    const label = chip.lines.map(texEscape).join('\\\\');
                    lines.push(`  \\node[fill=white,draw=${color},text=${color},rounded corners=1pt,inner sep=0pt,minimum width=${(chip.width / 60).toFixed(3)}cm,minimum height=${(chip.height / 60).toFixed(3)}cm] at ${coord(labelX + chip.width / 2, labelY + chip.height / 2)} {\\shortstack{${label}}};`);
                    labelX += chip.width + 5;
                }
                labelY += row.height + 5;
            }
        }
        lines.push("\\end{tikzpicture}", "");
        download(lines.join("\n"), "text/plain;charset=utf-8", "tex");
    }

    function deleteSelection() {
        if (!selection || layoutOnly) return;
        if (drag) cancelDrag();
        if (selection.type === "state") { draft.states = draft.states.filter(q => q.id !== selection.id); draft.transitions = draft.transitions.filter(t => t.sourceId !== selection.id && t.targetId !== selection.id); if (draft.initialStateId === selection.id) draft.initialStateId = null; }
        else draft.transitions = draft.transitions.filter(t => t.id !== selection.id);
        syncEvents(); selection = null; render();
    }
    return {
        setTool(tool) { if (drag) cancelDrag(); commitSelection(); activeTool = tool; transitionSourceId = null; preview = null; selection = null; lastClick = null; render(); },
        setSnapToGrid(value) { snapToGrid = !!value; },
        deleteSelection,
        toggleMarked() { if (selection?.type === "state") { const state = stateAt(selection.id); state.marked = !state.marked; render(); } },
        setInitial() { if (selection?.type === "state") { draft.initialStateId = selection.id; render(); } },
        toggleControllability() { if (selection?.type === "transition") { toggleControllability(edgeAt(selection.id), selection.eventName); render(); } },
        editSelection() { if (!selection) return; const target = selection.type === "state" ? stateAt(selection.id) : edgeAt(selection.id); const current = selection.type === "state" ? target.name : (target.text ?? target.eventNames.join(", ")); const value = window.prompt(selection.type === "state" ? "State name" : "Comma-separated events", current); if (value === null) return; if (selection.type === "state") { if (!draft.states.some(q => q.id !== target.id && q.name === value.trim())) target.name = value.trim(); } else { target.text = value; commitTransition(target); } render(); },
        loadAutomaton(value, layout) {
            Object.assign(draft, structuredClone(value));
            const savedStates = new Map((layout?.states || []).map(q => [q.state, q]));
            draft.states.forEach((q, i) => { const saved = savedStates.get(q.name); q.x = saved?.x ?? 100 + (i % 6) * 130; q.y = saved?.y ?? 100 + Math.floor(i / 6) * 120; q.radius = saved?.radius ?? 30; });
            draft.transitions.forEach(t => { t.text = t.eventNames.join(", "); const events = [...t.eventNames].sort().join("\u001f"), saved = (layout?.transitions || []).find(x => x.source === t.sourceId && x.target === t.targetId && [...x.events].sort().join("\u001f") === events), a = stateAt(t.sourceId), b = stateAt(t.targetId); t.controlX = saved?.controlX ?? (a.x + b.x) / 2; t.controlY = saved?.controlY ?? (t.sourceId === t.targetId ? a.y - 80 : (a.y + b.y) / 2); t.labelOffsetX = saved?.labelOffsetX ?? 0; t.labelOffsetY = saved?.labelOffsetY ?? 0; });
            if (layout) viewport = { canvasWidth: layout.canvasWidth || 900, canvasHeight: layout.canvasHeight || 520, zoom: layout.zoom || 1, panX: layout.panX || 0, panY: layout.panY || 0 };
            if (layout?.fitToViewport) fitDiagram();
            updateViewBox(); render();
        },
        getDraft() { commitSelection(); syncEvents(); return structuredClone(draft); },
        getLayout() { return { ...viewport, states: draft.states.map(q => ({ state: q.name, x: q.x, y: q.y, radius: radiusOf(q) })), transitions: draft.transitions.map(t => ({ source: t.sourceId, target: t.targetId, events: t.eventNames, controlX: t.controlX, controlY: t.controlY, labelOffsetX: t.labelOffsetX || 0, labelOffsetY: t.labelOffsetY || 0 })) }; },
        applyLayout(layout) {
            const savedStates = new Map(layout.states.map(q => [q.state, q]));
            draft.states.forEach(q => { const saved = savedStates.get(q.name); if (saved) { q.x = saved.x; q.y = saved.y; q.radius = saved.radius || 30; } });
            draft.transitions.forEach(t => {
                const eventKey = [...t.eventNames].sort().join('\u001f');
                const saved = layout.transitions.find(edge =>
                    (edge.source === t.sourceId || edge.source === stateAt(t.sourceId)?.name) &&
                    (edge.target === t.targetId || edge.target === stateAt(t.targetId)?.name) && [...edge.events].sort().join('\u001f') === eventKey);
                if (saved) { t.controlX = saved.controlX; t.controlY = saved.controlY; t.labelOffsetX = saved.labelOffsetX || 0; t.labelOffsetY = saved.labelOffsetY || 0; }
            });
            viewport = { canvasWidth: layout.canvasWidth, canvasHeight: layout.canvasHeight, zoom: layout.zoom || 1, panX: layout.panX || 0, panY: layout.panY || 0 };
            if (layout.fitToViewport) fitDiagram();
            selection = null; updateViewBox(); render();
        },
        fitDiagram,
        exportSvg,
        getSvg: svgContent,
        exportTikz,
        dispose() { clearTimeout(touchHoldTimer); if (renderFrame !== null) cancelAnimationFrame(renderFrame); drag = null; releasePointer(); resizeObserver.disconnect(); host.replaceChildren(); }
    };
}

export function renderAutomatonSvg(diagram, layout) {
    const host = document.createElement('div');
    const editor = createAutomatonEditor(host, true);
    try { editor.loadAutomaton(diagram, layout); return editor.getSvg(); }
    finally { editor.dispose(); }
}
