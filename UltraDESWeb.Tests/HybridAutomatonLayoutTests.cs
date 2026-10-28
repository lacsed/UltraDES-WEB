using System.Text.Json;
using UltraDES;
using UltraDESWeb.Services;
using Xunit;
using static UltraDESWeb.Services.AutomatonLayoutGeometry;

namespace UltraDESWeb.Tests;

public sealed class HybridAutomatonLayoutTests
{
    private readonly AutomatonLayoutService service = new();

    [Fact]
    public async Task Directed_cycle_is_compact_without_crossings_or_collisions()
    {
        var states = States(8);
        var automaton = Model(states, Enumerable.Range(0, 8).Select(i => (i, (i + 1) % 8, $"event{i}")));
        var layout = await service.CreateAsync(automaton);
        var quality = Evaluate(layout);
        Assert.Equal(0, quality.StateOverlaps);
        Assert.Equal(0, quality.StateLabelOverlaps);
        Assert.Equal(0, quality.EdgeStateCollisions);
        Assert.Equal(0, quality.LabelOverlaps);
        Assert.Equal(0, quality.Crossings);
        Assert.True(layout.CanvasWidth < 1800 && layout.CanvasHeight < 1800);
        AssertInsideCanvas(layout);
    }

    [Fact]
    public async Task Relaxed_reflection_aligns_diamond_branches_without_changing_markings_or_labels()
    {
        var q = States(4);
        var source = Model(q, [(0, 1, "left"), (0, 2, "right"), (1, 3, "finish_left"), (2, 3, "finish_right")]);
        var before = DeterministicFiniteAutomaton.ToJsonString(source);
        var layout = await service.CreateAsync(source);
        var positions = layout.States.ToDictionary(state => state.State);
        Assert.Equal(positions["q1"].X, positions["q2"].X, 3);
        Assert.Equal(positions["q0"].Y, positions["q3"].Y, 3);
        Assert.Equal(2 * positions["q0"].Y, positions["q1"].Y + positions["q2"].Y, 3);
        Assert.Equal(before, DeterministicFiniteAutomaton.ToJsonString(source));
        Assert.Equal(new[] { "finish_left", "finish_right", "left", "right" }, layout.Transitions.SelectMany(t => t.Events).OrderBy(name => name));
        Assert.Equal(0, Evaluate(layout).Crossings);
        Assert.Equal(0, Evaluate(layout).LabelOverlaps);
        Assert.True(layout.Zoom > 1); // Small diagrams use the available editor width, including on phones.
    }

    [Fact]
    public async Task Automatic_is_no_worse_on_primary_legibility_than_each_requested_family()
    {
        var states = States(7);
        var source = Model(states, [(0, 1, "a"), (0, 2, "b"), (0, 3, "c"), (1, 5, "d"), (2, 4, "e"),
            (3, 6, "f"), (5, 2, "g"), (4, 0, "h"), (6, 1, "i"), (2, 2, "wait"), (1, 0, "back")]);
        var automatic = Primary(Evaluate(await service.CreateAsync(source)));
        foreach (var style in new[] { AutomatonLayoutStyle.Layered, AutomatonLayoutStyle.Balanced, AutomatonLayoutStyle.Circular })
            Assert.True(automatic.CompareTo(Primary(Evaluate(await service.CreateAsync(source, style: style)))) <= 0, $"Automatic regressed against {style}.");
    }

    [Fact]
    public async Task Labels_wrap_and_states_grow_without_losing_any_event()
    {
        var states = new[] { new State("initial_state_with_a_name_longer_than_one_line", Marking.Marked), new State("working", Marking.Unmarked) };
        var labels = Enumerable.Range(0, 14).Select(i => $"long_event_name_number_{i:00}").ToArray();
        var edges = labels.Select(label => new Transition(states[0], new Event(label, Controllability.Controllable), states[1])).ToArray();
        var source = new DeterministicFiniteAutomaton(edges, states[0], "long-labels");
        var layout = await service.CreateAsync(source);
        Assert.True(layout.States.Single(state => state.State == states[0].ToString()).Radius > 30);
        Assert.Equal(labels, Assert.Single(layout.Transitions).Events);
        Assert.True(LabelSize(labels).Height > 26);
        Assert.Equal(0, Evaluate(layout).StateLabelOverlaps);
        Assert.Equal(0, Evaluate(layout).EdgeStateCollisions);
        AssertInsideCanvas(layout);
    }

    [Fact]
    public async Task Loops_choose_free_space_and_opposite_directions_remain_separate()
    {
        var source = Model(States(3), [(0, 1, "out"), (1, 0, "back"), (0, 0, "loop0"), (1, 1, "loop1"), (0, 2, "branch")]);
        var layout = await service.CreateAsync(source);
        var states = layout.States.ToDictionary(state => state.State);
        var forward = layout.Transitions.Single(edge => edge.Source == "q0" && edge.Target == "q1");
        var backward = layout.Transitions.Single(edge => edge.Source == "q1" && edge.Target == "q0");
        Assert.NotEqual((forward.ControlX, forward.ControlY), (backward.ControlX, backward.ControlY));
        Assert.Equal(0, Evaluate(layout).EdgeStateCollisions);
        foreach (var edge in layout.Transitions)
        {
            var curve = Route(states[edge.Source], states[edge.Target], edge);
            Assert.False(CircleBox(new Point(states[edge.Source].X, states[edge.Source].Y), states[edge.Source].Radius, curve.LabelBox));
        }
        AssertInsideCanvas(layout);
    }

    [Fact]
    public async Task Search_cancels_after_it_starts_and_does_not_mutate_source()
    {
        var q = States(20);
        var source = Model(q, Enumerable.Range(0, 20).Select(i => (i, (i + 1) % 20, $"e{i}")));
        var before = DeterministicFiniteAutomaton.ToJsonString(source);
        using var cancellation = new CancellationTokenSource();
        var progress = new ImmediateProgress(message => { if (message.Contains("candidate")) cancellation.Cancel(); });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.CreateAsync(source, progress, cancellation.Token));
        Assert.Equal(before, DeterministicFiniteAutomaton.ToJsonString(source));
    }

    [Fact]
    public async Task Candidate_search_is_repeatable_even_if_input_transition_order_changes()
    {
        var q = States(6);
        var edges = new[] { (0, 1, "a"), (0, 2, "b"), (1, 3, "c"), (2, 3, "d"), (3, 4, "e"), (4, 5, "f"), (5, 0, "g") };
        Assert.Equal(JsonSerializer.Serialize(await service.CreateAsync(Model(q, edges))),
            JsonSerializer.Serialize(await service.CreateAsync(Model(q, edges.Reverse()))));
    }

    [Fact]
    public void Legacy_saved_layouts_keep_default_radius_and_label_offsets()
    {
        var state = JsonSerializer.Deserialize<StateLayoutData>("{\"State\":\"q\",\"X\":100,\"Y\":100}")!;
        var edge = JsonSerializer.Deserialize<TransitionLayoutData>("{\"Source\":\"q\",\"Target\":\"q\",\"Events\":[\"a\"],\"ControlX\":100,\"ControlY\":0}")!;
        Assert.Equal(30, state.Radius);
        Assert.Equal(0, edge.LabelOffsetX);
        Assert.Equal(0, edge.LabelOffsetY);
    }

    [Fact]
    public void Moving_a_component_does_not_flip_labels_on_nearly_straight_edges()
    {
        var a = new StateLayoutData("a", 0, 0);
        var b = new StateLayoutData("b", 130.16652224137044, -130.16652224137044);
        var edge = new TransitionLayoutData("a", "b", ["finish_right"], b.X / 2, b.Y / 2);
        var first = Route(a, b, edge);
        var moved = Route(a with { X = a.X + 160, Y = a.Y + 225.16652224137047 }, b with { X = b.X + 160, Y = b.Y + 225.16652224137047 },
            edge with { ControlX = edge.ControlX + 160, ControlY = edge.ControlY + 225.16652224137047 });
        Assert.Equal(first.Label.X + 160, moved.Label.X, 7);
        Assert.Equal(first.Label.Y + 225.16652224137047, moved.Label.Y, 7);
    }

    private static void AssertInsideCanvas(AutomatonLayoutData layout)
    {
        var states = layout.States.ToDictionary(state => state.State);
        Assert.All(layout.States, state => {
            Assert.InRange(state.X - state.Radius, 0, layout.CanvasWidth);
            Assert.InRange(state.X + state.Radius, 0, layout.CanvasWidth);
            Assert.InRange(state.Y - state.Radius, 0, layout.CanvasHeight);
            Assert.InRange(state.Y + state.Radius, 0, layout.CanvasHeight);
        });
        foreach (var edge in layout.Transitions)
        {
            var curve = Route(states[edge.Source], states[edge.Target], edge);
            Assert.InRange(curve.LabelBox.Left, 0, layout.CanvasWidth);
            Assert.InRange(curve.LabelBox.Right, 0, layout.CanvasWidth);
            Assert.InRange(curve.LabelBox.Top, 0, layout.CanvasHeight);
            Assert.InRange(curve.LabelBox.Bottom, 0, layout.CanvasHeight);
            Assert.All(curve.Samples, p => { Assert.InRange(p.X, 0, layout.CanvasWidth); Assert.InRange(p.Y, 0, layout.CanvasHeight); });
        }
    }
    private static (int, int, int, int, int, int) Primary(Quality q) => (q.StateOverlaps, q.StateLabelOverlaps, q.EdgeStateCollisions, q.LabelOverlaps, q.Crossings, q.EdgeLabelCollisions);
    private static State[] States(int count) => Enumerable.Range(0, count).Select(i => new State($"q{i}", i % 3 == 0 ? Marking.Marked : Marking.Unmarked)).ToArray();
    private static DeterministicFiniteAutomaton Model(State[] states, IEnumerable<(int A, int B, string Name)> edges) =>
        new(edges.Select(edge => new Transition(states[edge.A], new Event(edge.Name, Controllability.Controllable), states[edge.B])).ToArray(), states[0], "Fixture");
    private sealed class ImmediateProgress(Action<string> report) : IProgress<string> { public void Report(string value) => report(value); }
}
