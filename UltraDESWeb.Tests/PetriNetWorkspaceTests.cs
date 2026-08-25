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
}
