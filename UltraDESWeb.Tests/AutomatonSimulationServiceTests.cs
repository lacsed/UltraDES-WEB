using UltraDES;
using UltraDESWeb.Services;
using Xunit;

namespace UltraDESWeb.Tests;

public sealed class AutomatonSimulationServiceTests
{
    private readonly AutomatonSimulationService service = new();

    [Fact]
    public void Shared_event_is_enabled_only_when_no_selected_automaton_prohibits_it()
    {
        var a = new Event("a", Controllability.Controllable);
        var b = new Event("b", Controllability.Controllable);
        var p0 = new State("p0", Marking.Marked); var p1 = new State("p1", Marking.Unmarked);
        var q0 = new State("q0", Marking.Marked); var q1 = new State("q1", Marking.Unmarked);
        var first = new DeterministicFiniteAutomaton(new Transition[] { new(p0, a, p1), new(p1, b, p0) }, p0, "First");
        var second = new DeterministicFiniteAutomaton(new Transition[] { new(q0, a, q1), new(q1, b, q0) }, q0, "Second");
        var active = service.InitialStates([first, second]);

        Assert.Equal(["a"], service.EnabledEvents([first, second], active).Select(item => item.ToString()));
    }

    [Fact]
    public void Firing_updates_only_automata_that_define_the_event()
    {
        var a = new Event("a", Controllability.Controllable);
        var p0 = new State("p0", Marking.Marked); var p1 = new State("p1", Marking.Unmarked);
        var q0 = new State("q0", Marking.Marked);
        var first = new DeterministicFiniteAutomaton(new Transition[] { new(p0, a, p1) }, p0, "First");
        var second = new DeterministicFiniteAutomaton(new Transition[] { new(q0, new Event("other", Controllability.Controllable), q0) }, q0, "Second");
        var active = service.InitialStates([first, second]);

        var next = service.Fire([first, second], active, "a");

        Assert.Equal(p1, next["First"]);
        Assert.Equal(q0, next["Second"]);
    }
}
