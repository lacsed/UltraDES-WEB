using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UltraDES;
using static UltraDESWeb.Services.AutomatonLayoutGeometry;

namespace UltraDESWeb.Services;

public enum AutomatonLayoutStyle { Automatic, Layered, Balanced, Circular }

/// <summary>Deterministic, bounded candidate search; relaxed structural symmetry never changes automaton semantics.</summary>
public sealed class AutomatonLayoutService
{
    public const int MaximumStateCount = 100;
    public bool CanConvert(DeterministicFiniteAutomaton automaton) => automaton is not null && automaton.States.Count() <= MaximumStateCount;

    public static object ToDiagram(DeterministicFiniteAutomaton automaton) => new
    {
        States = automaton.States.Select(q => new { Id = q.ToString(), Name = q.ToString(), Marked = q.IsMarked }).ToArray(),
        Events = automaton.Events.Select(e => new { Id = e.ToString(), Name = e.ToString(), Controllable = e.IsControllable }).ToArray(),
        Transitions = automaton.Transitions.GroupBy(t => (Source: t.Origin.ToString(), Target: t.Destination.ToString()))
            .Select((group, index) => new { Id = $"transition-{index}", SourceId = group.Key.Source, TargetId = group.Key.Target,
                EventNames = group.Select(t => t.Trigger.ToString()).Distinct().OrderBy(name => name, StringComparer.Ordinal).ToArray() }).ToArray(),
        InitialStateId = automaton.InitialState.ToString()
    };

    public async Task<AutomatonLayoutData> CreateAsync(DeterministicFiniteAutomaton automaton,
        IProgress<string> progress = null, CancellationToken cancellationToken = default,
        AutomatonLayoutStyle style = AutomatonLayoutStyle.Automatic)
    {
        ArgumentNullException.ThrowIfNull(automaton);
        if (!Enum.IsDefined(style)) throw new ArgumentOutOfRangeException(nameof(style));
        var states = automaton.States.OrderBy(q => q.ToString(), StringComparer.Ordinal).ToArray();
        if (states.Length > MaximumStateCount)
            throw new InvalidOperationException($"Visual conversion supports at most {MaximumStateCount} states.");
        cancellationToken.ThrowIfCancellationRequested();
        progress?.Report("Analyzing topology, state sizes and transition labels…");
        await Task.Yield();
        var transitions = automaton.Transitions.ToArray();
        var neighbors = states.ToDictionary(q => q, _ => new HashSet<AbstractState>());
        foreach (var edge in transitions) { neighbors[edge.Origin].Add(edge.Destination); neighbors[edge.Destination].Add(edge.Origin); }
        var remaining = states.ToHashSet();
        var allStates = new List<StateLayoutData>(); var allEdges = new List<TransitionLayoutData>();
        double top = 65, width = 900;
        foreach (var root in states.OrderBy(q => q.Equals(automaton.InitialState) ? 0 : 1).ThenBy(q => q.ToString(), StringComparer.Ordinal))
        {
            if (!remaining.Remove(root)) continue;
            var component = new List<AbstractState> { root }; var queue = new Queue<AbstractState>(); queue.Enqueue(root);
            while (queue.TryDequeue(out var state))
                foreach (var next in neighbors[state].OrderBy(q => q.ToString(), StringComparer.Ordinal))
                    if (remaining.Remove(next)) { component.Add(next); queue.Enqueue(next); }
            var graph = new Graph(component, transitions);
            var layered = Layered(graph, 0);
            var candidates = new List<Point[]>();
            if (style is AutomatonLayoutStyle.Automatic or AutomatonLayoutStyle.Layered)
            {
                candidates.Add(layered);
                if (graph.Edges.Length <= 600) candidates.Add(Layered(graph, 1));
                if (graph.Count <= 60 && graph.Edges.Length <= 180) candidates.Add(Layered(graph, 2));
            }
            if (style is AutomatonLayoutStyle.Automatic or AutomatonLayoutStyle.Balanced)
            {
                progress?.Report("Comparing stress and directional layouts…");
                candidates.Add(await Stress(graph, Circle(graph, 0), cancellationToken));
                if (graph.Count <= 60 && graph.Edges.Length <= 180)
                    candidates.Add(await Stress(graph, Circle(graph, .37), cancellationToken));
            }
            if (style is AutomatonLayoutStyle.Automatic or AutomatonLayoutStyle.Circular)
                candidates.Add(Circle(graph, 0));
            if (style == AutomatonLayoutStyle.Automatic && graph.Twins.Length > 0 && graph.Edges.Length <= 600)
                candidates.Add(ReflectTwins(graph, layered));

            AutomatonLayoutData best = null; Quality bestQuality = null;
            for (var index = 0; index < candidates.Count; index++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                progress?.Report($"Routing and scoring candidate {index + 1} of {candidates.Count}…");
                var points = Separate(graph, candidates[index]);
                var candidate = await RouteGraph(graph, points, cancellationToken);
                var score = Evaluate(candidate) with { Symmetry = SymmetryError(graph, points) };
                if (bestQuality is null || score.CompareTo(bestQuality) < 0) { best = candidate; bestQuality = score; }
                await Task.Yield();
            }
            // Refine the winning geometry when labels or curves still collide. Uniform
            // scaling keeps any structural reflection or regular rotation intact.
            if (bestQuality.StateLabelOverlaps + bestQuality.EdgeStateCollisions + bestQuality.LabelOverlaps > 0 && graph.Edges.Length <= 180)
            {
                var basis = best.States.Select(state => new Point(state.X, state.Y)).ToArray();
                foreach (var scale in new[] { 1.3, 1.7 })
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var candidate = await RouteGraph(graph, basis.Select(p => p * scale).ToArray(), cancellationToken);
                    var score = Evaluate(candidate) with { Symmetry = SymmetryError(graph, candidate.States.Select(state => new Point(state.X, state.Y)).ToArray()) };
                    if (score.CompareTo(bestQuality) < 0) { best = candidate; bestQuality = score; }
                }
            }
            // Pack the entire rendered component, including labels, loops and the initial arrow.
            var bounds = DrawingBounds(best, component.Contains(automaton.InitialState) ? automaton.InitialState.ToString() : null);
            var dx = 85 - bounds.Left; var dy = top - bounds.Top;
            allStates.AddRange(best.States.Select(state => state with { X = state.X + dx, Y = state.Y + dy }));
            allEdges.AddRange(best.Transitions.Select(edge => edge with { ControlX = edge.ControlX + dx, ControlY = edge.ControlY + dy }));
            width = Math.Max(width, bounds.Right + dx + 65);
            top += bounds.Bottom - bounds.Top + 135;
        }
        cancellationToken.ThrowIfCancellationRequested();
        progress?.Report("Visual layout ready.");
        var result = new AutomatonLayoutData(width, Math.Max(520, top - 70), 1, 0, 0,
            allStates.OrderBy(state => state.State, StringComparer.Ordinal).ToArray(), allEdges.ToArray());
        var content = DrawingBounds(result, automaton.InitialState.ToString());
        var zoom = Math.Clamp(Math.Min(result.CanvasWidth / (content.Right - content.Left + 60),
            result.CanvasHeight / (content.Bottom - content.Top + 60)), .25, 4);
        return result with { FitToViewport = true, Zoom = zoom, PanX = (content.Left + content.Right) / 2 - result.CanvasWidth / zoom / 2,
            PanY = (content.Top + content.Bottom) / 2 - result.CanvasHeight / zoom / 2 };
    }

    private sealed record Edge(int Source, int Target, string[] Events);
    private sealed class Graph
    {
        public string[] Names { get; }
        public double[] Radii { get; }
        public Edge[] Edges { get; }
        public HashSet<int>[] Adjacent { get; }
        public int[][] Twins { get; }
        public int Count => Names.Length;
        public double StepX { get; }
        public double StepY { get; }
        public Graph(List<AbstractState> states, Transition[] transitions)
        {
            Names = states.Select(q => q.ToString()).ToArray();
            Radii = Names.Select(StateRadius).ToArray();
            var ids = states.Select((state, index) => (state, index)).ToDictionary(item => item.state, item => item.index);
            Edges = transitions.Where(t => ids.ContainsKey(t.Origin)).GroupBy(t => (Source: ids[t.Origin], Target: ids[t.Destination]))
                .OrderBy(group => group.Key.Source).ThenBy(group => group.Key.Target)
                .Select(group => new Edge(group.Key.Source, group.Key.Target, group.Select(t => t.Trigger.ToString()).Distinct().OrderBy(name => name, StringComparer.Ordinal).ToArray())).ToArray();
            Adjacent = Enumerable.Range(0, Count).Select(_ => new HashSet<int>()).ToArray();
            foreach (var edge in Edges.Where(edge => edge.Source != edge.Target)) { Adjacent[edge.Source].Add(edge.Target); Adjacent[edge.Target].Add(edge.Source); }
            // Swapping equal open neighborhoods is an automorphism of the unlabeled undirected skeleton.
            // The initial state is excluded. No direction, marking or event is removed from the output.
            Twins = Enumerable.Range(1, Count - 1).GroupBy(id => string.Join(",", Adjacent[id].OrderBy(x => x)))
                .Where(group => group.Count() > 1).Select(group => group.OrderBy(x => x).ToArray()).ToArray();
            StepX = Math.Max(190, Math.Max(Radii.Max() * 2 + 70, Edges.Select(edge => LabelSize(edge.Events).Width).DefaultIfEmpty().Max() + 70));
            StepY = Math.Max(135, Math.Max(Radii.Max() * 2 + 45, Edges.Select(edge => LabelSize(edge.Events).Height).DefaultIfEmpty().Max() + 65));
        }
    }

    private static Point[] Layered(Graph graph, int seed)
    {
        var rank = Enumerable.Repeat(-1, graph.Count).ToArray(); rank[0] = 0;
        var queue = new Queue<int>(); queue.Enqueue(0);
        while (queue.TryDequeue(out var current))
            foreach (var next in graph.Edges.Where(edge => edge.Source == current).Select(edge => edge.Target).Distinct().OrderBy(x => x))
                if (rank[next] < 0) { rank[next] = rank[current] + 1; queue.Enqueue(next); }
        while (rank.Any(value => value < 0))
            foreach (var id in Enumerable.Range(0, graph.Count).Where(id => rank[id] < 0))
            {
                var known = graph.Adjacent[id].Where(next => rank[next] >= 0).Select(next => rank[next]).ToArray();
                if (known.Length > 0) rank[id] = known.Min() + 1;
            }
        var layers = Enumerable.Range(0, rank.Max() + 1).Select(layer => Enumerable.Range(0, graph.Count).Where(id => rank[id] == layer)
            .OrderBy(id => seed == 2 ? -graph.Adjacent[id].Count : seed == 1 ? -id : id).ToList()).ToArray();
        var ranks = rank.ToList();
        var adjacent = Enumerable.Range(0, graph.Count).Select(_ => new List<int>()).ToList();
        var links = new HashSet<(int A, int B)>();
        foreach (var edge in graph.Edges.Where(edge => edge.Source != edge.Target))
        {
            var a = rank[edge.Source] <= rank[edge.Target] ? edge.Source : edge.Target;
            var b = a == edge.Source ? edge.Target : edge.Source;
            if (rank[a] == rank[b]) continue;
            var previous = a;
            for (var level = rank[a] + 1; level < rank[b] && adjacent.Count < 2000; level++)
            {
                var dummy = adjacent.Count; adjacent.Add([]); ranks.Add(level); layers[level].Add(dummy);
                Link(previous, dummy); previous = dummy;
            }
            Link(previous, b);
        }
        void Link(int a, int b) { if (links.Add((a, b))) { adjacent[a].Add(b); adjacent[b].Add(a); } }
        var best = layers.Select(layer => layer.ToArray()).ToArray(); var bestCrossings = LayerCrossings(layers, adjacent, ranks);
        for (var pass = 0; pass < 10; pass++)
        {
            var forward = pass % 2 == 0;
            var order = layers.SelectMany(layer => layer.Select((id, index) => (id, index))).ToDictionary(item => item.id, item => item.index);
            foreach (var level in forward ? Enumerable.Range(1, layers.Length - 1) : Enumerable.Range(0, layers.Length - 1).Reverse())
            {
                var neighborLevel = level + (forward ? -1 : 1);
                layers[level] = layers[level].OrderBy(id => {
                    var values = adjacent[id].Where(next => ranks[next] == neighborLevel).Select(next => order[next]).OrderBy(x => x).ToArray();
                    return values.Length == 0 ? order[id] : pass % 4 < 2 ? values.Average() : values[values.Length / 2];
                }).ThenBy(id => order[id]).ToList();
                for (var i = 0; i < layers[level].Count; i++) order[layers[level][i]] = i;
                // Adjacent transpositions use neighboring ranks, including dummy vertices on long edges.
                for (var sweep = 0; sweep < 2; sweep++)
                    for (var i = 1; i < layers[level].Count; i++)
                    {
                        var a = layers[level][i - 1]; var b = layers[level][i];
                        var delta = 0;
                        foreach (var na in adjacent[a]) foreach (var nb in adjacent[b])
                            if (ranks[na] == ranks[nb]) delta += Math.Sign(order[na] - order[nb]);
                        if (delta <= 0) continue;
                        (layers[level][i - 1], layers[level][i]) = (b, a); (order[a], order[b]) = (order[b], order[a]);
                    }
            }
            var crossings = LayerCrossings(layers, adjacent, ranks);
            if (crossings < bestCrossings) { bestCrossings = crossings; best = layers.Select(layer => layer.ToArray()).ToArray(); }
        }
        var result = new Point[graph.Count];
        for (var level = 0; level < best.Length; level++)
            for (var i = 0; i < best[level].Length; i++)
                if (best[level][i] < graph.Count) result[best[level][i]] = new Point(level * graph.StepX, (i - (best[level].Length - 1) / 2d) * graph.StepY);
        return result;
    }

    private static int LayerCrossings(List<int>[] layers, List<List<int>> adjacency, List<int> rank)
    {
        var order = layers.SelectMany(layer => layer.Select((id, index) => (id, index))).ToDictionary(item => item.id, item => item.index);
        var count = 0;
        for (var level = 0; level < layers.Length - 1; level++)
        {
            var edges = layers[level].SelectMany(a => adjacency[a].Where(b => rank[b] == level + 1).Select(b => (A: order[a], B: order[b]))).ToArray();
            for (var i = 0; i < edges.Length; i++) for (var j = i + 1; j < edges.Length; j++)
                if ((edges[i].A - edges[j].A) * (edges[i].B - edges[j].B) < 0) count++;
        }
        return count;
    }

    private static Point[] Circle(Graph graph, double phase)
    {
        if (graph.Count == 1) return [new Point(0, 0)];
        var order = new List<int> { 0 }; var remaining = Enumerable.Range(1, graph.Count - 1).ToHashSet();
        while (remaining.Count > 0)
        {
            var next = graph.Adjacent[order[^1]].Where(remaining.Contains).OrderBy(id => id).DefaultIfEmpty(remaining.Min()).First();
            order.Add(next); remaining.Remove(next);
        }
        var radius = Math.Max(graph.StepX, graph.Count * Math.Max(graph.StepY, 155) / (2 * Math.PI));
        var points = new Point[graph.Count];
        for (var i = 0; i < order.Count; i++)
        {
            var angle = Math.PI + 2 * Math.PI * i / order.Count + phase;
            // Noncongruent deterministic starts explore different stress minima, without random state.
            var r = radius * (phase == 0 ? 1 : 1 + .18 * Math.Sin(i * 2.39996));
            points[order[i]] = new Point(Math.Cos(angle) * r, Math.Sin(angle) * r);
        }
        return points;
    }

    private static async Task<Point[]> Stress(Graph graph, Point[] start, CancellationToken token)
    {
        if (graph.Count < 3) return start;
        var n = graph.Count; var ideal = new double[n, n]; var weights = new double[n, n]; var matrix = new double[n - 1, n - 1];
        for (var source = 0; source < n; source++)
        {
            var distance = Enumerable.Repeat(-1, n).ToArray(); distance[source] = 0; var queue = new Queue<int>(); queue.Enqueue(source);
            while (queue.TryDequeue(out var id)) foreach (var next in graph.Adjacent[id])
                if (distance[next] < 0) { distance[next] = distance[id] + 1; queue.Enqueue(next); }
            for (var target = 0; target < n; target++) if (target != source)
            {
                ideal[source, target] = distance[target] * Math.Max(170, graph.Radii.Max() * 2 + 70);
                weights[source, target] = 1 / (distance[target] * (double)distance[target]);
            }
        }
        for (var i = 1; i < n; i++)
            for (var j = 1; j < n; j++) matrix[i - 1, j - 1] = i == j ? Enumerable.Range(0, n).Sum(k => weights[i, k]) : -weights[i, j];
        // Cholesky factor of the anchored weighted Laplacian, reused by every majorization step.
        for (var i = 0; i < n - 1; i++) for (var j = 0; j <= i; j++)
        {
            var value = matrix[i, j]; for (var k = 0; k < j; k++) value -= matrix[i, k] * matrix[j, k];
            matrix[i, j] = i == j ? Math.Sqrt(Math.Max(1e-9, value)) : value / matrix[j, j];
        }
        var points = start.Select(p => p - start[0]).ToArray(); double previous = double.PositiveInfinity;
        for (var iteration = 0; iteration < 75; iteration++)
        {
            if (iteration % 5 == 0) { token.ThrowIfCancellationRequested(); await Task.Yield(); }
            var bx = new double[n - 1]; var by = new double[n - 1];
            for (var i = 1; i < n; i++) for (var j = 0; j < n; j++) if (i != j)
            {
                var delta = points[i] - points[j]; var factor = weights[i, j] * ideal[i, j] / Math.Max(.0001, delta.Length);
                bx[i - 1] += delta.X * factor; by[i - 1] += delta.Y * factor;
            }
            var x = Solve(matrix, bx); var y = Solve(matrix, by);
            var next = new[] { new Point(0, 0) }.Concat(Enumerable.Range(0, n - 1).Select(i => new Point(x[i], y[i]))).ToArray();
            double energy = 0;
            for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) energy += weights[i, j] * Math.Pow((next[i] - next[j]).Length - ideal[i, j], 2);
            if (energy > previous + .0001) break;
            points = next;
            if (Math.Abs(previous - energy) <= Math.Max(.001, previous * .00001) && !double.IsPositiveInfinity(previous)) break;
            previous = energy;
        }
        var far = Enumerable.Range(1, n - 1).OrderByDescending(id => (points[id] - points[0]).Length).First();
        var angle = -Math.Atan2(points[far].Y, points[far].X);
        return points.Select(p => new Point(p.X * Math.Cos(angle) - p.Y * Math.Sin(angle), p.X * Math.Sin(angle) + p.Y * Math.Cos(angle))).ToArray();
    }

    private static double[] Solve(double[,] l, double[] rhs)
    {
        var x = new double[rhs.Length];
        for (var i = 0; i < x.Length; i++) { var value = rhs[i]; for (var j = 0; j < i; j++) value -= l[i, j] * x[j]; x[i] = value / l[i, i]; }
        for (var i = x.Length - 1; i >= 0; i--) { var value = x[i]; for (var j = i + 1; j < x.Length; j++) value -= l[j, i] * x[j]; x[i] = value / l[i, i]; }
        return x;
    }

    private static Point[] ReflectTwins(Graph graph, Point[] basis)
    {
        var result = basis.Select(p => new Point(p.X, 0)).ToArray();
        foreach (var group in graph.Twins)
        {
            var centerX = group.Average(id => basis[id].X);
            for (var i = 0; i < group.Length; i++) result[group[i]] = new Point(centerX, (i - (group.Length - 1) / 2d) * graph.StepY);
        }
        return result;
    }

    private static double SymmetryError(Graph graph, Point[] points)
    {
        if (graph.Twins.Length == 0) return 0;
        var center = new Point(points.Average(p => p.X), points.Average(p => p.Y));
        var paired = graph.Twins.SelectMany(group => group).ToHashSet();
        double horizontal = 0, vertical = 0;
        foreach (var group in graph.Twins) for (var i = 0; i < (group.Length + 1) / 2; i++)
        {
            var a = points[group[i]]; var b = points[group[^(i + 1)]];
            horizontal += Math.Pow(a.X - b.X, 2) + Math.Pow(a.Y + b.Y - 2 * center.Y, 2);
            vertical += Math.Pow(a.Y - b.Y, 2) + Math.Pow(a.X + b.X - 2 * center.X, 2);
        }
        for (var i = 0; i < points.Length; i++) if (!paired.Contains(i))
        { horizontal += Math.Pow(points[i].Y - center.Y, 2); vertical += Math.Pow(points[i].X - center.X, 2); }
        return Math.Sqrt(Math.Min(horizontal, vertical) / points.Length);
    }

    private static Point[] Separate(Graph graph, Point[] candidate)
    {
        var points = candidate.ToArray();
        // Uniform expansion preserves any reflection/rotation already present.
        double scale = 1;
        for (var i = 0; i < points.Length; i++) for (var j = i + 1; j < points.Length; j++)
        {
            if ((points[i] - points[j]).Length < .01) points[j] += new Point(graph.StepX * (j + 1), 0);
            scale = Math.Max(scale, (graph.Radii[i] + graph.Radii[j] + 50) / (points[i] - points[j]).Length);
        }
        return points.Select(p => p * scale).ToArray();
    }

    private static async Task<AutomatonLayoutData> RouteGraph(Graph graph, Point[] points, CancellationToken token)
    {
        var states = points.Select((p, i) => new StateLayoutData(graph.Names[i], p.X, p.Y, graph.Radii[i])).ToArray();
        var routes = new TransitionLayoutData[graph.Edges.Length];
        var curves = new Curve[graph.Edges.Length];
        var pairs = graph.Edges.Select(edge => (edge.Source, edge.Target)).ToHashSet();
        var order = Enumerable.Range(0, graph.Edges.Length).OrderByDescending(i => graph.Edges[i].Events.Sum(name => name.Length)).ThenBy(i => i).ToArray();
        for (var pass = 0; pass < (graph.Edges.Length <= 120 ? 2 : 1); pass++)
        foreach (var index in order)
        {
            if (index % 12 == 0) { token.ThrowIfCancellationRequested(); await Task.Yield(); }
            var edge = graph.Edges[index]; var a = points[edge.Source]; var b = points[edge.Target];
            var options = new List<Point>();
            if (edge.Source == edge.Target)
            {
                foreach (var angle in new[] { -Math.PI / 2, Math.PI / 2, 0d, Math.PI, -Math.PI / 4, Math.PI / 4 })
                    options.Add(a + new Point(Math.Cos(angle), Math.Sin(angle)) * (graph.Radii[edge.Source] + 85));
            }
            else
            {
                var normal = new Point(-(b - a).Y, (b - a).X).Unit;
                var reciprocal = pairs.Contains((edge.Target, edge.Source));
                var bends = reciprocal ? new[] { 60d, 95, 150, 230 } : new[] { 0d, 45, -45, 95, -95, 180, -180, 300, -300 };
                if (graph.Edges.Length > 180) bends = bends.Take(reciprocal ? 2 : 5).ToArray();
                if (graph.Edges.Length > 600) bends = reciprocal ? [60d] : [0d, 60, -60];
                options.AddRange(bends.Select(bend => (a + b) * .5 + normal * bend));
            }
            TransitionLayoutData best = null; Curve bestCurve = null; (int, int, int, int, int, double) bestScore = default;
            foreach (var control in options)
            {
                var route = new TransitionLayoutData(graph.Names[edge.Source], graph.Names[edge.Target], edge.Events, control.X, control.Y);
                var curve = Route(states[edge.Source], states[edge.Target], route);
                var score = RouteScore(curve, edge, states, curves, index);
                if (best is null || score.CompareTo(bestScore) < 0) { best = route; bestCurve = curve; bestScore = score; }
                if (score.Item1 + score.Item2 + score.Item3 + score.Item4 + score.Item5 == 0) break;
            }
            // Labels slide independently along/away from the selected curve; the edge itself remains fixed.
            var chord = (b - a).Unit; var normalLabel = new Point(-chord.Y, chord.X);
            var offsets = new[] { chord * 38, chord * -38, normalLabel * 35, normalLabel * -35, chord * 70, chord * -70 };
            foreach (var offset in bestScore.Item1 + bestScore.Item3 + bestScore.Item5 == 0 ? [] : graph.Edges.Length > 600 ? offsets.Take(2) : offsets)
            {
                var route = best with { LabelOffsetX = offset.X, LabelOffsetY = offset.Y };
                var curve = Route(states[edge.Source], states[edge.Target], route);
                var score = RouteScore(curve, edge, states, curves, index);
                if (score.CompareTo(bestScore) < 0) { best = route; bestCurve = curve; bestScore = score; }
            }
            routes[index] = best; curves[index] = bestCurve;
        }
        return new AutomatonLayoutData(0, 0, 1, 0, 0, states, routes);
    }

    private static (int, int, int, int, int, double) RouteScore(Curve curve, Edge edge, StateLayoutData[] states, Curve[] others, int own)
    {
        var nodes = states.Count(state => CircleBox(new Point(state.X, state.Y), state.Radius + 8, curve.LabelBox));
        var edgeNodes = states.Where((_, id) => id != edge.Source && id != edge.Target).Count(state => HitsCircle(curve, new Point(state.X, state.Y), state.Radius + 8));
        int labels = 0, crossings = 0, edgeLabels = 0;
        var stride = Math.Max(1, others.Length / (others.Length > 600 ? 24 : 180));
        for (var i = 0; i < others.Length; i += stride)
        {
            var other = others[i]; if (i == own || other is null) continue;
            if (curve.LabelBox.Intersects(other.LabelBox, 7)) labels++;
            if (Crosses(curve, other)) crossings++;
            if (HitsBox(curve, other.LabelBox) || HitsBox(other, curve.LabelBox)) edgeLabels++;
        }
        var length = curve.Samples.Zip(curve.Samples.Skip(1), (a, b) => (b - a).Length).Sum();
        return (nodes, edgeNodes, labels, crossings, edgeLabels, length);
    }

    private static Box DrawingBounds(AutomatonLayoutData layout, string initial)
    {
        var states = layout.States.ToDictionary(state => state.State, StringComparer.Ordinal);
        var points = layout.States.SelectMany(state => new[] { new Point(state.X - state.Radius, state.Y - state.Radius), new Point(state.X + state.Radius, state.Y + state.Radius) }).ToList();
        foreach (var edge in layout.Transitions)
        {
            var curve = Route(states[edge.Source], states[edge.Target], edge);
            points.AddRange(curve.Samples); points.Add(new Point(edge.ControlX, edge.ControlY));
            points.Add(new Point(curve.LabelBox.Left, curve.LabelBox.Top)); points.Add(new Point(curve.LabelBox.Right, curve.LabelBox.Bottom));
        }
        if (initial is not null && states.TryGetValue(initial, out var q)) points.Add(new Point(q.X - q.Radius - 45, q.Y));
        return Box.Of(points.DefaultIfEmpty(new Point(0, 0)));
    }
}
