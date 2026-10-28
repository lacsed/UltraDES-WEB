using UltraDESWeb.Services;
using Xunit;

namespace UltraDESWeb.Tests;

public sealed class AutomatonDraftValidatorIsolationTests
{
    [Fact]
    public void Isolated_noninitial_states_cannot_be_silently_dropped_before_layout_or_creation()
    {
        var draft = new AutomatonDraftValidator.Draft("Draft",
            [new("initial", "q0", false), new("isolated", "q1", false)], [], [], "initial");
        var result = new AutomatonDraftValidator().ValidateAndCreate(draft);
        Assert.False(result.IsValid);
        Assert.Null(result.Automaton);
        Assert.Contains(result.Errors, error => error.Contains("q1") && error.Contains("isolated"));
    }

    [Fact]
    public void A_single_initial_state_with_no_transitions_remains_valid()
    {
        var draft = new AutomatonDraftValidator.Draft("Draft", [new("initial", "q0", true)], [], [], "initial");
        var result = new AutomatonDraftValidator().ValidateAndCreate(draft);
        Assert.True(result.IsValid);
        Assert.Single(result.Automaton.States);
    }
}
