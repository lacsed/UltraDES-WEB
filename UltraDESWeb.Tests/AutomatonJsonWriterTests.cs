using Newtonsoft.Json.Linq;
using UltraDES;
using UltraDESWeb.Services;
using Xunit;

namespace UltraDESWeb.Tests;

public sealed class AutomatonJsonWriterTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Json_preserves_native_schema_and_round_trips_compound_states(bool composed)
    {
        DeterministicFiniteAutomaton.Multicore = false;
        var first = Model("Planta \"açúcar\"\n", "a");
        var source = composed ? DeterministicFiniteAutomaton.ParallelComposition(first, Model("Second", "b")) : first;
        var native = DeterministicFiniteAutomaton.ToJsonString(source);
        var json = AutomatonJsonWriter.Write(source);
        Assert.True(JToken.DeepEquals(JToken.Parse(native), JToken.Parse(json)));
        var restored = DeterministicFiniteAutomaton.FromJsonString(json).Single();
        Assert.True(DeterministicFiniteAutomaton.Isomorphism(source, restored));
        Assert.Equal(source.Name, restored.Name);
        Assert.Equal(source.InitialState.ToString(), restored.InitialState.ToString());
        Assert.Equal(native, DeterministicFiniteAutomaton.ToJsonString(source));
    }

    [Fact]
    public void Initial_state_without_transitions_is_preserved()
    {
        var source = new DeterministicFiniteAutomaton(Array.Empty<Transition>(), new State("isolated", Marking.Marked), "Empty alphabet");
        Assert.True(JToken.DeepEquals(JToken.Parse(DeterministicFiniteAutomaton.ToJsonString(source)),
            JToken.Parse(AutomatonJsonWriter.Write(source))));
    }

    [Fact]
    public void Workspace_snapshot_reuses_json_and_keeps_models_separate()
    {
        var source = Model("First", "a");
        var snapshot = new WorkspaceAutomatonSnapshot(source);
        Assert.Same(snapshot.Json, snapshot.Json);
        Assert.Equal(source.States.Count(), snapshot.StateCount);
        Assert.Equal(source.Events.Count(), snapshot.EventCount);
        Assert.Equal(source.Transitions.Count(), snapshot.TransitionCount);
        var other = new WorkspaceAutomatonSnapshot(Model("Second", "b"));
        Assert.NotEqual(snapshot.Json, other.Json);
    }

    private static DeterministicFiniteAutomaton Model(string name, string prefix)
    {
        var start = new State("z_\"início\"", Marking.Marked);
        var busy = new State("busy", Marking.Unmarked);
        var on = new Event(prefix + " iniciar", Controllability.Controllable);
        var off = new Event(prefix + "\nterminar", Controllability.Uncontrollable);
        return new DeterministicFiniteAutomaton(new Transition[] {(start, on, busy), (busy, off, start), (start, off, start)}, start, name);
    }
}
