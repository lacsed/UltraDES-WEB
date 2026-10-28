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
        Assert.Contains("dis_E3_shared := NOT ((S1_Gate_q = 1)) OR NOT ((S2_Safety_q = 0));", main);
        Assert.Contains("dis_E4_start := NOT ((S1_Gate_q = 0));", main); // absent Safety alphabet does not veto
        Assert.Contains("req_E3_shared AND NOT dis_E3_shared AND (P1_Feed_rdy_E3_shared AND P2_Press_rdy_E3_shared)", main);
        Assert.Contains("(pending_E2_done > UDINT#0) AND (P1_Feed_rdy_E2_done AND P2_Press_rdy_E2_done)", main);
        Assert.DoesNotContain("dis_E2_done", result.Code);
        Assert.DoesNotContain("dis_E1_alert", result.Code);
        Assert.True(main.IndexOf("IF (pending_E1_alert", StringComparison.Ordinal) < main.IndexOf("ELSIF req_E3_shared", StringComparison.Ordinal));
        Assert.Contains("pending_E1_alert := pending_E1_alert - UDINT#1;", main);
        Assert.Contains("edge_E1_alert := input_E1_alert AND NOT input_prev_E1_alert;", main);
        Assert.DoesNotContain("R_TRIG", main);
        Assert.Contains("pending_E1_alert < UDINT#4294967295", main);

        Assert.DoesNotContain("FUNCTION_BLOCK", result.Code);
        Assert.DoesNotContain("S1_Gate_act_", result.Code);
        Assert.Contains("dis_E3_shared := NOT ((S1_Gate_q = 1)) OR NOT ((S2_Safety_q = 0));", main);
        Assert.Contains("dis_E4_start := NOT ((S1_Gate_q = 0));", main);
    }

    [Fact]
    public void Supervisor_self_loops_remain_enabled_and_plant_self_loops_keep_event_actions()
    {
        var q = new State("initial", Marking.Marked);
        var tick = new Event("tick", Controllability.Controllable);
        var plant = new DeterministicFiniteAutomaton(new Transition[] { new(q, tick, q) }, q, "Plant");
        var supervisor = new DeterministicFiniteAutomaton(new Transition[] { new(q, tick, q) }, q, "Supervisor");
        var code = generator.Generate([plant], [supervisor]).Code;
        Assert.Contains("IF ev_E1_tick THEN", code);
        Assert.Contains("dis_E1_tick := NOT ((S1_Supervisor_q = 0));", code);
        Assert.DoesNotContain("FUNCTION_BLOCK", code);
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
        Assert.Contains("P1_Feed_q := 0;", main);
        Assert.Contains("S1_Gate_q := 0;", main);
        Assert.True(main.IndexOf("P1_Feed_q := 0;", StringComparison.Ordinal) < main.IndexOf("S1_Gate_q := 0;", StringComparison.Ordinal));
        Assert.True(main.IndexOf("S1_Gate_q := 0;", StringComparison.Ordinal) < main.IndexOf("initialized := TRUE;", StringComparison.Ordinal));
    }

    [Fact]
    public void Plant_initial_state_is_zero_and_has_state_action_placeholders()
    {
        var (plants, supervisors) = System();
        var code = generator.Generate(plants, supervisors).Code;
        Assert.Contains("q = 0: z_idle (initial)", code);
        Assert.Contains("TODO onState: actions while plant Feed is in state z_idle.", code);
        Assert.Contains("TODO onEntry: Feed / z_idle", code);
        Assert.Contains("TODO onExit: Feed / z_idle", code);
        Assert.Contains("P1_Feed_q_entry := (P1_Feed_q <> P1_Feed_q_prev);", code);
        Assert.Contains("P1_Feed_act_state_0 := (P1_Feed_q = 0);", code);
        Assert.Contains("P1_Feed_entry_state_0 := P1_Feed_q_entry AND (P1_Feed_q = 0);", code);
        Assert.Contains("P1_Feed_exit_state_0 := P1_Feed_q_entry AND (P1_Feed_q_prev = 0);", code);
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
        Assert.DoesNotContain("FUNCTION_BLOCK", code);
        Assert.Contains("_act_state_0 : BOOL;", code);
        Assert.Contains("_q : DINT := 0;", code);
        Assert.Contains("S1_PROGRAM_q", code);
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
