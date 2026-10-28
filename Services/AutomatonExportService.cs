using System;
using System.IO;
using System.Text.RegularExpressions;
using UltraDES;

namespace UltraDESWeb.Services;

/// <summary>Exports using the native UltraDES writers without mutating workspace models.</summary>
public sealed class AutomatonExportService
{
    public sealed record ExportFile(string FileName, string Content, string ContentType);

    public ExportFile Export(DeterministicFiniteAutomaton automaton, string format, bool specification = false)
    {
        ArgumentNullException.ThrowIfNull(automaton);
        format = format?.ToLowerInvariant();
        if (format is not ("json" or "xml" or "ads" or "fsm" or "fm" or "wmod" or "dot"))
            throw new ArgumentException("Choose a supported automaton export format.", nameof(format));

        var source = automaton.Clone();
        var content = format switch
        {
            "json" => DeterministicFiniteAutomaton.ToJsonString(source),
            "dot" => source.ToDotCode,
            "wmod" => NormalizeXmlEncoding(DeterministicFiniteAutomaton.ToWmodString(
                specification ? [] : [source], specification ? [source] : [], source.Name)),
            _ => WriteNativeFile(source, format)
        };
        var contentType = format switch
        {
            "json" => "application/json;charset=utf-8",
            "xml" or "wmod" => "application/xml;charset=utf-8",
            "dot" => "text/vnd.graphviz;charset=utf-8",
            _ => "text/plain;charset=utf-8"
        };
        return new ExportFile(FileName(automaton.Name, format), content, contentType);
    }

    public static string FileName(string name, string extension)
    {
        var safe = Regex.Replace(name ?? "", "[^A-Za-z0-9._-]", "_").Trim('.');
        if (safe.Length > 100) safe = safe[..100];
        return $"{(safe.Length > 0 ? safe : "automaton")}.{extension}";
    }

    // XmlWriter over StringBuilder declares UTF-16; browser Blob encodes text as UTF-8.
    public static string NormalizeXmlEncoding(string content) => content.Replace(
        "<?xml version=\"1.0\" encoding=\"utf-16\"", "<?xml version=\"1.0\" encoding=\"utf-8\"", StringComparison.OrdinalIgnoreCase);

    private static string WriteNativeFile(DeterministicFiniteAutomaton source, string format)
    {
        // The browser runtime provides an in-memory filesystem. The same native writers run in .NET tests.
        var directory = Path.Combine(Path.GetTempPath(), $"ultrades-export-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"automaton.{format}");
        try
        {
            switch (format)
            {
                case "xml": source.ToXMLFile(path); break;
                case "ads": source.ToAdsFile(path); break;
                case "fsm": source.ToFsmFile(path); break;
                case "fm": source.ToFmFile(path); break;
            }
            return File.ReadAllText(path);
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
