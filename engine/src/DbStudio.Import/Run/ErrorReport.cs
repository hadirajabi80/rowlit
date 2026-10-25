using System.Text;

namespace DbStudio.Import.Run;

/// <summary>
/// CSV report of the rows an import could not write (<c>row,column,error,&lt;source columns&gt;</c>), written as the errors
/// occur and served by <c>GET /import/errors/{jobId}</c>. UTF-8 with a BOM so Excel shows Persian text correctly.
/// </summary>
public sealed class ErrorReport : IDisposable
{
    private readonly string _path;
    private readonly IReadOnlyList<string> _columns;
    private StreamWriter? _writer;

    public ErrorReport(string directory, string jobId, IReadOnlyList<string> sourceColumns)
    {
        Directory.CreateDirectory(directory);
        _path = PathFor(directory, jobId);
        _columns = sourceColumns;
    }

    public static string PathFor(string directory, string jobId) =>
        Path.Combine(directory, new string(jobId.Where(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-').ToArray()) + ".csv");

    public int Count { get; private set; }

    public void Add(long row, string? column, string message, IReadOnlyList<string?>? values)
    {
        if (_writer is null)
        {
            _writer = new StreamWriter(new FileStream(_path, FileMode.Create, FileAccess.Write, FileShare.Read), new UTF8Encoding(true));
            _writer.WriteLine(string.Join(',', new[] { "row", "column", "error" }.Concat(_columns).Select(Csv)));
        }
        var cells = new List<string?> { row.ToString(System.Globalization.CultureInfo.InvariantCulture), column, message };
        if (values is not null) cells.AddRange(values);
        _writer.WriteLine(string.Join(',', cells.Select(Csv)));
        Count++;
    }

    private static string Csv(string? s)
    {
        if (s is null) return "";
        if (s.Length > 2000) s = s[..2000] + "...";
        return s.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? "\"" + s.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : s;
    }

    public void Dispose()
    {
        _writer?.Dispose();
        _writer = null;
    }

    /// <summary>Deletes reports older than <paramref name="age"/> (called when an import starts).</summary>
    public static void Cleanup(string directory, TimeSpan age)
    {
        try
        {
            if (!Directory.Exists(directory)) return;
            foreach (var f in Directory.EnumerateFiles(directory, "*.csv"))
                if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow - age) File.Delete(f);
        }
        catch (IOException) { /* best effort */ }
        catch (UnauthorizedAccessException) { /* best effort */ }
    }
}
