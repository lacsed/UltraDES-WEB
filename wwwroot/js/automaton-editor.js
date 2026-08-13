const NS = "http://www.w3.org/2000/svg";

export function createAutomatonEditor(host) {
    const draft = { states: [], events: [], transitions: [], initialStateId: null };
    let selection = null, drag = null, preview = null;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 900 520");
    svg.setAttribute("aria-label", "Automaton diagram");
    host.append(svg);
    const point = event => { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const stateAt = id => draft.states.find(q => q.id === id);
    // Pointer capture keeps move/up events reliable outside the SVG, but it also
    // makes event.target the SVG. Resolve the actual state below the pointer.
    const stateUnderPointer = event => document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-state-id]");
    const uid = prefix => `${prefix}-${crypto.randomUUID()}`;

    function addStateAt(p) {
        const raw = window.prompt("State name (must be unique):");
        if (raw === null) return;
        const name = raw.trim();
        if (!name) return void window.alert("State name cannot be blank.");
        if (draft.states.some(q => q.name === name)) return void window.alert("State names must be unique.");
        draft.states.push({ id: uid("state"), name, marked: false, x: p.x, y: p.y }); render();
    }
    function transitionPath(edge) {
        const a = stateAt(edge.sourceId), b = stateAt(edge.targetId);
        if (a.id === b.id) return `M ${a.x-18} ${a.y-20} Q ${edge.controlX} ${edge.controlY} ${a.x+18} ${a.y-20}`;
        return `M ${a.x} ${a.y} Q ${edge.controlX} ${edge.controlY} ${b.x} ${b.y}`;
    }
    function render() {
        svg.innerHTML = `<defs><marker id="visual-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>`;
        for (const edge of draft.transitions) {
            const g = document.createElementNS(NS, "g"), path = document.createElementNS(NS, "path");
            g.classList.add("visual-transition"); if (selection?.type === "transition" && selection.id === edge.id) g.classList.add("is-selected");
            path.setAttribute("d", transitionPath(edge)); path.setAttribute("marker-end", "url(#visual-arrow)"); path.dataset.transitionId = edge.id; g.append(path);
            const label = document.createElementNS(NS, "text"); label.setAttribute("x", edge.controlX); label.setAttribute("y", edge.controlY - 8); label.setAttribute("text-anchor", "middle");
            label.textContent = edge.eventNames.map(n => `${draft.events.find(e => e.name === n)?.controllable ? "🔓" : "🔒"} ${n}`).join(", "); label.dataset.transitionId = edge.id; g.append(label);
            const control = document.createElementNS(NS, "rect"); control.setAttribute("x", edge.controlX-5); control.setAttribute("y", edge.controlY-5); control.setAttribute("width", 10); control.setAttribute("height", 10); control.dataset.controlId = edge.id; control.classList.add("transition-control"); g.append(control); svg.append(g);
        }
        if (draft.initialStateId) { const q = stateAt(draft.initialStateId), p = document.createElementNS(NS, "path"); p.setAttribute("d", `M ${q.x-70} ${q.y} L ${q.x-30} ${q.y}`); p.setAttribute("marker-end", "url(#visual-arrow)"); p.classList.add("initial-arrow"); svg.append(p); }
        for (const q of draft.states) {
            const g = document.createElementNS(NS, "g"); g.classList.add("visual-state"); if (selection?.type === "state" && selection.id === q.id) g.classList.add("is-selected"); g.dataset.stateId = q.id;
            const circle = document.createElementNS(NS, "circle"); circle.setAttribute("cx", q.x); circle.setAttribute("cy", q.y); circle.setAttribute("r", 30); g.append(circle);
            if (q.marked) { const inner = document.createElementNS(NS, "circle"); inner.setAttribute("cx", q.x); inner.setAttribute("cy", q.y); inner.setAttribute("r", 24); g.append(inner); }
            const text = document.createElementNS(NS, "text"); text.setAttribute("x", q.x); text.setAttribute("y", q.y+5); text.setAttribute("text-anchor", "middle"); text.textContent = q.name; g.append(text); svg.append(g);
        }
        if (preview) { const p = document.createElementNS(NS, "path"); p.classList.add("transition-preview"); p.setAttribute("d", `M ${preview.from.x} ${preview.from.y} L ${preview.to.x} ${preview.to.y}`); svg.append(p); }
    }
    svg.addEventListener("pointerdown", e => {
        host.focus(); const p = point(e), control = e.target.closest?.("[data-control-id]"), stateEl = e.target.closest?.("[data-state-id]"), edgeEl = e.target.closest?.("[data-transition-id]");
        if (control) { selection = { type: "transition", id: control.dataset.controlId }; drag = { type: "control", id: control.dataset.controlId }; }
        else if (stateEl) { const q=stateAt(stateEl.dataset.stateId), fromEdge=Math.hypot(p.x-q.x,p.y-q.y)>20; selection = { type: "state", id: stateEl.dataset.stateId }; drag = { type: fromEdge ? "transition" : "state", id: stateEl.dataset.stateId, start: p, moved: false }; }
        else if (edgeEl) selection = { type: "transition", id: edgeEl.dataset.transitionId };
        else { selection = null; drag = { type: "canvas", start: p }; }
        svg.setPointerCapture(e.pointerId); render();
    });
    svg.addEventListener("pointermove", e => { if (!drag) return; const p = point(e);
        if (drag.type === "state") { const q = stateAt(drag.id); if (Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>5) { drag.moved=true; q.x=p.x; q.y=p.y; } }
        if (drag.type === "transition") { preview={from:stateAt(drag.id),to:p}; }
        if (drag.type === "control") { const t=draft.transitions.find(x=>x.id===drag.id); t.controlX=p.x; t.controlY=p.y; }
        render();
    });
    svg.addEventListener("pointerup", e => { const p=point(e); if (!drag) return;
        if (drag.type === "canvas" && Math.hypot(p.x-drag.start.x,p.y-drag.start.y)<5) addStateAt(p);
        else if (drag.type === "transition") { const target=stateUnderPointer(e); if (target) createTransition(drag.id,target.dataset.stateId); }
        drag=null; preview=null; render();
    });
    function createTransition(sourceId,targetId) {
        if (!draft.events.length) return void window.alert("Create an event first.");
        const raw=window.prompt("Comma-separated event names:"); if (raw===null) return;
        const names=raw.split(",").map(x=>x.trim());
        if (names.some(x=>!x)) return void window.alert("Event entries cannot be empty.");
        if (names.some(n=>!draft.events.some(e=>e.name===n))) return void window.alert("Every event must be created before it is used.");
        const a=stateAt(sourceId),b=stateAt(targetId); draft.transitions.push({id:uid("transition"),sourceId,targetId,eventNames:[...new Set(names)],controlX:(a.x+b.x)/2,controlY:sourceId===targetId?a.y-90:(a.y+b.y)/2-45});
    }
    host.addEventListener("keydown", e => { if (e.key==="Escape") { drag=null; preview=null; selection=null; render(); }
        if ((e.key==="Delete"||e.key==="Backspace")&&selection) { e.preventDefault(); if(selection.type==="state") { draft.states=draft.states.filter(q=>q.id!==selection.id); draft.transitions=draft.transitions.filter(t=>t.sourceId!==selection.id&&t.targetId!==selection.id); if(draft.initialStateId===selection.id)draft.initialStateId=null; } else draft.transitions=draft.transitions.filter(t=>t.id!==selection.id); selection=null; render(); }
    });
    render();
    return { addEvent(e) { draft.events.push({id:e.id,name:e.name,controllable:e.controllable}); }, toggleMarked() { if(selection?.type==="state"){const q=stateAt(selection.id);q.marked=!q.marked;render();} }, setInitial(){if(selection?.type==="state"){draft.initialStateId=selection.id;render();}}, getDraft(){return structuredClone(draft);}, dispose(){host.replaceChildren();} };
}
