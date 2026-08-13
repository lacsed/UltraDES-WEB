using System.Text.Json;
using UltraDES;
using UltraDESWeb.Services;
using Xunit;

namespace UltraDESWeb.Tests;

public sealed class AutomatonLayoutServiceTests
{
    private readonly AutomatonLayoutService service = new();

    [Fact]
    public async Task SizeBoundaryAccepts100AndRejects101()
    {
        var atLimit = Chain(100);
        Assert.True(service.CanConvert(atLimit));
        Assert.Equal(100, (await service.CreateAsync(atLimit)).States.Length);

        var overLimit = Chain(101);
        Assert.False(service.CanConvert(overLimit));
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(overLimit));
        Assert.Equal("Visual conversion supports at most 100 states.", error.Message);
    }

    [Fact]
    public async Task OutputIsStableAndAutomatonIsUnchanged()
    {
        var automaton = Chain(8);
        var original = DeterministicFiniteAutomaton.ToJsonString(automaton);
        var first = JsonSerializer.Serialize(await service.CreateAsync(automaton));
        var second = JsonSerializer.Serialize(await service.CreateAsync(automaton));
        Assert.Equal(first, second);
        Assert.Equal(original, DeterministicFiniteAutomaton.ToJsonString(automaton));
    }

    [Fact]
    public async Task DisconnectedComponentsUseSeparateVerticalAreas()
    {
        var q = States(4); var e = Event("go");
        var automaton = new DeterministicFiniteAutomaton(new[] { new Transition(q[0], e, q[1]), new Transition(q[2], e, q[3]) }, q[0], "disconnected");
        var layout = await service.CreateAsync(automaton);
        var firstBottom = layout.States.Where(x => x.State is "q0" or "q1").Max(x => x.Y);
        var secondTop = layout.States.Where(x => x.State is "q2" or "q3").Min(x => x.Y);
        Assert.True(secondTop > firstBottom);
    }

    [Fact]
    public async Task SelfLoopReservesSpaceAboveState()
    {
        var q = States(1); var automaton = new DeterministicFiniteAutomaton(new[] { new Transition(q[0], Event("tick"), q[0]) }, q[0], "loop");
        var layout = await service.CreateAsync(automaton);
        Assert.True(layout.Transitions.Single().ControlY < layout.States.Single().Y - 50);
    }

    [Fact]
    public async Task ParallelLabelsAreStableAndCombined()
    {
        var q = States(2);
        var automaton = new DeterministicFiniteAutomaton(new[] { new Transition(q[0], Event("beta"), q[1]), new Transition(q[0], Event("alpha"), q[1]) }, q[0], "labels");
        var edge = Assert.Single((await service.CreateAsync(automaton)).Transitions);
        Assert.Equal(new[] { "alpha", "beta" }, edge.Events);
    }

    [Fact]
    public async Task ReciprocalTransitionsHaveDistinctCurves()
    {
        var q = States(2);
        var automaton = new DeterministicFiniteAutomaton(new[] { new Transition(q[0], Event("out"), q[1]), new Transition(q[1], Event("back"), q[0]) }, q[0], "reciprocal");
        var edges = (await service.CreateAsync(automaton)).Transitions;
        Assert.Equal(2, edges.Length);
        Assert.NotEqual(edges[0].ControlY, edges[1].ControlY);
    }

    [Fact]
    public async Task BarycentricOrderingReducesCrossedEdges()
    {
        var q = States(5); var e = Event("go"); var alternate = Event("alternate");
        var automaton = new DeterministicFiniteAutomaton(new[]
        {
            new Transition(q[0], e, q[1]), new Transition(q[0], alternate, q[2]),
            new Transition(q[1], e, q[4]), new Transition(q[2], e, q[3])
        }, q[0], "crossings");

        var positions = (await service.CreateAsync(automaton)).States.ToDictionary(item => item.State);

        Assert.True(positions["q4"].Y < positions["q3"].Y);
    }

    [Fact]
    public async Task ReverseOnlyReachableStatesStayInCompactRanks()
    {
        var q = States(4); var e = Event("go");
        var automaton = new DeterministicFiniteAutomaton(new[]
        {
            new Transition(q[0], e, q[1]), new Transition(q[2], e, q[1]), new Transition(q[3], e, q[2])
        }, q[0], "reverse");

        var layout = await service.CreateAsync(automaton);

        Assert.True(layout.States.Max(item => item.X) <= 720);
    }

    private static DeterministicFiniteAutomaton Chain(int count)
    {
        var states = States(count); var e = Event("next");
        var transitions = Enumerable.Range(0, count - 1).Select(i => new Transition(states[i], e, states[i + 1])).ToArray();
        return new DeterministicFiniteAutomaton(transitions, states[0], $"chain-{count}");
    }
    private static State[] States(int count) => Enumerable.Range(0, count).Select(i => new State($"q{i}", Marking.Unmarked)).ToArray();
    private static Event Event(string name) => new(name, Controllability.Controllable);
}
