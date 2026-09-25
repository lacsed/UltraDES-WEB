using UltraDES;
using Xunit;

namespace UltraDESWeb.Tests;

public sealed class AdvancedAutomatonOperationsTests
{
    [Fact]
    public void Prefix_projection_regex_and_isomorphism_are_available()
    {
        var q0 = new State("q0", Marking.Unmarked);
        var q1 = new State("q1", Marking.Marked);
        var a = new Event("a", Controllability.Controllable);
        var b = new Event("b", Controllability.Uncontrollable);
        var c = new Event("c", Controllability.Controllable);
        var automaton = new DeterministicFiniteAutomaton(
            new Transition[] { new(q0, a, q1), new(q1, b, q0) }, q0, "G");

        Assert.All(automaton.PrefixClosure.States, state => Assert.True(state.IsMarked));
        Assert.Equal(["b"], automaton.Projection([a]).Events.Select(item => item.ToString()));
        Assert.Contains(automaton.InverseProjection([c]).Events, item => item.Equals(c));
        Assert.False(string.IsNullOrWhiteSpace(automaton.ToRegularExpression.ToString()));
        Assert.True(DeterministicFiniteAutomaton.Isomorphism(automaton, automaton.Clone()));
    }

    [Fact]
    public void Conflict_check_accepts_a_composed_set()
    {
        var q = new State("q", Marking.Marked);
        var tick = new Event("tick", Controllability.Controllable);
        var first = new DeterministicFiniteAutomaton(new Transition[] { new(q, tick, q) }, q, "A");
        var second = new DeterministicFiniteAutomaton(new Transition[] { new(q, tick, q) }, q, "B");

        Assert.False(DeterministicFiniteAutomaton.IsConflicting([first, second]));
    }
}
