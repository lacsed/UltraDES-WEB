using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UltraDES.PetriNets;

namespace UltraDESWeb.Services;

/// <summary>Serializable description of a Petri net and its initial marking.</summary>
public sealed record PetriNetDraft(string Name, string[] Places, string[] Transitions,
    PetriArcDraft[] Arcs, Dictionary<string, uint> InitialMarking);

public sealed record PetriArcDraft(string Origin, string Destination, uint Weight);

/// <summary>Creates UltraDES objects from the browser-friendly Petri-net representation.</summary>
public static class PetriNetWorkspace
{
    /// <summary>Splits a comma-separated list of node names, trimming and de-duplicating entries.</summary>
    public static string[] ParseNames(string value) => (value ?? string.Empty)
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .Distinct(StringComparer.Ordinal)
        .ToArray();

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

    /// <summary>Creates a Graphviz representation whose place labels show the current token count.</summary>
    public static string ToSimulationDot(PetriNetDraft draft, Marking marking)
    {
        ArgumentNullException.ThrowIfNull(draft);
        ArgumentNullException.ThrowIfNull(marking);

        var placeNames = Normalize(draft.Places, "place");
        var transitionNames = Normalize(draft.Transitions, "transition");
        var placeSet = placeNames.ToHashSet(StringComparer.Ordinal);
        var transitionSet = transitionNames.ToHashSet(StringComparer.Ordinal);
        var tokens = marking.Values.ToDictionary(item => item.Item1.ToString(), item => item.Item2, StringComparer.Ordinal);
        var dot = new StringBuilder();

        dot.AppendLine("digraph PetriNet {");
        dot.AppendLine("  rankdir=LR;");
        dot.AppendLine("  graph [bgcolor=\"transparent\", pad=\"0.2\", nodesep=\"0.75\", ranksep=\"0.85\"];");
        dot.AppendLine("  node [fontname=\"Arial\", color=\"#2867e8\", fontcolor=\"#15233b\", penwidth=\"2\"];");
        dot.AppendLine("  edge [fontname=\"Arial\", color=\"#718096\", fontcolor=\"#475569\", penwidth=\"1.5\", arrowsize=\"0.75\"];");

        foreach (var place in placeNames)
        {
            tokens.TryGetValue(place, out var count);
            var tokenLabel = count is null ? "ω" : count == 0 ? string.Empty : count.Value.ToString();
            dot.Append("  ").Append(DotQuote($"place:{place}"))
                .Append(" [shape=circle, fixedsize=true, width=\"0.72\", height=\"0.72\", label=")
                .Append(DotQuote(tokenLabel)).Append(", xlabel=").Append(DotQuote(place)).AppendLine("];");
        }

        foreach (var transition in transitionNames)
        {
            dot.Append("  ").Append(DotQuote($"transition:{transition}"))
                .Append(" [shape=box, fixedsize=true, width=\"0.18\", height=\"0.78\", style=filled, fillcolor=\"#2867e8\", label=\"\", xlabel=")
                .Append(DotQuote(transition)).AppendLine("];");
        }

        foreach (var arc in draft.Arcs ?? [])
        {
            var originPrefix = placeSet.Contains(arc.Origin) ? "place" : transitionSet.Contains(arc.Origin) ? "transition" : null;
            var destinationPrefix = placeSet.Contains(arc.Destination) ? "place" : transitionSet.Contains(arc.Destination) ? "transition" : null;
            if (originPrefix is null || destinationPrefix is null) continue;

            dot.Append("  ").Append(DotQuote($"{originPrefix}:{arc.Origin}"))
                .Append(" -> ").Append(DotQuote($"{destinationPrefix}:{arc.Destination}"));
            if (arc.Weight > 1) dot.Append(" [label=").Append(DotQuote(arc.Weight.ToString())).Append(']');
            dot.AppendLine(";");
        }

        dot.AppendLine("}");
        return dot.ToString();
    }

    private static string[] Normalize(IEnumerable<string> values, string kind)
    {
        var normalized = (values ?? []).Select(value => value?.Trim()).Where(value => !string.IsNullOrWhiteSpace(value)).ToArray()!;
        var duplicate = normalized.GroupBy(value => value, StringComparer.Ordinal).FirstOrDefault(group => group.Count() > 1)?.Key;
        if (duplicate is not null) throw new ArgumentException($"Duplicate {kind} '{duplicate}'.");
        if (normalized.Length == 0) throw new ArgumentException($"At least one {kind} is required.");
        return normalized;
    }

    private static string DotQuote(string value) => $"\"{(value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ")}\"";
}
