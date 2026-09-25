using UltraDESWeb.Services;
using Xunit;

namespace UltraDESWeb.Tests;

public sealed class PetriNetWorkspaceTests
{
    [Fact]
    public void ParseNames_supports_comma_separated_batch_creation()
    {
        Assert.Equal(["idle", "working", "done"],
            PetriNetWorkspace.ParseNames(" idle, working,done, idle, "));
    }

    [Fact]
    public void Build_creates_weighted_net_and_initial_marking()
    {
        var draft = ResourceNet("Resource");

        var (net, marking) = PetriNetWorkspace.Build(draft);
        var enter = net.Transitions.Single(t => t.ToString() == "enter");
        var free = net.Places.Single(p => p.ToString() == "free");

        Assert.Equal((uint)1, net.Input(free, enter));
        Assert.Equal((uint?)1, marking[free]);
        Assert.Contains(enter, net.EnabledTransitions(marking));
        Assert.Equal((uint?)0, net.Fire(marking, enter)[free]);
    }

    [Fact]
    public void Analysis_exposes_incidence_and_reachability_results()
    {
        var (net, marking) = PetriNetWorkspace.Build(ResourceNet("Analysis"));

        var matrix = net.IncidenceMatrix(out var placeIndex, out var transitionIndex);
        var free = net.Places.Single(place => place.ToString() == "free");
        var busy = net.Places.Single(place => place.ToString() == "busy");
        var enter = net.Transitions.Single(transition => transition.ToString() == "enter");

        Assert.Equal(1, matrix[placeIndex[free], transitionIndex[enter]]);
        Assert.Equal(-1, matrix[placeIndex[busy], transitionIndex[enter]]);
        Assert.NotEmpty(net.ReachabilityTree(marking));
    }

    [Fact]
    public void Firing_updates_the_marking_and_enabled_transitions_on_the_same_net()
    {
        var (net, initialMarking) = PetriNetWorkspace.Build(ResourceNet("Simulation"));
        var enter = net.Transitions.Single(transition => transition.ToString() == "enter");
        var leave = net.Transitions.Single(transition => transition.ToString() == "leave");
        var free = net.Places.Single(place => place.ToString() == "free");
        var busy = net.Places.Single(place => place.ToString() == "busy");

        var afterEnter = net.Fire(initialMarking, enter);

        Assert.Equal((uint?)0, afterEnter[free]);
        Assert.Equal((uint?)1, afterEnter[busy]);
        Assert.DoesNotContain(enter, net.EnabledTransitions(afterEnter));
        Assert.Contains(leave, net.EnabledTransitions(afterEnter));

        var afterLeave = net.Fire(afterEnter, leave);
        Assert.Equal((uint?)1, afterLeave[free]);
        Assert.Equal((uint?)0, afterLeave[busy]);
        Assert.Contains(enter, net.EnabledTransitions(afterLeave));
    }

    [Fact]
    public void Simulation_drawing_shows_positive_tokens_and_leaves_zero_places_empty()
    {
        var draft = ResourceNet("Drawing");
        var (net, initialMarking) = PetriNetWorkspace.Build(draft);
        var enter = net.Transitions.Single(transition => transition.ToString() == "enter");

        var initialDot = PetriNetWorkspace.ToSimulationDot(draft, initialMarking);
        var initialFree = NodeLine(initialDot, "place:free");
        var initialBusy = NodeLine(initialDot, "place:busy");
        Assert.Contains("label=\"1\"", initialFree);
        Assert.Contains("label=\"\"", initialBusy);

        var updatedDot = PetriNetWorkspace.ToSimulationDot(draft, net.Fire(initialMarking, enter));
        Assert.Contains("label=\"\"", NodeLine(updatedDot, "place:free"));
        Assert.Contains("label=\"1\"", NodeLine(updatedDot, "place:busy"));
    }

    [Fact]
    public void Build_rejects_arcs_between_nodes_of_the_same_kind()
    {
        var draft = ResourceNet("Invalid") with
        {
            Arcs = [new("free", "busy", 1)]
        };

        var exception = Assert.Throws<ArgumentException>(() => PetriNetWorkspace.Build(draft));

        Assert.Contains("must connect a place and a transition", exception.Message);
    }

    [Fact]
    public void Combine_uses_the_ultrades_plus_operator()
    {
        var first = ResourceNet("First");
        var second = new PetriNetDraft("Second", ["finished"], ["finish"],
            [new("busy", "finish", 1), new("finish", "finished", 1)], new() { ["finished"] = 0 });
        // Shared nodes must be declared in both source descriptions.
        second = second with { Places = ["busy", "finished"] };

        var combined = PetriNetWorkspace.Combine(first, second, "Combined");
        var (net, _) = PetriNetWorkspace.Build(combined);

        Assert.Equal("Combined", combined.Name);
        Assert.Contains(net.Transitions, transition => transition.ToString() == "finish");
        Assert.Contains(net.Places, place => place.ToString() == "free");
    }

    private static PetriNetDraft ResourceNet(string name) => new(name,
        ["free", "busy"], ["enter", "leave"],
        [new("free", "enter", 1), new("enter", "busy", 1), new("busy", "leave", 1), new("leave", "free", 1)],
        new() { ["free"] = 1, ["busy"] = 0 });

    private static string NodeLine(string dot, string nodeId) => dot.Split('\n').Single(line => line.Contains($"\"{nodeId}\" [", StringComparison.Ordinal));
}
