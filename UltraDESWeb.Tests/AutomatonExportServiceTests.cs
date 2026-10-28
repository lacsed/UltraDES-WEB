using System.Text;
using System.Xml;
using System.Xml.Linq;
using UltraDES;
using UltraDESWeb.Services;
using Xunit;

namespace UltraDESWeb.Tests;

public sealed class AutomatonExportServiceTests
{
    private readonly AutomatonExportService exporter = new();

    [Theory]
    [InlineData("json")]
    [InlineData("xml")]
    [InlineData("fsm")]
    public void Model_exports_round_trip_with_initial_state_marking_and_controllability(string format)
    {
        var source = Model("Cell_açúcar");
        var file = exporter.Export(source, format);
        var restored = format switch
        {
            "json" => DeterministicFiniteAutomaton.FromJsonString(file.Content).Single(),
            "xml" => DeterministicFiniteAutomaton.FromXMLString(file.Content),
            _ => ReadFile(file.Content, ".fsm", DeterministicFiniteAutomaton.FromFsmFile)
        };
        Assert.True(DeterministicFiniteAutomaton.Isomorphism(source, restored));
        Assert.Equal(source.InitialState.ToString(), restored.InitialState.ToString());
        Assert.Equal(source.Events.Select(e => (e.ToString(), e.IsControllable)).OrderBy(e => e.Item1),
            restored.Events.Select(e => (e.ToString(), e.IsControllable)).OrderBy(e => e.Item1));
        Assert.Equal($"Cell_a__car.{format}", file.FileName);
    }

    [Fact]
    public void Ads_uses_odd_controllable_and_even_uncontrollable_events()
    {
        var file = exporter.Export(Model(), "ads");
        var restored = ReadFile(file.Content, ".ads", DeterministicFiniteAutomaton.FromAdsFile);
        Assert.Equal(2L, restored.Size);
        Assert.Equal(2, restored.Transitions.Count());
        Assert.True(restored.InitialState.IsMarked);
        Assert.Contains(restored.Events, e => e.ToString() == "1" && e.IsControllable);
        Assert.Contains(restored.Events, e => e.ToString() == "2" && !e.IsControllable);
    }

    [Theory]
    [InlineData(false, "PLANT")]
    [InlineData(true, "SPEC")]
    public void Wmod_preserves_the_requested_role_and_declares_the_download_encoding(bool specification, string role)
    {
        var file = exporter.Export(Model("Cell_açúcar"), "wmod", specification);
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(file.Content));
        using var reader = XmlReader.Create(stream);
        var xml = XDocument.Load(reader);
        var component = xml.Descendants().Single(e => e.Name.LocalName == "SimpleComponent");
        Assert.Equal(role, (string?)component.Attribute("Kind"));
        Assert.Equal("Cell_açúcar", (string?)component.Attribute("Name"));
        Assert.Contains("encoding=\"utf-8\"", file.Content);
        Assert.Equal(2, xml.Descendants().Count(e => e.Name.LocalName == "Edge"));
    }

    [Fact]
    public void Fm_preserves_initial_marked_states_and_transition_labels()
    {
        var file = exporter.Export(Model(), "fm");
        Assert.Contains("(START) |- z_start", file.Content);
        Assert.Contains("z_start start busy", file.Content);
        Assert.Contains("busy done z_start", file.Content);
        Assert.Contains("z_start -| (FINAL)", file.Content);
    }

    [Theory]
    [InlineData("json")]
    [InlineData("xml")]
    [InlineData("ads")]
    [InlineData("fsm")]
    [InlineData("fm")]
    [InlineData("wmod")]
    [InlineData("dot")]
    public void Export_does_not_simplify_or_change_the_workspace_model(string format)
    {
        var first = Model("First");
        var second = Model("Second");
        var source = DeterministicFiniteAutomaton.ParallelComposition(first, second);
        var before = DeterministicFiniteAutomaton.ToJsonString(source);
        var file = exporter.Export(source, format);
        Assert.False(string.IsNullOrWhiteSpace(file.Content));
        Assert.EndsWith($".{format}", file.FileName);
        Assert.Equal(before, DeterministicFiniteAutomaton.ToJsonString(source));
    }

    [Fact]
    public void File_names_are_safe_and_unknown_formats_are_rejected()
    {
        var name = AutomatonExportService.FileName("../../Plant:<A>", "json");
        Assert.Equal(name, Path.GetFileName(name));
        Assert.DoesNotContain('/', name);
        Assert.DoesNotContain('<', name);
        Assert.DoesNotContain(':', name);
        Assert.Equal("automaton.json", AutomatonExportService.FileName("", "json"));
        Assert.Throws<ArgumentException>(() => exporter.Export(Model(), "unknown"));
    }

    private static T ReadFile<T>(string content, string extension, Func<string, T> read)
    {
        var path = Path.Combine(Path.GetTempPath(), $"ultrades-roundtrip-{Guid.NewGuid():N}{extension}");
        try { File.WriteAllText(path, content); return read(path); }
        finally { File.Delete(path); }
    }

    private static DeterministicFiniteAutomaton Model(string name = "Cell")
    {
        var initial = new State("z_start", Marking.Marked);
        var busy = new State("busy", Marking.Unmarked);
        var start = new Event("start", Controllability.Controllable);
        var done = new Event("done", Controllability.Uncontrollable);
        return new DeterministicFiniteAutomaton(new Transition[] { new(initial, start, busy), new(busy, done, initial) }, initial, name);
    }
}
