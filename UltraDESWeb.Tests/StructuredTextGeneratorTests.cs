using UltraDES;
using UltraDESWeb.Services;
using Xunit;

namespace UltraDESWeb.Tests;

public sealed class StructuredTextGeneratorTests
{
    private readonly StructuredTextGenerator generator = new();

    [Fact]
    public void Generates_synchronized_plants_and_supervisors_that_only_disable_controllable_events()
    {
        var (plants, supervisors) = System();
        var result = generator.Generate(plants, supervisors);
        Assert.Equal(2, result.PlantCount);
        Assert.Equal(2, result.SupervisorCount);
        Assert.Equal(4, result.EventCount);

        var main = result.Code[result.Code.IndexOf("PROGRAM PRG_SCT_Main", StringComparison.Ordinal)..];
        Assert.Contains("dis_E3_shared := S1_Gate.dis_E3_shared OR S2_Safety.dis_E3_shared;", main);
        Assert.Contains("dis_E4_start := S1_Gate.dis_E4_start;", main); // absent Safety alphabet does not veto
        Assert.Contains("req_E3_shared AND NOT dis_E3_shared AND (P1_Feed.rdy_E3_shared AND P2_Press.rdy_E3_shared)", main);
        Assert.Contains("(pending_E2_done > UDINT#0) AND (P1_Feed.rdy_E2_done AND P2_Press.rdy_E2_done)", main);
        Assert.DoesNotContain("dis_E2_done", result.Code);
        Assert.DoesNotContain("dis_E1_alert", result.Code);
        Assert.True(main.IndexOf("IF (pending_E1_alert", StringComparison.Ordinal) < main.IndexOf("ELSIF req_E3_shared", StringComparison.Ordinal));
        Assert.Contains("pending_E1_alert := pending_E1_alert - UDINT#1;", main);
        Assert.Contains("edge_E1_alert(CLK := input_E1_alert);", main);
        Assert.Contains("pending_E1_alert < UDINT#4294967295", main);

        var supervisor = Block(result.Code, "FB_S1_Gate");
        Assert.DoesNotContain("TODO", supervisor);
        Assert.DoesNotContain("act_", supervisor);
        Assert.Contains("dis_E3_shared := NOT ((q = 1));", supervisor);
        Assert.Contains("dis_E4_start := NOT ((q = 0));", supervisor);
    }

    [Fact]
    public void Supervisor_self_loops_remain_enabled_and_plant_self_loops_keep_event_actions()
    {
        var q = new State("initial", Marking.Marked);
        var tick = new Event("tick", Controllability.Controllable);
        var plant = new DeterministicFiniteAutomaton(new Transition[] { new(q, tick, q) }, q, "Plant");
        var supervisor = new DeterministicFiniteAutomaton(new Transition[] { new(q, tick, q) }, q, "Supervisor");
        var code = generator.Generate([plant], [supervisor]).Code;
        Assert.Contains("IF exec_E1_tick THEN", Block(code, "FB_P1_Plant"));
        Assert.DoesNotContain("IF ev_E1_tick THEN", Block(code, "FB_S1_Supervisor"));
        Assert.Contains("dis_E1_tick := NOT ((q = 0));", Block(code, "FB_S1_Supervisor"));
        Assert.Contains("IF ev_E1_tick THEN\n    act_E1_tick := TRUE;", code);
    }

    [Fact]
    public void Initial_scan_is_reserved_for_initializing_readiness_and_disabling_outputs()
    {
        var (plants, supervisors) = System();
        var code = generator.Generate(plants, supervisors).Code;
        var main = code[code.IndexOf("PROGRAM PRG_", StringComparison.Ordinal)..];
        Assert.Contains("initialized : BOOL := FALSE;", main);
        Assert.Contains("initializing := reset OR NOT initialized;", main);
        Assert.Contains("IF NOT initializing THEN\n    IF", main);
        Assert.Contains("P1_Feed(\n    reset := initializing,", main);
        Assert.Contains("S1_Gate(\n    reset := initializing,", main);
        Assert.True(main.IndexOf("P1_Feed(\n", StringComparison.Ordinal) < main.IndexOf("S1_Gate(\n", StringComparison.Ordinal));
        Assert.True(main.IndexOf("S1_Gate(\n", StringComparison.Ordinal) < main.IndexOf("initialized := TRUE;", StringComparison.Ordinal));
    }

    [Fact]
    public void Plant_initial_state_is_zero_and_has_state_action_placeholders()
    {
        var (plants, supervisors) = System();
        var code = generator.Generate(plants, supervisors).Code;
        Assert.Contains("q = 0: z_idle (initial)", code);
        var plant = Block(code, "FB_P1_Feed");
        Assert.Contains("TODO onState: actions while plant Feed is in state z_idle.", plant);
        Assert.Contains("TODO onEntry: Feed / z_idle", plant);
        Assert.Contains("TODO onExit: Feed / z_idle", plant);
        Assert.Contains("q_entry := (q <> q_prev);", plant);
        Assert.Contains("act_state_0 := FALSE;", plant);
        Assert.Contains("entry_state_0 := FALSE;", plant);
        Assert.Contains("exit_state_0 := FALSE;", plant);
        Assert.Contains("TODO onControllableEvent: shared", code);
        Assert.DoesNotContain("TODO onControllableEvent: done", code);
    }

    [Fact]
    public void Reports_missing_uncontrollable_supervisor_transitions_without_vetoing_them()
    {
        var (plants, supervisors) = System();
        var result = generator.Generate(plants, supervisors);
        Assert.Contains(result.Warnings, warning => warning.Contains("Safety") && warning.Contains("never disabled"));
        Assert.DoesNotContain("dis_E1_alert", result.Code);
    }

    [Fact]
    public void Identifiers_survive_unicode_punctuation_case_collisions_and_comment_delimiters()
    {
        var q = new State("initial *)\nPROGRAM injected", Marking.Marked);
        var a = new Event("go-now", Controllability.Controllable);
        var b = new Event("GO NOW", Controllability.Controllable);
        var c = new Event("ação", Controllability.Controllable);
        var transitions = new[] { new Transition(q, a, q), new Transition(q, b, q), new Transition(q, c, q) };
        var plants = new[] { new DeterministicFiniteAutomaton(transitions, q, "ação *)"), new DeterministicFiniteAutomaton(transitions, q, "AÇÃO *)") };
        var supervisors = new[] { new DeterministicFiniteAutomaton(transitions, q, "PROGRAM") };
        var code = generator.Generate(plants, supervisors, "Main").Code;
        Assert.Contains("PROGRAM PRG_Main", code);
        Assert.Contains("initial * ) PROGRAM injected", code);
        Assert.DoesNotContain("\nPROGRAM injected", code);
        var identifiers = global::System.Text.RegularExpressions.Regex.Matches(code, @"(?m)^FUNCTION_BLOCK (\w+)")
            .Select(match => match.Groups[1].Value).ToArray();
        Assert.Equal(3, identifiers.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.All(identifiers, name => Assert.Matches("^[A-Za-z][A-Za-z0-9_]*$", name));
    }

    [Fact]
    public void Generation_is_stable_when_selection_order_changes()
    {
        var (plants, supervisors) = System();
        Assert.Equal(generator.Generate(plants, supervisors).Code,
            generator.Generate(plants.Reverse(), supervisors.Reverse()).Code);
    }

    [Fact]
    public void Rejects_missing_roles_overlap_unknown_events_and_inconsistent_controllability()
    {
        var (plants, supervisors) = System();
        Assert.Throws<ArgumentException>(() => generator.Generate([], supervisors));
        Assert.Throws<ArgumentException>(() => generator.Generate(plants, []));
        Assert.Throws<ArgumentException>(() => generator.Generate(plants, [plants[0]]));
        var q = new State("q", Marking.Marked);
        var unknown = new DeterministicFiniteAutomaton(new Transition[] { new(q, new Event("unknown", Controllability.Controllable), q) }, q, "Unknown");
        Assert.Contains("does not belong", Assert.Throws<ArgumentException>(() => generator.Generate(plants, [unknown])).Message);
        var conflict = new DeterministicFiniteAutomaton(new Transition[] { new(q, new Event("start", Controllability.Uncontrollable), q) }, q, "Conflict");
        Assert.Contains("conflicting controllability", Assert.Throws<ArgumentException>(() => generator.Generate(plants, [conflict])).Message);
        Assert.Throws<ArgumentException>(() => generator.Generate(plants, supervisors, "Main; injected"));
        Assert.Throws<ArgumentException>(() => generator.Generate(plants, supervisors, "Main__PLC"));
        Assert.Throws<ArgumentException>(() => generator.Generate(plants, supervisors, "Main_"));
    }

    private static string Block(string code, string name)
    {
        var start = code.IndexOf($"FUNCTION_BLOCK {name}\n", StringComparison.Ordinal);
        return code[start..code.IndexOf("END_FUNCTION_BLOCK", start, StringComparison.Ordinal)];
    }

    private static (DeterministicFiniteAutomaton[] Plants, DeterministicFiniteAutomaton[] Supervisors) System()
    {
        var idle = new State("z_idle", Marking.Marked);
        var busy = new State("busy", Marking.Unmarked);
        var start = new Event("start", Controllability.Controllable);
        var shared = new Event("shared", Controllability.Controllable);
        var done = new Event("done", Controllability.Uncontrollable);
        var alert = new Event("alert", Controllability.Uncontrollable);
        return ([
            new DeterministicFiniteAutomaton(new Transition[] { new(idle, start, busy), new(busy, shared, idle), new(busy, done, idle), new(busy, alert, idle) }, idle, "Feed"),
            new DeterministicFiniteAutomaton(new Transition[] { new(idle, shared, busy), new(busy, done, idle) }, idle, "Press")
        ], [
            new DeterministicFiniteAutomaton(new Transition[] { new(idle, start, busy), new(busy, shared, idle), new(idle, done, idle), new(busy, done, idle), new(idle, alert, idle), new(busy, alert, idle) }, idle, "Gate"),
            new DeterministicFiniteAutomaton(new Transition[] { new(idle, shared, idle), new(idle, alert, busy), new(idle, done, idle), new(busy, done, idle) }, idle, "Safety")
        ]);
    }
}
