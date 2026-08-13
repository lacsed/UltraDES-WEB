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
    private const string StorageKey = "ultrades.workspace.v1";

    public async Task SaveAsync(
        IEnumerable<AbstractState> states,
        IEnumerable<AbstractEvent> events,
        IEnumerable<DeterministicFiniteAutomaton> automata)
    {
        var workspace = new WorkspaceData(
            states.Select(state => new StateData(state.ToString(), state.Marking)).ToArray(),
            events.Select(@event => new EventData(@event.ToString(), @event.Controllability)).ToArray(),
            automata.Select(automaton => DeterministicFiniteAutomaton.ToJsonString(automaton)).ToArray());

        await js.InvokeVoidAsync("localStorage.setItem", StorageKey, JsonSerializer.Serialize(workspace));
    }

    public async Task<WorkspaceData> LoadAsync()
    {
        var json = await js.InvokeAsync<string>("localStorage.getItem", StorageKey);
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            return JsonSerializer.Deserialize<WorkspaceData>(json);
        }
        catch (JsonException)
        {
            // A damaged/old value must not prevent the application from starting.
            return null;
        }
    }
}

public sealed record WorkspaceData(StateData[] States, EventData[] Events, string[] Automata);
public sealed record StateData(string Alias, Marking Marking);
public sealed record EventData(string Alias, Controllability Controllability);
