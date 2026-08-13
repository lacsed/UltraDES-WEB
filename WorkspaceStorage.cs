using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.JSInterop;
using UltraDES;

namespace UltraDESWeb;

/// <summary>Persists the user's workspace in browser-owned storage.</summary>
public sealed class WorkspaceStorage(IJSRuntime js)
{
    private const string V1StorageKey = "ultrades.workspace.v1";
    private const string StorageKey = "ultrades.workspace.v2";

    public async Task SaveAsync(
        IEnumerable<AbstractState> states,
        IEnumerable<AbstractEvent> events,
        IEnumerable<StoredAutomaton> automata)
    {
        // One payload/setItem is intentional: automata and their optional layouts must
        // never be observable at different revisions.
        var workspace = new WorkspaceData(2,
            states.Select(state => new StateData(state.ToString(), state.Marking)).ToArray(),
            events.Select(@event => new EventData(@event.ToString(), @event.Controllability)).ToArray(),
            automata.ToArray());

        await js.InvokeVoidAsync("localStorage.setItem", StorageKey, JsonSerializer.Serialize(workspace));
    }

    public async Task<WorkspaceData> LoadAsync()
    {
        var json = await js.InvokeAsync<string>("localStorage.getItem", StorageKey);
        if (!string.IsNullOrWhiteSpace(json))
        {
            try
            {
                var current = JsonSerializer.Deserialize<WorkspaceData>(json);
                return current?.Version == 2 ? current : null;
            }
            catch (JsonException) { return null; }
        }

        // Explicit v1 -> v2 migration. V1 had only automaton JSON; give every
        // automaton a stable id and retain it with no layout rather than dropping it.
        var oldJson = await js.InvokeAsync<string>("localStorage.getItem", V1StorageKey);
        if (string.IsNullOrWhiteSpace(oldJson)) return null;
        try
        {
            var old = JsonSerializer.Deserialize<WorkspaceDataV1>(oldJson);
            if (old is null) return null;
            var migrated = new WorkspaceData(2, old.States ?? [], old.Events ?? [],
                (old.Automata ?? []).Select(value => new StoredAutomaton(Guid.NewGuid().ToString("N"), value, null)).ToArray());
            await js.InvokeVoidAsync("localStorage.setItem", StorageKey, JsonSerializer.Serialize(migrated));
            return migrated;
        }
        catch (JsonException) { return null; }
    }
}

public sealed record WorkspaceData(int Version, StateData[] States, EventData[] Events, StoredAutomaton[] Automata);
public sealed record StoredAutomaton(string Id, string Json, AutomatonLayoutData Layout);
public sealed record AutomatonLayoutData(double CanvasWidth, double CanvasHeight, double Zoom, double PanX, double PanY,
    StateLayoutData[] States, TransitionLayoutData[] Transitions);
public sealed record StateLayoutData(string State, double X, double Y);
public sealed record TransitionLayoutData(string Source, string Target, string[] Events, double ControlX, double ControlY);
public sealed record StateData(string Alias, Marking Marking);
public sealed record EventData(string Alias, Controllability Controllability);
internal sealed record WorkspaceDataV1(StateData[] States, EventData[] Events, string[] Automata);
