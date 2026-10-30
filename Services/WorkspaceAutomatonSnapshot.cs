using System;
using System.Linq;
using UltraDES;

namespace UltraDESWeb.Services;

/// <summary>
/// Cached derived data for a workspace model. Workspace operations add new models;
/// if a model is replaced or mutated, replace this snapshot as well.
/// </summary>
public sealed class WorkspaceAutomatonSnapshot(DeterministicFiniteAutomaton automaton)
{
    private readonly Lazy<string> json = new(() => AutomatonJsonWriter.Write(automaton));
    private readonly Lazy<int> stateCount = new(() => automaton.States.Count());
    private readonly Lazy<int> eventCount = new(() => automaton.Events.Count());
    private readonly Lazy<int> transitionCount = new(() => automaton.Transitions.Count());
    public string Json => json.Value;
    public int StateCount => stateCount.Value;
    public int EventCount => eventCount.Value;
    public int TransitionCount => transitionCount.Value;
}
