using System;
using System.Collections.Generic;
using System.Linq;
using UltraDES;

namespace UltraDESWeb.Services;

/// <summary>Calculates the synchronous execution of a selected set of automata.</summary>
public sealed class AutomatonSimulationService
{
    public IReadOnlyDictionary<string, AbstractState> InitialStates(IEnumerable<DeterministicFiniteAutomaton> automata)
    {
        ArgumentNullException.ThrowIfNull(automata);
        return automata.ToDictionary(automaton => automaton.Name, automaton => automaton.InitialState, StringComparer.Ordinal);
    }

    public IReadOnlyList<AbstractEvent> EnabledEvents(IEnumerable<DeterministicFiniteAutomaton> automata,
        IReadOnlyDictionary<string, AbstractState> activeStates)
    {
        ArgumentNullException.ThrowIfNull(automata);
        ArgumentNullException.ThrowIfNull(activeStates);

        var enabled = new Dictionary<string, AbstractEvent>(StringComparer.Ordinal);
        var prohibited = new HashSet<string>(StringComparer.Ordinal);

        foreach (var automaton in automata)
        {
            if (!activeStates.TryGetValue(automaton.Name, out var state)) continue;
            var definedHere = automaton.Transitions.Where(transition => transition.Origin.Equals(state))
                .Select(transition => transition.Trigger).ToArray();
            foreach (var @event in definedHere) enabled.TryAdd(@event.ToString(), @event);

            var definedNames = definedHere.Select(@event => @event.ToString()).ToHashSet(StringComparer.Ordinal);
            foreach (var @event in automaton.Events)
                if (!definedNames.Contains(@event.ToString())) prohibited.Add(@event.ToString());
        }

        return enabled.Where(item => !prohibited.Contains(item.Key)).OrderBy(item => item.Key, StringComparer.Ordinal)
            .Select(item => item.Value).ToArray();
    }

    public IReadOnlyDictionary<string, AbstractState> Fire(IEnumerable<DeterministicFiniteAutomaton> automata,
        IReadOnlyDictionary<string, AbstractState> activeStates, string eventName)
    {
        ArgumentNullException.ThrowIfNull(automata);
        ArgumentNullException.ThrowIfNull(activeStates);
        if (string.IsNullOrWhiteSpace(eventName)) throw new ArgumentException("An event must be selected.", nameof(eventName));

        var selected = automata.ToArray();
        if (!EnabledEvents(selected, activeStates).Any(@event => string.Equals(@event.ToString(), eventName, StringComparison.Ordinal)))
            throw new InvalidOperationException($"Event '{eventName}' is not enabled in the current state.");

        var result = new Dictionary<string, AbstractState>(activeStates, StringComparer.Ordinal);
        foreach (var automaton in selected)
        {
            if (!activeStates.TryGetValue(automaton.Name, out var state)) continue;
            var transition = automaton.Transitions.SingleOrDefault(item => item.Origin.Equals(state) &&
                string.Equals(item.Trigger.ToString(), eventName, StringComparison.Ordinal));
            if (transition is not null) result[automaton.Name] = transition.Destination;
        }
        return result;
    }
}
