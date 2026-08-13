const NS = "http://www.w3.org/2000/svg";

export function createAutomatonEditor(host, layoutOnly = false) {
    const draft = { states: [], events: [], transitions: [], initialStateId: null };
    let selection = null, drag = null, preview = null, activeTool = "select", transitionSourceId = null, suppressNextDoubleClick = false, clickRenderTimer = null, lastClick = null, touchHoldTimer = null;
    let viewport = { canvasWidth: 900, canvasHeight: 520, zoom: 1, panX: 0, panY: 0 };
    const svg = document.createElementNS(NS, "svg");
    const updateViewBox = () => svg.setAttribute("viewBox", `${viewport.panX} ${viewport.panY} ${viewport.canvasWidth / viewport.zoom} ${viewport.canvasHeight / viewport.zoom}`);
    updateViewBox();
    svg.setAttribute("aria-label", "Automaton diagram");
    host.append(svg);
    const keyboard = document.createElement("input");
    keyboard.className = "visual-editor-keyboard"; keyboard.setAttribute("aria-label", "Edit selected item"); keyboard.autocomplete = "off";
    host.append(keyboard);
    let contextMenu = null;

    const point = event => { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
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
        const label = { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 };
        const tangent = { x: end.x - start.x, y: end.y - start.y }, tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
        label.x -= tangent.y / tangentLength * 16; label.y += tangent.x / tangentLength * 16;
        return { path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`, label, handle: control };
    }

    function addTransitionLabel(group, edge, geometry, selected) {
        if (!edge.eventNames.length) return;
        const labels = edge.eventNames.map(name => {
            const label = svgElement("g", { class: `transition-label${draft.events.find(e => e.name === name)?.controllable === false ? " is-uncontrollable" : ""}`, "data-transition-id": edge.id, "data-event-name": name });
            const text = svgElement("text", { y: geometry.label.y + 5, "text-anchor": "middle" }); text.textContent = name; label.append(text); group.append(label);
            return { label, text, name, width: Math.max(18, text.getComputedTextLength() + 14) };
        });
        const total = labels.reduce((sum, item) => sum + item.width, 0) + (labels.length - 1) * 5;
        let x = geometry.label.x - total / 2;
        for (const item of labels) {
            const center = x + item.width / 2; item.text.setAttribute("x", center);
            item.label.prepend(svgElement("rect", { x, y: geometry.label.y - 13, width: item.width, height: 26 })); x += item.width + 5;
        }
    }

    function render() {
        svg.replaceChildren();
        const defs = svgElement("defs");
        const marker = svgElement("marker", { id: "visual-arrow", viewBox: "0 -5 10 10", refX: "9", refY: "0", markerWidth: "8", markerHeight: "8", orient: "auto", markerUnits: "strokeWidth" });
        marker.append(svgElement("path", { class: "visual-arrow-head", d: "M 0 -5 L 10 0 L 0 5 z" })); defs.append(marker); svg.append(defs);

        for (const edge of draft.transitions) {
            const selected = selection?.type === "transition" && selection.id === edge.id;
            const geometry = edgeGeometry(edge), group = svgElement("g", { class: `visual-transition${selected ? " is-selected" : ""}` });
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
        closeContextMenu(); host.focus();
        const p = point(event), control = event.target.closest?.("[data-control-id]"), stateElement = event.target.closest?.("[data-state-id]"), edgeElement = event.target.closest?.("[data-transition-id]"), eventElement = event.target.closest?.("[data-event-name]");
        const clickedObject = edgeElement ? `transition:${edgeElement.dataset.transitionId}` : stateElement ? `state:${stateElement.dataset.stateId}` : null;
        const isSecondClick = clickedObject && lastClick?.object === clickedObject && performance.now() - lastClick.time < 450;
        lastClick = clickedObject ? { object: clickedObject, time: performance.now() } : null;
        // Rendering replaces SVG children, so handle the second click before it
        // can replace the target that the browser needs to emit `dblclick`.
        if (!layoutOnly && (event.detail === 2 || isSecondClick) && (edgeElement || stateElement)) {
            lastClick = null;
            clearTimeout(clickRenderTimer); clickRenderTimer = null;
            if (edgeElement) toggleControllability(edgeAt(edgeElement.dataset.transitionId), eventElement?.dataset.eventName);
            else { const state = stateAt(stateElement.dataset.stateId); state.marked = !state.marked; }
            suppressNextDoubleClick = true; drag = null; render(); return;
        }
        if (activeTool === "add-state" || activeTool === "add-initial") { if (!stateElement && !edgeElement) addStateAt(p, activeTool === "add-initial"); activeTool = "select"; drag = null; return; }
        if (activeTool === "transition" && stateElement) { if (!transitionSourceId) { transitionSourceId = stateElement.dataset.stateId; selection = { type: "state", id: transitionSourceId }; render(); } else { createTransition(transitionSourceId, stateElement.dataset.stateId); transitionSourceId = null; activeTool = "select"; } return; }
        if (selection && (!edgeElement || selection.id !== edgeElement.dataset.transitionId)) commitSelection();
        if (control) { selection = { type: "transition", id: control.dataset.controlId }; drag = { type: "control", id: control.dataset.controlId }; }
        else if (stateElement) {
            const createEdge = !layoutOnly && event.shiftKey;
            selection = { type: "state", id: stateElement.dataset.stateId };
            drag = { type: createEdge ? "transition" : "state", id: stateElement.dataset.stateId, start: p, pointerType: event.pointerType, held: false };
            if (!layoutOnly && event.pointerType === "touch" && !createEdge) touchHoldTimer = setTimeout(() => { if (drag?.id === stateElement.dataset.stateId) drag.held = true; }, 350);
        }
        else if (edgeElement) {
            const edge = edgeAt(edgeElement.dataset.transitionId); edge.text ??= edge.eventNames.join(", "); selection = { type: "transition", id: edge.id, eventName: eventElement?.dataset.eventName };
            drag = layoutOnly ? { type: "control", id: edge.id } : event.pointerType === "touch" ? { type: "touch-menu", id: edge.id, held: false } : null;
            if (drag?.type === "touch-menu") touchHoldTimer = setTimeout(() => { if (drag?.id === edge.id) drag.held = true; }, 350);
        }
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
        if (drag.type === "touch-menu") return;
        if (drag.type === "state" && distance(p, drag.start) > 5) {
            if (drag.pointerType === "touch" && drag.held && !layoutOnly) { drag.type = "transition"; preview = { from: stateAt(drag.id), to: p }; }
            else if (drag.pointerType !== "touch" || layoutOnly || !drag.held) { clearTimeout(touchHoldTimer); const q = stateAt(drag.id); q.x = p.x; q.y = p.y; }
        }
        if (drag.type === "transition" && distance(p, drag.start) > 5) preview = { from: stateAt(drag.id), to: p };
        if (drag.type === "canvas" && layoutOnly) { viewport.panX = drag.originX - (p.x - drag.start.x); viewport.panY = drag.originY - (p.y - drag.start.y); updateViewBox(); }
        if (drag.type === "control") { const edge = edgeAt(drag.id); edge.controlX = p.x; edge.controlY = p.y; }
        render();
    });

    svg.addEventListener("pointerup", event => {
        if (!drag) { if (selection) summonKeyboard(); return; }
        clearTimeout(touchHoldTimer); touchHoldTimer = null;
        if (drag.type === "transition") {
            const releasePoint = point(event), target = draft.states.find(state => distance(state, releasePoint) <= 34);
            if (target) createTransition(drag.id, target.id);
        }
        const wasTouchHold = event.pointerType === "touch" && (drag.type === "state" || drag.type === "touch-menu") && drag.held;
        drag = null; preview = null; render();
        if (wasTouchHold) showContextMenu(event.clientX, event.clientY); else if (selection) summonKeyboard(); else host.focus();
    });

    svg.addEventListener("pointercancel", () => { clearTimeout(touchHoldTimer); touchHoldTimer = null; drag = null; preview = null; render(); });

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
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, curve = reciprocal ? 45 : 0;
        const edge = { id: uid("transition"), sourceId, targetId, eventNames: [], text: "", controlX: sourceId === targetId ? a.x : midpoint.x - dy / length * curve, controlY: sourceId === targetId ? a.y - 80 : midpoint.y + dx / length * curve };
        draft.transitions.push(edge); selection = { type: "transition", id: edge.id, replaceOnType: true }; render();
    }

    host.addEventListener("keydown", event => {
        if (event.target === keyboard || event.target?.closest?.(".visual-editor-context-menu")) return;
        if (event.key === "Escape") { commitSelection(); drag = null; preview = null; selection = null; render(); return; }
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
        if (!layoutOnly) return;
        event.preventDefault(); const before = point(event), factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        viewport.zoom = Math.max(.25, Math.min(4, viewport.zoom * factor)); updateViewBox(); const after = point(event);
        viewport.panX += before.x - after.x; viewport.panY += before.y - after.y; updateViewBox();
    }, { passive: false });

    render();
    function download(content, mimeType, extension) {
        const safeName = (host.closest(".modal-card")?.querySelector(".modal-card-title")?.textContent || "automaton").trim().replace(/[^a-z0-9_-]+/gi, "-");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
        link.download = `${safeName}.${extension}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }

    function exportSvg() {
        const copy = svg.cloneNode(true);
        copy.setAttribute("xmlns", NS);
        copy.setAttribute("viewBox", `0 0 ${viewport.canvasWidth} ${viewport.canvasHeight}`);
        copy.setAttribute("width", viewport.canvasWidth);
        copy.setAttribute("height", viewport.canvasHeight);
        copy.querySelectorAll(".transition-hit-area,.transition-control").forEach(item => item.remove());
        const style = document.createElementNS(NS, "style");
        style.textContent = `.visual-state circle{fill:#fff;stroke:#1f2937;stroke-width:3}.visual-state text,.visual-transition text{fill:#111827;font:600 14px sans-serif}.visual-transition>path{fill:none;stroke:#374151;stroke-width:2.5}.transition-label rect{fill:#fff;stroke:#3273dc;stroke-width:2}.transition-label.is-uncontrollable rect{stroke:#e53935}.transition-label.is-uncontrollable text{fill:#c62828}.visual-arrow-head{fill:#374151}.initial-arrow{fill:none;stroke:#111827;stroke-width:3}`;
        copy.prepend(style);
        download(new XMLSerializer().serializeToString(copy), "image/svg+xml;charset=utf-8", "svg");
    }

    const texEscape = value => String(value).replace(/([#$%&_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
    function exportTikz() {
        const lines = ["\\begin{tikzpicture}[>=stealth,auto,node distance=2cm,semithick,", "  state/.style={circle,draw,minimum size=16mm},", "  marked/.style={state,double,double distance=2pt}]" ];
        const ids = new Map(draft.states.map((q, index) => [q.id, `q${index}`]));
        for (const q of draft.states) {
            const x = (q.x / 60).toFixed(3), y = ((viewport.canvasHeight - q.y) / 60).toFixed(3);
            lines.push(`  \\node[${q.marked ? "marked" : "state"}] (${ids.get(q.id)}) at (${x},${y}) {${texEscape(q.name)}};`);
        }
        if (draft.initialStateId && ids.has(draft.initialStateId)) lines.push(`  \\draw[->] ([xshift=-14mm]${ids.get(draft.initialStateId)}.west) -- (${ids.get(draft.initialStateId)}.west);`);
        for (const edge of draft.transitions) {
            const source = ids.get(edge.sourceId), target = ids.get(edge.targetId);
            const labels = edge.eventNames.map(name => draft.events.find(e => e.name === name)?.controllable === false ? `\\textcolor{red}{${texEscape(name)}}` : texEscape(name)).join(", ");
            if (edge.sourceId === edge.targetId) {
                const state = stateAt(edge.sourceId), side = edge.controlY < state.y ? "above" : "below";
                lines.push(`  \\path[->] (${source}) edge[loop ${side}] node {${labels}} (${target});`);
            } else {
                const a = stateAt(edge.sourceId), b = stateAt(edge.targetId), cross = (b.x-a.x)*(edge.controlY-a.y)-(b.y-a.y)*(edge.controlX-a.x);
                const midpointX = (a.x+b.x)/2, midpointY = (a.y+b.y)/2, bend = Math.hypot(edge.controlX-midpointX, edge.controlY-midpointY);
                const option = bend > 10 ? `bend ${cross > 0 ? "left" : "right"}=${Math.min(45, Math.max(10, Math.round(bend / 3)))}` : "";
                lines.push(`  \\path[->] (${source}) edge[${option}] node {${labels}} (${target});`);
            }
        }
        lines.push("\\end{tikzpicture}", "");
        download(lines.join("\n"), "text/plain;charset=utf-8", "tex");
    }

    function deleteSelection() {
        if (!selection || layoutOnly) return;
        if (selection.type === "state") { draft.states = draft.states.filter(q => q.id !== selection.id); draft.transitions = draft.transitions.filter(t => t.sourceId !== selection.id && t.targetId !== selection.id); if (draft.initialStateId === selection.id) draft.initialStateId = null; }
        else draft.transitions = draft.transitions.filter(t => t.id !== selection.id);
        syncEvents(); selection = null; render();
    }
    return {
        setTool(tool) { commitSelection(); activeTool = tool; transitionSourceId = null; selection = null; render(); },
        deleteSelection,
        toggleMarked() { if (selection?.type === "state") { const state = stateAt(selection.id); state.marked = !state.marked; render(); } },
        setInitial() { if (selection?.type === "state") { draft.initialStateId = selection.id; render(); } },
        toggleControllability() { if (selection?.type === "transition") { toggleControllability(edgeAt(selection.id), selection.eventName); render(); } },
        editSelection() { if (!selection) return; const target = selection.type === "state" ? stateAt(selection.id) : edgeAt(selection.id); const current = selection.type === "state" ? target.name : (target.text ?? target.eventNames.join(", ")); const value = window.prompt(selection.type === "state" ? "State name" : "Comma-separated events", current); if (value === null) return; if (selection.type === "state") { if (!draft.states.some(q => q.id !== target.id && q.name === value.trim())) target.name = value.trim(); } else { target.text = value; commitTransition(target); } render(); },
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
        exportSvg,
        exportTikz,
        dispose() { clearTimeout(touchHoldTimer); clearTimeout(clickRenderTimer); host.replaceChildren(); }
    };
}
