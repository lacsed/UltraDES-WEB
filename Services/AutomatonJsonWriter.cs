using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using UltraDES;

namespace UltraDESWeb.Services;

/// <summary>Writes the UltraDES JSON schema with indexed transition endpoints.</summary>
public static class AutomatonJsonWriter
{
    public static string Write(DeterministicFiniteAutomaton automaton)
    {
        ArgumentNullException.ThrowIfNull(automaton);
        var states = automaton.States.ToArray();
        var events = automaton.Events.ToArray();
        var stateIds = new Dictionary<AbstractState, int>();
        var eventIds = new Dictionary<AbstractEvent, int>();
        for (var i = 0; i < states.Length; i++) stateIds.TryAdd(states[i], i);
        for (var i = 0; i < events.Length; i++) eventIds.TryAdd(events[i], i);

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("name", automaton.Name);
            writer.WriteStartArray("states");
            for (var i = 0; i < states.Length; i++)
            {
                writer.WriteStartObject();
                writer.WriteString("name", states[i].ToString());
                writer.WriteString("marking", states[i].IsMarked ? "marked" : "unmarked");
                writer.WriteNumber("id", i);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteNumber("initial_state", automaton.InitialState is { } initial && stateIds.TryGetValue(initial, out var id) ? id : -1);
            writer.WriteStartArray("events");
            for (var i = 0; i < events.Length; i++)
            {
                writer.WriteStartObject();
                writer.WriteString("name", events[i].ToString());
                writer.WriteString("controllability", events[i].IsControllable ? "controllable" : "uncontrollable");
                writer.WriteNumber("id", i);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteStartArray("transitions");
            foreach (var transition in automaton.Transitions)
            {
                writer.WriteStartObject();
                writer.WriteNumber("origin", stateIds[transition.Origin]);
                writer.WriteNumber("trigger", eventIds[transition.Trigger]);
                writer.WriteNumber("destination", stateIds[transition.Destination]);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
            writer.WriteEndArray();
        }
        return Encoding.UTF8.GetString(stream.GetBuffer(), 0, checked((int)stream.Length));
    }
}
