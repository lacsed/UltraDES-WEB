const NS = "http://www.w3.org/2000/svg";

export function createAutomatonEditor(host, layoutOnly = false) {
    const draft = { states: [], events: [], transitions: [], initialStateId: null };
    let selection = null, drag = null, preview = null;
    let viewport = { canvasWidth: 900, canvasHeight: 520, zoom: 1, panX: 0, panY: 0 };
    const svg = document.createElementNS(NS, "svg");
    const updateViewBox = () => { svg.setAttribute("viewBox", `${viewport.panX} ${viewport.panY} ${viewport.canvasWidth / viewport.zoom} ${viewport.canvasHeight / viewport.zoom}`); };
    updateViewBox();
    svg.setAttribute("aria-label", "Automaton diagram");
    host.append(svg);
    const point = event => { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const stateAt = id => draft.states.find(q => q.id === id);
    // Pointer capture keeps move/up events reliable outside the SVG, but it also
    // makes event.target the SVG. Resolve the actual state below the pointer.
    const stateUnderPointer = event => document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-state-id]");
    const uid = prefix => `${prefix}-${crypto.randomUUID()}`;

    function addStateAt(p) {
        let index = draft.states.length;
        while (draft.states.some(q => q.name === `q${index}`)) index++;
        const state = { id: uid("state"), name: `q${index}`, marked: false, x: p.x, y: p.y };
        draft.states.push(state);
        selection = { type: "state", id: state.id, replaceOnType: true };
        render();
    }
    const clippedPoint = (from, to, radius = 32) => { const dx=to.x-from.x, dy=to.y-from.y, length=Math.hypot(dx,dy)||1; return {x:from.x+dx*radius/length,y:from.y+dy*radius/length}; };
    function transitionPath(edge) {
        const a = stateAt(edge.sourceId), b = stateAt(edge.targetId);
        if (a.id === b.id) return `M ${a.x-18} ${a.y-20} Q ${edge.controlX} ${edge.controlY} ${a.x+18} ${a.y-20}`;
        const start=clippedPoint(a,{x:edge.controlX,y:edge.controlY}), end=clippedPoint(b,{x:edge.controlX,y:edge.controlY});
        return `M ${start.x} ${start.y} Q ${edge.controlX} ${edge.controlY} ${end.x} ${end.y}`;
    }
    const eventNames = edge => (edge.text ?? edge.eventNames.join(","))
        .split(",").map(name => name.trim()).filter(Boolean);
    function syncEvents() {
        const used = new Set(draft.transitions.flatMap(eventNames));
        draft.events = draft.events.filter(e => used.has(e.name));
        for (const name of used) if (!draft.events.some(e => e.name === name))
            draft.events.push({id:uid("event"),name,controllable:true});
        draft.transitions.forEach(edge => edge.eventNames = eventNames(edge));
    }
    function render() {
        svg.innerHTML = `<defs><marker id="visual-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path class="visual-arrow-head" d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>`;
        for (const edge of draft.transitions) {
            const g = document.createElementNS(NS, "g"), path = document.createElementNS(NS, "path");
            g.classList.add("visual-transition"); if (selection?.type === "transition" && selection.id === edge.id) g.classList.add("is-selected");
            path.setAttribute("d", transitionPath(edge)); path.setAttribute("marker-end", "url(#visual-arrow)"); path.dataset.transitionId = edge.id; g.append(path);
            const names=eventNames(edge), shown=names.length ? names : ["type events"];
            const widths=shown.map(name => Math.max(42, name.length * 8 + 22)), total=widths.reduce((a,b)=>a+b,0)+(shown.length-1)*6;
            let labelX=edge.controlX-total/2;
            shown.forEach((name,index) => {
                const badge=document.createElementNS(NS,"g"), box=document.createElementNS(NS,"rect"), label=document.createElementNS(NS,"text");
                box.setAttribute("x",labelX); box.setAttribute("y",edge.controlY-38); box.setAttribute("width",widths[index]); box.setAttribute("height",24); box.setAttribute("rx",4);
                label.setAttribute("x",labelX+widths[index]/2); label.setAttribute("y",edge.controlY-21); label.setAttribute("text-anchor","middle");
                const item=draft.events.find(e=>e.name===name); label.textContent=name + (item ? (item.controllable ? " C" : " UC") : "");
                badge.classList.add("event-badge"); badge.dataset.transitionId=edge.id;
                if(item) badge.dataset.eventName=name;
                badge.append(box,label); g.append(badge); labelX+=widths[index]+6;
            });
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
        else if (stateEl) { const createEdge=!layoutOnly && e.shiftKey; selection = { type: "state", id: stateEl.dataset.stateId }; drag = { type: createEdge ? "transition" : "state", id: stateEl.dataset.stateId, start: p, moved: false }; }
        else if (edgeEl) selection = { type: "transition", id: edgeEl.dataset.transitionId };
        else { selection = null; drag = { type: "canvas", start: p, originX: viewport.panX, originY: viewport.panY, moved: false }; }
        svg.setPointerCapture(e.pointerId); render();
    });
    svg.addEventListener("pointermove", e => { if (!drag) return; const p = point(e);
        if (drag.type === "state") { const q = stateAt(drag.id); if (Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>5) { drag.moved=true; q.x=p.x; q.y=p.y; } }
        if (drag.type === "transition" && Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>5) { drag.moved=true; preview={from:stateAt(drag.id),to:p}; }
        if (drag.type === "canvas" && layoutOnly) { drag.moved = true; viewport.panX = drag.originX - (p.x-drag.start.x); viewport.panY = drag.originY - (p.y-drag.start.y); updateViewBox(); }
        if (drag.type === "control") { const t=draft.transitions.find(x=>x.id===drag.id); t.controlX=p.x; t.controlY=p.y; }
        render();
    });
    svg.addEventListener("pointerup", e => { const p=point(e); if (!drag) return;
        if (drag.type === "transition" && drag.moved) { const target=stateUnderPointer(e); if (target) createTransition(drag.id,target.dataset.stateId); }
        drag=null; preview=null; render();
    });
    svg.addEventListener("dblclick", e => {
        if (layoutOnly) return;
        const p=point(e), eventEl=e.target.closest?.("[data-event-name]"), stateEl=e.target.closest?.("[data-state-id]");
        if (eventEl) { const item=draft.events.find(x=>x.name===eventEl.dataset.eventName); if(item)item.controllable=!item.controllable; selection={type:"transition",id:eventEl.dataset.transitionId}; render(); }
        else if (stateEl) { const q=stateAt(stateEl.dataset.stateId); if(e.shiftKey) draft.initialStateId=q.id; else q.marked=!q.marked; render(); }
        else if (!e.target.closest?.("[data-transition-id]")) addStateAt(p);
    });
    function createTransition(sourceId,targetId) {
        const a=stateAt(sourceId),b=stateAt(targetId), edge={id:uid("transition"),sourceId,targetId,eventNames:[],text:"",controlX:(a.x+b.x)/2,controlY:sourceId===targetId?a.y-90:(a.y+b.y)/2-45};
        draft.transitions.push(edge); selection={type:"transition",id:edge.id,replaceOnType:true}; render();
    }
    host.addEventListener("keydown", e => { if (e.key==="Escape") { drag=null; preview=null; selection=null; render(); }
        if (!layoutOnly && e.key==="Delete"&&selection) { e.preventDefault(); if(selection.type==="state") { draft.states=draft.states.filter(q=>q.id!==selection.id); draft.transitions=draft.transitions.filter(t=>t.sourceId!==selection.id&&t.targetId!==selection.id); if(draft.initialStateId===selection.id)draft.initialStateId=null; } else draft.transitions=draft.transitions.filter(t=>t.id!==selection.id); syncEvents(); selection=null; render(); }
        if (!layoutOnly && selection && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const target=selection.type==="state"?stateAt(selection.id):draft.transitions.find(t=>t.id===selection.id);
            let value=selection.type==="state"?target?.name:(target?.text ?? target?.eventNames.join(",") ?? "");
            if (e.key==="Backspace" && target) { e.preventDefault(); value=value.slice(0,-1); }
            else if (e.key.length===1 && (!/\s/.test(e.key) || selection.type==="state") && target) { e.preventDefault(); value=selection.replaceOnType?e.key:value+e.key; selection.replaceOnType=false; }
            else return;
            if (selection.type==="state") { if(value && !draft.states.some(q=>q.id!==target.id&&q.name===value))target.name=value; }
            else { target.text=value; syncEvents(); }
            render();
        }
    });
    svg.addEventListener("wheel", e => { if (!layoutOnly) return; e.preventDefault(); const before=point(e), factor=e.deltaY<0?1.12:1/1.12; viewport.zoom=Math.max(.25,Math.min(4,viewport.zoom*factor)); updateViewBox(); const after=point(e); viewport.panX += before.x-after.x; viewport.panY += before.y-after.y; updateViewBox(); }, {passive:false});
    render();
    return {
        loadAutomaton(value, layout) { Object.assign(draft, structuredClone(value));
            const savedStates = new Map((layout?.states || []).map(q => [q.state, q]));
            draft.states.forEach((q,i) => { const saved=savedStates.get(q.name); q.x=saved?.x ?? 100+(i%6)*130; q.y=saved?.y ?? 100+Math.floor(i/6)*120; });
            draft.transitions.forEach(t => { t.text=t.eventNames.join(","); const events=[...t.eventNames].sort().join("\u001f"); const saved=(layout?.transitions||[]).find(x=>x.source===t.sourceId&&x.target===t.targetId&&[...x.events].sort().join("\u001f")===events); const a=stateAt(t.sourceId),b=stateAt(t.targetId); t.controlX=saved?.controlX ?? (a.x+b.x)/2; t.controlY=saved?.controlY ?? (t.sourceId===t.targetId?a.y-90:(a.y+b.y)/2-45); });
            if(layout) viewport={canvasWidth:layout.canvasWidth||900,canvasHeight:layout.canvasHeight||520,zoom:layout.zoom||1,panX:layout.panX||0,panY:layout.panY||0}; updateViewBox(); render(); },
        getDraft(){syncEvents();return structuredClone(draft);},
        getLayout(){ return {...viewport,states:draft.states.map(q=>({state:q.name,x:q.x,y:q.y})),transitions:draft.transitions.map(t=>({source:t.sourceId,target:t.targetId,events:t.eventNames,controlX:t.controlX,controlY:t.controlY}))}; },
        dispose(){host.replaceChildren();}
    };
}
