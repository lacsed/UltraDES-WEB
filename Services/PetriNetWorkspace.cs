using System;
using System.Collections.Generic;
using System.Linq;
using UltraDES.PetriNets;

namespace UltraDESWeb.Services;

/// <summary>Serializable description of a Petri net and its initial marking.</summary>
public sealed record PetriNetDraft(string Name, string[] Places, string[] Transitions,
    PetriArcDraft[] Arcs, Dictionary<string, uint> InitialMarking);

public sealed record PetriArcDraft(string Origin, string Destination, uint Weight);

/// <summary>Creates UltraDES objects from the browser-friendly Petri-net representation.</summary>
public static class PetriNetWorkspace
{
    public static (PetriNet Net, Marking Marking) Build(PetriNetDraft draft)
    {
        ArgumentNullException.ThrowIfNull(draft);
        var name = draft.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("The net name is required.");

        var placeNames = Normalize(draft.Places, "place");
        var transitionNames = Normalize(draft.Transitions, "transition");
        var collision = placeNames.Intersect(transitionNames, StringComparer.Ordinal).FirstOrDefault();
        if (collision is not null) throw new ArgumentException($"'{collision}' cannot be both a place and a transition.");

        var places = placeNames.ToDictionary(value => value, value => new Place(value), StringComparer.Ordinal);
        var transitions = transitionNames.ToDictionary(value => value, value => new Transition(value), StringComparer.Ordinal);
        var nodes = places.ToDictionary(pair => pair.Key, pair => (Node)pair.Value, StringComparer.Ordinal);
        foreach (var pair in transitions) nodes.Add(pair.Key, pair.Value);

        var arcs = (draft.Arcs ?? []).Select(arc =>
        {
            if (arc.Weight == 0) throw new ArgumentException("Arc weights must be greater than zero.");
            if (!nodes.TryGetValue(arc.Origin?.Trim() ?? "", out var origin) ||
                !nodes.TryGetValue(arc.Destination?.Trim() ?? "", out var destination))
                throw new ArgumentException($"Arc '{arc.Origin} → {arc.Destination}' references an unknown node.");
            if (origin is Place == destination is Place)
                throw new ArgumentException($"Arc '{arc.Origin} → {arc.Destination}' must connect a place and a transition.");
            return (origin, destination, arc.Weight);
        }).ToArray();

        var marking = new Marking(places.Select(pair =>
            (pair.Value, (draft.InitialMarking ?? []).GetValueOrDefault(pair.Key))));
        return (new PetriNet(arcs, name), marking);
    }

    public static PetriNetDraft Combine(PetriNetDraft first, PetriNetDraft second, string name)
    {
        var (left, leftMarking) = Build(first);
        var (right, rightMarking) = Build(second);
        _ = left + right;
        var placeNames = first.Places.Concat(second.Places).Distinct(StringComparer.Ordinal).OrderBy(value => value).ToArray();
        var transitionNames = first.Transitions.Concat(second.Transitions).Distinct(StringComparer.Ordinal).OrderBy(value => value).ToArray();
        var marking = placeNames.ToDictionary(place => place, place =>
            Math.Max(first.InitialMarking.GetValueOrDefault(place), second.InitialMarking.GetValueOrDefault(place)), StringComparer.Ordinal);
        var arcs = first.Arcs.Concat(second.Arcs)
            .GroupBy(arc => (arc.Origin, arc.Destination))
            .Select(group => new PetriArcDraft(group.Key.Origin, group.Key.Destination, group.Max(arc => arc.Weight)))
            .ToArray();
        return new PetriNetDraft(name, placeNames, transitionNames, arcs, marking);
    }

    private static string[] Normalize(IEnumerable<string> values, string kind)
    {
        var normalized = (values ?? []).Select(value => value?.Trim()).Where(value => !string.IsNullOrWhiteSpace(value)).ToArray()!;
        var duplicate = normalized.GroupBy(value => value, StringComparer.Ordinal).FirstOrDefault(group => group.Count() > 1)?.Key;
        if (duplicate is not null) throw new ArgumentException($"Duplicate {kind} '{duplicate}'.");
        if (normalized.Length == 0) throw new ArgumentException($"At least one {kind} is required.");
        return normalized;
    }
}
