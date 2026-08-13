using System;
using System.Collections.Generic;
using System.Linq;
using UltraDES;

namespace UltraDESWeb.Services;

public sealed class AutomatonDraftValidator
{
    public sealed record StateDraft(string Id, string Name, bool Marked);
    public sealed record EventDraft(string Id, string Name, bool Controllable);
    public sealed record TransitionDraft(string OriginId, string DestinationId, IReadOnlyCollection<string> EventIds);
    public sealed record Draft(string Name, IReadOnlyCollection<StateDraft> States,
        IReadOnlyCollection<EventDraft> Events, IReadOnlyCollection<TransitionDraft> Transitions,
        string InitialStateId);
    public sealed record Result(DeterministicFiniteAutomaton Automaton, IReadOnlyList<string> Errors)
    {
        public bool IsValid => Automaton is not null && Errors.Count == 0;
    }

    public Result ValidateAndCreate(Draft draft, IEnumerable<string> existingAutomatonNames = null)
    {
        var errors = new List<string>();
        var name = draft.Name?.Trim() ?? "";
        if (name.Length == 0) errors.Add("Automaton name cannot be blank.");
        else if (existingAutomatonNames?.Any(n => string.Equals(n, name, StringComparison.Ordinal)) == true)
            errors.Add($"An automaton named '{name}' already exists.");

        var states = draft.States.ToArray();
        if (states.Length == 0) errors.Add("At least one state is required.");
        ValidateNames(states.Select(s => s.Name), "State", errors);
        var stateIds = states.GroupBy(s => s.Id).ToDictionary(g => g.Key, g => g.First());
        if (string.IsNullOrWhiteSpace(draft.InitialStateId) || !stateIds.ContainsKey(draft.InitialStateId))
            errors.Add("Exactly one valid initial state is required.");

        var events = draft.Events.ToArray();
        ValidateNames(events.Select(e => e.Name), "Event", errors);
        foreach (var group in events.Where(e => !string.IsNullOrWhiteSpace(e.Name)).GroupBy(e => e.Name.Trim(), StringComparer.Ordinal))
            if (group.Select(e => e.Controllable).Distinct().Count() > 1)
                errors.Add($"Event '{group.Key}' has conflicting controllability declarations.");

        var eventIds = events.GroupBy(e => e.Id).ToDictionary(g => g.Key, g => g.First());
        var expanded = new List<(string Origin, string Event, string Destination)>();
        var row = 0;
        foreach (var transition in draft.Transitions)
        {
            row++;
            var valid = true;
            if (string.IsNullOrWhiteSpace(transition.OriginId) || !stateIds.ContainsKey(transition.OriginId))
            { errors.Add($"Transition {row} must have a valid origin state."); valid = false; }
            if (string.IsNullOrWhiteSpace(transition.DestinationId) || !stateIds.ContainsKey(transition.DestinationId))
            { errors.Add($"Transition {row} must have a valid destination state."); valid = false; }
            if (transition.EventIds is null || transition.EventIds.Count == 0)
            { errors.Add($"Transition {row} must have at least one event."); valid = false; }
            else if (transition.EventIds.Any(id => string.IsNullOrWhiteSpace(id) || !eventIds.ContainsKey(id)))
            { errors.Add($"Transition {row} contains an invalid event."); valid = false; }
            if (valid)
                expanded.AddRange(transition.EventIds.Select(id => (transition.OriginId, id, transition.DestinationId)));
        }

        var uniqueTransitions = expanded.Distinct().ToArray();
        foreach (var group in uniqueTransitions.GroupBy(t => (t.Origin, t.Event)))
            if (group.Select(t => t.Destination).Distinct().Count() > 1)
                errors.Add($"Nondeterministic transitions from state '{stateIds[group.Key.Origin].Name}' on event '{eventIds[group.Key.Event].Name}' have different destinations.");

        if (errors.Count > 0) return new Result(null, errors.Distinct().ToArray());
        try
        {
            var ultraStates = stateIds.ToDictionary(p => p.Key, p => (AbstractState)new State(p.Value.Name.Trim(), p.Value.Marked ? Marking.Marked : Marking.Unmarked));
            var ultraEvents = eventIds.ToDictionary(p => p.Key, p => (AbstractEvent)new Event(p.Value.Name.Trim(), p.Value.Controllable ? Controllability.Controllable : Controllability.Uncontrollable));
            var transitions = uniqueTransitions.Select(t => new Transition(ultraStates[t.Origin], ultraEvents[t.Event], ultraStates[t.Destination])).ToArray();
            return new Result(new DeterministicFiniteAutomaton(transitions, ultraStates[draft.InitialStateId], name), Array.Empty<string>());
        }
        catch (Exception ex)
        {
            return new Result(null, new[] { $"UltraDES could not construct the automaton: {ex.Message}" });
        }
    }

    private static void ValidateNames(IEnumerable<string> names, string category, ICollection<string> errors)
    {
        var values = names.Select(n => n?.Trim() ?? "").ToArray();
        if (values.Any(n => n.Length == 0)) errors.Add($"Every {category.ToLowerInvariant()} must have a nonblank name.");
        foreach (var duplicate in values.Where(n => n.Length > 0).GroupBy(n => n, StringComparer.Ordinal).Where(g => g.Count() > 1))
            errors.Add($"{category} name '{duplicate.Key}' must be unique.");
    }
}
