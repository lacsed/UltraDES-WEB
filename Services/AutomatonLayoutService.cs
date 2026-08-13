using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UltraDES;

namespace UltraDESWeb.Services;

/// <summary>Creates repeatable editor geometry without changing the source automaton.</summary>
public sealed class AutomatonLayoutService
{
    public const int MaximumStateCount = 100;
    public bool CanConvert(DeterministicFiniteAutomaton automaton) => automaton is not null && automaton.States.Count() <= MaximumStateCount;

    public async Task<AutomatonLayoutData> CreateAsync(DeterministicFiniteAutomaton automaton,
        IProgress<string> progress = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(automaton);
        var states = automaton.States.OrderBy(Key, StringComparer.Ordinal).ToArray();
        if (states.Length > MaximumStateCount)
            throw new InvalidOperationException($"Visual conversion supports at most {MaximumStateCount} states.");
        cancellationToken.ThrowIfCancellationRequested();
        progress?.Report("Analyzing automaton components…");
        await Task.Yield();

        var transitions = automaton.Transitions.OrderBy(t => Key(t.Origin), StringComparer.Ordinal)
            .ThenBy(t => Key(t.Destination), StringComparer.Ordinal).ThenBy(t => t.Trigger.ToString(), StringComparer.Ordinal).ToArray();
        var neighbors = states.ToDictionary(q => q, _ => new HashSet<AbstractState>());
        foreach (var transition in transitions) { neighbors[transition.Origin].Add(transition.Destination); neighbors[transition.Destination].Add(transition.Origin); }
        var components = FindComponents(states, neighbors, automaton.InitialState);
        var positions = new Dictionary<AbstractState, (double X, double Y)>();
        double componentTop = 100;
        for (var componentIndex = 0; componentIndex < components.Count; componentIndex++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            progress?.Report($"Positioning component {componentIndex + 1} of {components.Count}…");
            var component = components[componentIndex];
            var root = component.Contains(automaton.InitialState) ? automaton.InitialState : component[0];
            var levels = DirectedLevels(component, root, transitions);
            var widest = levels.Max(level => level.Count);
            for (var level = 0; level < levels.Count; level++)
                for (var index = 0; index < levels[level].Count; index++)
                    positions[levels[level][index]] = (120 + level * 180, componentTop + (widest - levels[level].Count) * 72.5 + index * 145);
            componentTop += Math.Max(1, widest) * 145 + 150;
            await Task.Yield();
        }

        cancellationToken.ThrowIfCancellationRequested();
        progress?.Report("Routing transition labels and curves…");
        var edgeLayouts = new List<TransitionLayoutData>();
        foreach (var group in transitions.GroupBy(t => (Source: t.Origin, Target: t.Destination))
                     .OrderBy(g => Key(g.Key.Source), StringComparer.Ordinal).ThenBy(g => Key(g.Key.Target), StringComparer.Ordinal))
        {
            var source = positions[group.Key.Source]; var target = positions[group.Key.Target];
            double controlX, controlY;
            if (group.Key.Source.Equals(group.Key.Target)) { controlX = source.X; controlY = source.Y - 100; }
            else
            {
                var dx = target.X - source.X; var dy = target.Y - source.Y; var length = Math.Max(1, Math.Sqrt(dx * dx + dy * dy));
                var reciprocal = transitions.Any(t => t.Origin.Equals(group.Key.Target) && t.Destination.Equals(group.Key.Source));
                // Reversing the endpoints also reverses the normal, so the same signed
                // bend places reciprocal arrows on opposite sides of their chord.
                var bend = reciprocal ? 45 : 18;
                controlX = (source.X + target.X) / 2 - dy / length * bend; controlY = (source.Y + target.Y) / 2 + dx / length * bend;
            }
            edgeLayouts.Add(new TransitionLayoutData(Key(group.Key.Source), Key(group.Key.Target),
                group.Select(t => t.Trigger.ToString()).Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray(), controlX, controlY));
        }
        var width = Math.Max(900, positions.Values.Select(p => p.X).DefaultIfEmpty().Max() + 140);
        var height = Math.Max(520, positions.Values.Select(p => p.Y).DefaultIfEmpty().Max() + 140);
        progress?.Report("Visual layout ready.");
        return new AutomatonLayoutData(width, height, 1, 0, 0,
            states.Select(q => new StateLayoutData(Key(q), positions[q].X, positions[q].Y)).ToArray(), edgeLayouts.ToArray());
    }

    private static string Key(AbstractState state) => state.ToString();
    private static List<List<AbstractState>> FindComponents(AbstractState[] states, Dictionary<AbstractState, HashSet<AbstractState>> neighbors, AbstractState initial)
    {
        var result = new List<List<AbstractState>>(); var remaining = states.ToHashSet();
        foreach (var root in states.OrderBy(q => q.Equals(initial) ? 0 : 1).ThenBy(Key, StringComparer.Ordinal))
        {
            if (!remaining.Remove(root)) continue;
            var component = new List<AbstractState>(); var queue = new Queue<AbstractState>(); queue.Enqueue(root);
            while (queue.TryDequeue(out var current)) { component.Add(current); foreach (var next in neighbors[current].OrderBy(Key, StringComparer.Ordinal)) if (remaining.Remove(next)) queue.Enqueue(next); }
            result.Add(component);
        }
        return result;
    }

    private static List<List<AbstractState>> DirectedLevels(List<AbstractState> component, AbstractState root, IReadOnlyList<Transition> transitions)
    {
        var distance = component.ToDictionary(q => q, _ => int.MaxValue); distance[root] = 0;
        var queue = new Queue<AbstractState>(); queue.Enqueue(root);
        while (queue.TryDequeue(out var current))
            foreach (var next in transitions.Where(t => t.Origin.Equals(current)).Select(t => t.Destination).Where(distance.ContainsKey).Distinct().OrderBy(Key, StringComparer.Ordinal))
                if (distance[next] == int.MaxValue) { distance[next] = distance[current] + 1; queue.Enqueue(next); }
        var trailing = distance.Values.Where(x => x != int.MaxValue).DefaultIfEmpty(-1).Max() + 1;
        foreach (var state in component.Where(q => distance[q] == int.MaxValue).OrderBy(Key, StringComparer.Ordinal)) distance[state] = trailing++;
        return distance.GroupBy(x => x.Value).OrderBy(x => x.Key).Select(g => g.Select(x => x.Key).OrderBy(Key, StringComparer.Ordinal).ToList()).ToList();
    }
}
