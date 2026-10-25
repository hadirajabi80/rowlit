using System.Text;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Core.Export;

/// <summary>GitHub-flavoured Markdown table: pipes escaped, line breaks as &lt;br&gt;, numbers right-aligned, NULL written as "NULL" unless <c>NullAs</c> is set.</summary>
public sealed class MarkdownResultWriter : IResultWriter
{
    private readonly StreamWriter _writer;
    private readonly ExportOptions _options;
    private readonly string _nullAs;
    private ColumnInfo[] _columns = [];

    public MarkdownResultWriter(Stream stream, ExportOptions options)
    {
        _writer = new StreamWriter(stream, ExportFormats.Utf8(options), 64 * 1024, leaveOpen: true) { NewLine = "\n" };
        _options = options;
        _nullAs = options.NullAs ?? "NULL";
    }

    private static string Escape(string s) =>
        s.Replace("|", "\\|", StringComparison.Ordinal).Replace("\r\n", "<br>", StringComparison.Ordinal)
            .Replace("\n", "<br>", StringComparison.Ordinal).Replace("\r", "<br>", StringComparison.Ordinal);

    private static bool IsNumeric(ColumnInfo c) => c.Kind is ColumnKinds.Int or ColumnKinds.Decimal or ColumnKinds.Float;

    public async Task BeginAsync(ColumnInfo[] columns, CancellationToken ct)
    {
        _columns = columns;
        await _writer.WriteLineAsync($"| {string.Join(" | ", columns.Select(c => Escape(c.Name)))} |").ConfigureAwait(false);
        await _writer.WriteLineAsync($"| {string.Join(" | ", columns.Select(c => IsNumeric(c) ? "---:" : "---"))} |").ConfigureAwait(false);
    }

    public async Task WriteRowAsync(object?[] row, CancellationToken ct)
    {
        var cells = row.Select((v, i) => Escape(ExportFormats.CellText(v, i < _columns.Length ? _columns[i] : null, _options) ?? _nullAs));
        await _writer.WriteLineAsync($"| {string.Join(" | ", cells)} |").ConfigureAwait(false);
    }

    public Task EndAsync(CancellationToken ct) => _writer.FlushAsync(ct);

    public ValueTask DisposeAsync() => _writer.DisposeAsync();
}
