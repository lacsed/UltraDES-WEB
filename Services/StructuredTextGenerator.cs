using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using UltraDES;

namespace UltraDESWeb.Services;

/// <summary>Emits a scan-based IEC 61131-3 template without composing the plant state spaces.</summary>
public sealed class StructuredTextGenerator
{
    public sealed record Result(string Code, int PlantCount, int SupervisorCount, int EventCount,
        IReadOnlyList<string> Warnings);

    public Result Generate(IEnumerable<DeterministicFiniteAutomaton> plants,
        IEnumerable<DeterministicFiniteAutomaton> supervisors, string programName = "SCT_Main")
    {
        ArgumentNullException.ThrowIfNull(plants);
        ArgumentNullException.ThrowIfNull(supervisors);
        // A prefix also keeps user-selected names away from IEC keywords and FB identifiers.
        if (programName is null || !Regex.IsMatch(programName, "\\A(?=.{1,40}\\z)[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*\\z"))
            throw new ArgumentException("Use a program name starting with a letter, up to 40 characters, with letters, digits and single underscores between words.");

        var plantArray = plants.ToArray();
        var supervisorArray = supervisors.ToArray();
        if (plantArray.Length == 0) throw new ArgumentException("Select at least one plant.");
        if (supervisorArray.Length == 0) throw new ArgumentException("Select at least one supervisor.");
        var all = plantArray.Concat(supervisorArray).ToArray();
        if (all.Any(model => model is null || string.IsNullOrWhiteSpace(model.Name)))
            throw new ArgumentException("Every selected automaton must have a name.");
        if (all.Select(model => model.Name).Distinct(StringComparer.Ordinal).Count() != all.Length)
            throw new ArgumentException("Select distinct automata; an automaton cannot be both a plant and a supervisor.");

        var groups = all.SelectMany(model => model.Events).GroupBy(e => e.ToString(), StringComparer.Ordinal).ToArray();
        var conflict = groups.FirstOrDefault(group => group.Select(e => e.IsControllable).Distinct().Count() > 1);
        if (conflict is not null)
            throw new ArgumentException($"Event '{conflict.Key}' has conflicting controllability declarations.");

        var plantEvents = plantArray.SelectMany(model => model.Events).Select(e => e.ToString()).ToHashSet(StringComparer.Ordinal);
        var extra = supervisorArray.SelectMany(model => model.Events).FirstOrDefault(e => !plantEvents.Contains(e.ToString()));
        if (extra is not null)
            throw new ArgumentException($"Supervisor event '{extra}' does not belong to any selected plant. Select the missing plant or a compatible supervisor.");

        var events = groups.Where(group => plantEvents.Contains(group.Key)).OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select((group, index) => new EventSymbol(group.Key, Identifier("E", index, group.Key), group.First().IsControllable)).ToArray();
        var eventMap = events.ToDictionary(e => e.Name, StringComparer.Ordinal);
        var plantModels = plantArray.OrderBy(model => model.Name, StringComparer.Ordinal)
            .Select((model, index) => CreateModel(model, Identifier("P", index, model.Name), eventMap)).ToArray();
        var supervisorModels = supervisorArray.OrderBy(model => model.Name, StringComparer.Ordinal)
            .Select((model, index) => CreateModel(model, Identifier("S", index, model.Name), eventMap)).ToArray();
        var warnings = new List<string>();
        foreach (var supervisor in supervisorModels)
        {
            var missing = supervisor.Events.Where(e => !e.Controllable)
                .Sum(e => supervisor.States.Count(state => !supervisor.Transitions.Any(t => t.Origin == state.Id && t.Event == e)));
            if (missing > 0)
                warnings.Add($"Supervisor '{supervisor.Name}' has {missing} state/event pair(s) without an uncontrollable transition. These events are never disabled; the supervisor keeps its state when no transition is defined. Verify the supervisor against the selected plants.");
        }

        var code = new StringBuilder();
        Line(code, "(* UltraDES - IEC 61131-3 Structured Text template.");
        Line(code, "   Import each FUNCTION_BLOCK and PROGRAM as a separate POU if required by your IDE.");
        Line(code, "   Map input_ signals to sensors and req_ signals to controllable-event demands (TRUE = automatic).");
        Line(code, "   Replace TODO comments with application actions; map act_ / entry_ / exit_ signals to outputs.");
        Line(code, "   Initial state = 0. Initialization/reset consumes a scan without firing an event.");
        Line(code, "   One event per scan; uncontrollable events first, then ordinal event-name priority.");
        Line(code, "   Supervisors only disable controllable events in their own alphabet.");
        Line(code, "   No transition = disabled for a controllable event; an absent alphabet event is ignored.");
        Line(code, "   Keep supervisor self-loops in the source model: they distinguish enabled events from disabled ones.");
        Line(code, "   Uncontrollable edges are queued; queue_overflow latches on counter saturation.");
        Line(code, "   Edges sampled during reset are discarded; pulses between PLC scans require hardware capture.");
        Line(code, "   State actions also run in the initial state during reset. *)");
        foreach (var warning in warnings) Line(code, $"(* MODEL NOTE: {Comment(warning)} *)");
        foreach (var e in events)
            Line(code, $"(* {e.Id} = {Comment(e.Name)}; {(e.Controllable ? "controllable" : "uncontrollable")}; plants: {string.Join(", ", plantModels.Where(p => p.Events.Contains(e)).Select(p => p.Id))} *)");
        Line(code);
        foreach (var model in plantModels) EmitPlant(code, model);
        foreach (var model in supervisorModels) EmitSupervisor(code, model);
        EmitProgram(code, "PRG_" + programName, plantModels, supervisorModels, events);
        return new Result(code.ToString().Replace("\r\n", "\n"), plantModels.Length, supervisorModels.Length, events.Length, warnings);
    }

    private static Model CreateModel(DeterministicFiniteAutomaton automaton, string id,
        IReadOnlyDictionary<string, EventSymbol> eventMap)
    {
        var states = new[] { automaton.InitialState }.Concat(automaton.States.Where(s => !s.Equals(automaton.InitialState))
            .OrderBy(s => s.ToString(), StringComparer.Ordinal)).ToArray();
        var indexes = states.Select((state, index) => (state, index)).ToDictionary(item => item.state, item => item.index);
        var transitions = automaton.Transitions.Select(t => new Edge(indexes[t.Origin], eventMap[t.Trigger.ToString()], indexes[t.Destination]))
            .Distinct().OrderBy(t => t.Origin).ThenBy(t => t.Event.Name, StringComparer.Ordinal).ToArray();
        if (transitions.GroupBy(t => (t.Origin, t.Event)).Any(group => group.Count() > 1))
            throw new ArgumentException($"Automaton '{automaton.Name}' is nondeterministic.");
        return new Model(automaton.Name, id, states.Select((s, index) => new StateSymbol(index, s.ToString())).ToArray(),
            automaton.Events.Select(e => eventMap[e.ToString()]).OrderBy(e => e.Name, StringComparer.Ordinal).ToArray(), transitions);
    }

    private static void EmitPlant(StringBuilder code, Model model)
    {
        ModelHeader(code, model, "Plant");
        Line(code, $"FUNCTION_BLOCK FB_{model.Id}");
        Line(code, "VAR_INPUT");
        Line(code, "    reset : BOOL;");
        foreach (var e in model.Events) Line(code, $"    exec_{e.Id} : BOOL;");
        Line(code, "END_VAR");
        Line(code, "VAR_OUTPUT");
        Line(code, "    q : DINT := 0;");
        Line(code, "    q_entry : BOOL;");
        foreach (var e in model.Events) Line(code, $"    rdy_{e.Id} : BOOL;");
        foreach (var state in model.States)
        {
            Line(code, $"    act_state_{state.Id} : BOOL; (* continuous level *)");
            Line(code, $"    entry_state_{state.Id} : BOOL; (* one-scan entry pulse *)");
            Line(code, $"    exit_state_{state.Id} : BOOL; (* one-scan exit pulse *)");
        }
        Line(code, "END_VAR");
        Line(code, "VAR");
        Line(code, "    q_prev : DINT := -1;");
        Line(code, "END_VAR");
        foreach (var state in model.States)
        {
            Line(code, $"act_state_{state.Id} := FALSE;");
            Line(code, $"entry_state_{state.Id} := FALSE;");
            Line(code, $"exit_state_{state.Id} := FALSE;");
        }
        EmitTransitions(code, model, "exec_", omitSelfLoops: false);
        Line(code, "q_entry := (q <> q_prev);");
        Line(code, "IF q_entry THEN");
        Line(code, "    CASE q_prev OF");
        foreach (var state in model.States)
        {
            Line(code, $"        {state.Id}:");
            Line(code, $"            exit_state_{state.Id} := TRUE;");
            Line(code, $"            (* TODO onExit: {Comment(model.Name)} / {Comment(state.Name)} *)");
        }
        Line(code, "    END_CASE;");
        Line(code, "END_IF;");
        Line(code, "CASE q OF");
        foreach (var state in model.States)
        {
            Line(code, $"    {state.Id}: (* {Comment(state.Name)} *)");
            Line(code, $"        act_state_{state.Id} := TRUE;");
            Line(code, "        IF q_entry THEN");
            Line(code, $"            entry_state_{state.Id} := TRUE;");
            Line(code, $"            (* TODO onEntry: {Comment(model.Name)} / {Comment(state.Name)} *)");
            Line(code, "        END_IF;");
            Line(code, $"        (* TODO onState: actions while plant {Comment(model.Name)} is in state {Comment(state.Name)}. *)");
        }
        Line(code, "END_CASE;");
        Line(code, "q_prev := q;");
        foreach (var e in model.Events)
            Line(code, $"rdy_{e.Id} := {StateExpression(model.Transitions.Where(t => t.Event == e).Select(t => t.Origin))};");
        Line(code, "END_FUNCTION_BLOCK");
        Line(code);
    }

    private static void EmitSupervisor(StringBuilder code, Model model)
    {
        ModelHeader(code, model, "Supervisor (observation and controllable-event disabling only)");
        Line(code, $"FUNCTION_BLOCK FB_{model.Id}");
        Line(code, "VAR_INPUT");
        Line(code, "    reset : BOOL;");
        foreach (var e in model.Events) Line(code, $"    ev_{e.Id} : BOOL;");
        Line(code, "END_VAR");
        Line(code, "VAR_OUTPUT");
        Line(code, "    q : DINT := 0;");
        foreach (var e in model.Events.Where(e => e.Controllable)) Line(code, $"    dis_{e.Id} : BOOL;");
        Line(code, "END_VAR");
        EmitTransitions(code, model, "ev_", omitSelfLoops: true);
        foreach (var e in model.Events.Where(e => e.Controllable))
            // Include self-loops in the enabling map even though their state update is omitted.
            Line(code, $"dis_{e.Id} := NOT ({StateExpression(model.Transitions.Where(t => t.Event == e).Select(t => t.Origin))});");
        Line(code, "END_FUNCTION_BLOCK");
        Line(code);
    }

    private static void EmitTransitions(StringBuilder code, Model model, string eventPrefix, bool omitSelfLoops)
    {
        Line(code, "IF reset THEN");
        Line(code, "    q := 0;");
        var transitions = model.Transitions.Where(t => !omitSelfLoops || t.Origin != t.Destination).ToArray();
        if (transitions.Length > 0)
        {
            Line(code, "ELSE");
            Line(code, "    CASE q OF");
            foreach (var state in transitions.GroupBy(t => t.Origin))
            {
                Line(code, $"        {state.Key}:");
                var first = true;
                foreach (var t in state)
                {
                    Line(code, $"            {(first ? "IF" : "ELSIF")} {eventPrefix}{t.Event.Id} THEN");
                    if (!omitSelfLoops && t.Event.Controllable)
                        Line(code, $"                (* TODO plant transition action: {Comment(t.Event.Name)}; {t.Origin} -> {t.Destination}. *)");
                    Line(code, $"                q := {t.Destination};");
                    first = false;
                }
                Line(code, "            END_IF;");
            }
            Line(code, "    END_CASE;");
        }
        Line(code, "END_IF;");
    }

    private static void EmitProgram(StringBuilder code, string name, Model[] plants, Model[] supervisors, EventSymbol[] events)
    {
        Line(code, $"PROGRAM {name}");
        Line(code, "VAR");
        Line(code, "    reset : BOOL; (* TODO map to reset command *)");
        Line(code, "    initialized : BOOL := FALSE;");
        Line(code, "    initializing : BOOL;");
        Line(code, "    queue_overflow : BOOL := FALSE;");
        foreach (var model in plants.Concat(supervisors)) Line(code, $"    {model.Id} : FB_{model.Id};");
        foreach (var e in events)
        {
            Line(code, $"    ev_{e.Id} : BOOL;");
            if (e.Controllable)
            {
                Line(code, $"    req_{e.Id} : BOOL := TRUE; (* TODO demand/guard; TRUE enables automatic scheduling *)");
                Line(code, $"    dis_{e.Id} : BOOL;");
                Line(code, $"    act_{e.Id} : BOOL; (* one-scan controllable-event action pulse *)");
            }
            else
            {
                Line(code, $"    input_{e.Id} : BOOL; (* TODO map sensor signal *)");
                Line(code, $"    edge_{e.Id} : R_TRIG;");
                Line(code, $"    pending_{e.Id} : UDINT := 0;");
            }
        }
        Line(code, "END_VAR");
        Line(code, "initializing := reset OR NOT initialized;");
        Line(code, "IF initializing THEN queue_overflow := FALSE; END_IF;");
        Line(code, "(* Capture sensor edges before arbitration; retain simultaneous events. *)");
        foreach (var e in events.Where(e => !e.Controllable))
        {
            Line(code, $"edge_{e.Id}(CLK := input_{e.Id});");
            Line(code, "IF initializing THEN");
            Line(code, $"    pending_{e.Id} := 0;");
            Line(code, $"ELSIF edge_{e.Id}.Q THEN");
            Line(code, $"    IF pending_{e.Id} < UDINT#4294967295 THEN");
            Line(code, $"        pending_{e.Id} := pending_{e.Id} + UDINT#1;");
            Line(code, "    ELSE");
            Line(code, "        queue_overflow := TRUE;");
            Line(code, "    END_IF;");
            Line(code, "END_IF;");
        }
        Line(code, "(* Snapshot supervisor decisions and clear all previous event/action pulses. *)");
        foreach (var e in events)
        {
            Line(code, $"ev_{e.Id} := FALSE;");
            if (!e.Controllable) continue;
            Line(code, $"act_{e.Id} := FALSE;");
            var decisions = supervisors.Where(s => s.Events.Contains(e)).Select(s => $"{s.Id}.dis_{e.Id}").ToArray();
            Line(code, $"dis_{e.Id} := {(decisions.Length > 0 ? string.Join(" OR ", decisions) : "FALSE")};");
        }
        if (events.Length > 0)
        {
            Line(code, "(* At most one event. Only plant readiness gates uncontrollable events. *)");
            Line(code, "IF NOT initializing THEN");
            var first = true;
            foreach (var e in events.OrderBy(e => e.Controllable).ThenBy(e => e.Name, StringComparer.Ordinal))
            {
                var ready = string.Join(" AND ", plants.Where(p => p.Events.Contains(e)).Select(p => $"{p.Id}.rdy_{e.Id}"));
                var guard = e.Controllable ? $"req_{e.Id} AND NOT dis_{e.Id}" : $"(pending_{e.Id} > UDINT#0)";
                Line(code, $"    {(first ? "IF" : "ELSIF")} {guard} AND ({ready}) THEN");
                Line(code, $"        ev_{e.Id} := TRUE;");
                if (!e.Controllable) Line(code, $"        pending_{e.Id} := pending_{e.Id} - UDINT#1;");
                first = false;
            }
            Line(code, "    END_IF;");
            Line(code, "END_IF;");
        }
        Line(code, "(* All plants consume the same event; their readiness is then refreshed for the next scan. *)");
        foreach (var model in plants) EmitCall(code, model, "exec_");
        Line(code, "(* Supervisors observe the same event once, with no action or uncontrollable-event veto. *)");
        foreach (var model in supervisors) EmitCall(code, model, "ev_");
        Line(code, "(* Global event actions execute once, including events shared by several plants. *)");
        foreach (var e in events.Where(e => e.Controllable))
        {
            Line(code, $"IF ev_{e.Id} THEN");
            Line(code, $"    act_{e.Id} := TRUE;");
            Line(code, $"    (* TODO onControllableEvent: {Comment(e.Name)}. Insert one-scan action here. *)");
            Line(code, "END_IF;");
        }
        Line(code, "initialized := TRUE;");
        Line(code, "(* TODO map plant state levels and event action pulses to physical outputs here. *)");
        Line(code, "END_PROGRAM");
    }

    private static void EmitCall(StringBuilder code, Model model, string prefix)
    {
        Line(code, $"{model.Id}(");
        Line(code, $"    reset := initializing{(model.Events.Length > 0 ? "," : "")}");
        for (var i = 0; i < model.Events.Length; i++)
            Line(code, $"    {prefix}{model.Events[i].Id} := ev_{model.Events[i].Id}{(i < model.Events.Length - 1 ? "," : "")}");
        Line(code, ");");
    }

    private static void ModelHeader(StringBuilder code, Model model, string role)
    {
        Line(code, $"(* {role}: {Comment(model.Name)} [{model.Id}]");
        foreach (var state in model.States) Line(code, $"   q = {state.Id}: {Comment(state.Name)}{(state.Id == 0 ? " (initial)" : "")}");
        Line(code, "*)");
    }

    private static string StateExpression(IEnumerable<int> states)
    {
        var values = states.Distinct().OrderBy(q => q).Select(q => $"(q = {q})").ToArray();
        return values.Length > 0 ? string.Join(" OR ", values) : "FALSE";
    }

    // Numeric prefixes make identifiers unique even for case-folding, punctuation and Unicode collisions.
    private static string Identifier(string prefix, int index, string name)
    {
        var slug = Regex.Replace(name, "[^A-Za-z0-9]+", "_").Trim('_');
        if (slug.Length > 24) slug = slug[..24].TrimEnd('_');
        return $"{prefix}{index + 1}_{(slug.Length > 0 ? slug : "model")}";
    }

    private static string Comment(string value) => Regex.Replace(value ?? "", "[\\r\\n\\t\\p{C}]", " ")
        .Replace("(*", "( *").Replace("*)", "* )");
    private static void Line(StringBuilder code, string value = "") => code.AppendLine(value);
    private sealed record EventSymbol(string Name, string Id, bool Controllable);
    private sealed record StateSymbol(int Id, string Name);
    private sealed record Edge(int Origin, EventSymbol Event, int Destination);
    private sealed record Model(string Name, string Id, StateSymbol[] States, EventSymbol[] Events, Edge[] Transitions);
}
