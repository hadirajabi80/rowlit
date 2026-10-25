using System.Text;

namespace DbStudio.Import.Parsing;

/// <summary>
/// A streaming table of raw values: strings (csv), numbers / dates / booleans (xlsx), JSON scalars (json). Nothing is
/// buffered beyond the current record, so files of any size import in constant memory.
/// </summary>
public interface IRowSource : IDisposable
{
    IReadOnlyList<string> Columns { get; }

    /// <summary>Advances to the next data row; false at the end.</summary>
    bool Read();

    /// <summary>Values of the current row, <c>Columns.Count</c> long (null = NULL / missing).</summary>
    object?[] Current { get; }

    /// <summary>1-based number of the current data row (after the header).</summary>
    long RowNumber { get; }

    /// <summary>Bytes consumed so far / total (progress).</summary>
    long Position { get; }
    long Length { get; }

    /// <summary>Non-fatal findings while reading (rows with extra fields ...).</summary>
    IReadOnlyList<string> Warnings { get; }
}

/// <summary>Column naming shared by all readers.</summary>
public static class ColumnNames
{
    /// <summary>Blank names become "Column{n}", duplicates get "_2", "_3" suffixes.</summary>
    public static List<string> Normalize(IEnumerable<string?> raw)
    {
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var i = 0;
        foreach (var r in raw)
        {
            i++;
            var name = (r ?? "").Trim();
            if (name.Length == 0) name = "Column" + i;
            var candidate = name;
            var n = 2;
            while (!seen.Add(candidate)) candidate = name + "_" + n++;
            result.Add(candidate);
        }
        return result;
    }
}

/// <summary>Opens the reader for a file. Detects what the options leave open.</summary>
public static class RowSources
{
    public static IRowSource Open(string path, SourceOptions options)
    {
        if (!File.Exists(path)) throw new FileNotFoundException($"File not found: {path}", path);
        var format = options.Format.ToLowerInvariant();
        return format switch
        {
            "csv" or "tsv" => CsvRowSource.Open(path, options),
            "xlsx" => XlsxRowSource.Open(path, options),
            "json" => JsonRowSource.Open(path, options, ndjson: false),
            "ndjson" => JsonRowSource.Open(path, options, ndjson: true),
            _ => throw new ArgumentException($"Unsupported import format '{options.Format}'."),
        };
    }

    /// <summary>
    /// Fills the auto-detected options (encoding, delimiter, sheet, ...) so the caller can echo the effective options and
    /// later runs read the file exactly like the preview.
    /// </summary>
    public static SourceOptions Resolve(string path, SourceOptions options)
    {
        var o = options.Clone();
        if (string.IsNullOrWhiteSpace(o.Format)) o.Format = SourceOptions.FormatOf(path) ?? "csv";
        o.Format = o.Format.ToLowerInvariant();
        if (o.Format is "csv" or "tsv") CsvRowSource.ResolveOptions(path, o);
        else if (o.Format == "json" || o.Format == "ndjson")
        {
            o.Encoding = string.IsNullOrWhiteSpace(o.Encoding) || o.Encoding == "auto" ? DetectEncoding(path).Name : o.Encoding;
        }
        return o;
    }

    public static (string Name, int Bom) DetectEncoding(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var buf = new byte[65536];
        var n = fs.Read(buf, 0, buf.Length);
        return Encodings.Detect(buf.AsSpan(0, n));
    }
}

/// <summary>Stream wrapper counting the bytes read (progress by file position).</summary>
internal sealed class CountingStream(Stream inner, long? length = null) : Stream
{
    public long BytesRead { get; private set; }
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => length ?? inner.Length;
    public override long Position { get => BytesRead; set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override int Read(byte[] buffer, int offset, int count) { var n = inner.Read(buffer, offset, count); BytesRead += n; return n; }
    public override int Read(Span<byte> buffer) { var n = inner.Read(buffer); BytesRead += n; return n; }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
}

/// <summary>RFC 4180 record tokenizer with a configurable delimiter, quote and escape character.</summary>
public sealed class CsvTokenizer
{
    private readonly TextReader _reader;
    private readonly char _delimiter;
    private readonly int _quote;   // -1: none
    private readonly int _escape;  // -1: none (doubled quote)
    private readonly char[] _buf = new char[32 * 1024];
    private int _pos, _len;
    private bool _eof;
    private readonly StringBuilder _sb = new();

    public CsvTokenizer(TextReader reader, char delimiter, int quote, int escape)
    {
        _reader = reader;
        _delimiter = delimiter;
        _quote = quote;
        _escape = escape == quote ? -1 : escape;
    }

    private int Peek()
    {
        if (_pos >= _len)
        {
            if (_eof) return -1;
            _len = _reader.Read(_buf, 0, _buf.Length);
            _pos = 0;
            if (_len <= 0) { _eof = true; _len = 0; return -1; }
        }
        return _buf[_pos];
    }

    private int Next()
    {
        var c = Peek();
        if (c >= 0) _pos++;
        return c;
    }

    /// <summary>
    /// Reads one record into <paramref name="fields"/> (value, wasQuoted). Returns false at the end of input.
    /// A completely empty line yields a single unquoted empty field (callers skip those).
    /// </summary>
    public bool ReadRecord(List<(string Value, bool Quoted)> fields)
    {
        fields.Clear();
        if (Peek() < 0) return false;
        _sb.Clear();
        var quoted = false;
        var inQuotes = false;
        var fieldStart = true;
        while (true)
        {
            var c = Next();
            if (c < 0)
            {
                fields.Add((_sb.ToString(), quoted));
                return true;
            }
            if (inQuotes)
            {
                if (_escape >= 0 && c == _escape)
                {
                    var n = Peek();
                    if (n >= 0 && (n == _quote || n == _escape)) { _sb.Append((char)Next()); continue; }
                    _sb.Append((char)c);
                    continue;
                }
                if (c == _quote)
                {
                    if (_escape < 0 && Peek() == _quote) { _sb.Append((char)Next()); continue; }
                    inQuotes = false;
                    continue;
                }
                _sb.Append((char)c);
                continue;
            }
            if (c == _quote && fieldStart)
            {
                inQuotes = true;
                quoted = true;
                fieldStart = false;
                continue;
            }
            if (c == _delimiter)
            {
                fields.Add((_sb.ToString(), quoted));
                _sb.Clear();
                quoted = false;
                fieldStart = true;
                continue;
            }
            if (c == '\r' || c == '\n')
            {
                if (c == '\r' && Peek() == '\n') Next();
                fields.Add((_sb.ToString(), quoted));
                return true;
            }
            fieldStart = false;
            _sb.Append((char)c);
        }
    }
}

/// <summary>Streaming CSV / TSV reader.</summary>
public sealed class CsvRowSource : IRowSource
{
    private readonly CountingStream _stream;
    private readonly StreamReader _text;
    private readonly CsvTokenizer _tok;
    private readonly SourceOptions _options;
    private readonly HashSet<string> _nulls;
    private readonly List<(string Value, bool Quoted)> _fields = [];
    private readonly List<string> _warnings = [];
    private readonly List<string> _columns;
    private List<(string Value, bool Quoted)>? _pending;
    private int _extraRows;
    private long _row;

    public IReadOnlyList<string> Columns => _columns;
    public object?[] Current { get; private set; } = [];
    public long RowNumber => _row;
    public long Position => _stream.BytesRead;
    public long Length => _stream.Length;
    public IReadOnlyList<string> Warnings => _warnings;

    private CsvRowSource(CountingStream stream, StreamReader text, CsvTokenizer tok, SourceOptions options, List<string> columns,
        List<(string, bool)>? firstRow)
    {
        _stream = stream;
        _text = text;
        _tok = tok;
        _options = options;
        _columns = columns;
        _pending = firstRow;
        _nulls = new HashSet<string>(options.Nulls, StringComparer.Ordinal);
    }

    public static (char Delimiter, int Quote, int Escape) Chars(SourceOptions o)
    {
        var delim = o.Delimiter switch
        {
            null or "" or "auto" => o.Format == "tsv" ? '\t' : ',',
            "\\t" or "tab" or "\t" => '\t',
            var s => s[0],
        };
        var quote = o.Quote is null ? '"' : o.Quote.Length == 0 ? -1 : o.Quote[0];
        var escape = o.Escape is null || o.Escape.Length == 0 ? quote : o.Escape[0];
        return (delim, quote, escape);
    }

    /// <summary>Fills encoding and delimiter when they are left on auto.</summary>
    public static void ResolveOptions(string path, SourceOptions o)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var buf = new byte[256 * 1024];
        var n = fs.Read(buf, 0, buf.Length);
        if (string.IsNullOrWhiteSpace(o.Encoding) || o.Encoding == "auto") o.Encoding = Encodings.Detect(buf.AsSpan(0, n)).Name;
        if (string.IsNullOrWhiteSpace(o.Delimiter) || o.Delimiter == "auto")
        {
            if (o.Format == "tsv") o.Delimiter = "\t";
            else
            {
                var enc = Encodings.Resolve(o.Encoding);
                var bom = Encodings.Detect(buf.AsSpan(0, n)).BomLength;
                var text = enc.GetString(buf, bom, n - bom);
                var (_, quote, escape) = Chars(o);
                o.Delimiter = DetectDelimiter(text, quote, escape).ToString();
            }
        }
    }

    /// <summary>The candidate delimiter giving the most consistent multi-column records over the first lines.</summary>
    public static char DetectDelimiter(string sample, int quote = '"', int escape = '"')
    {
        char best = ',';
        double bestScore = -1;
        foreach (var d in new[] { ',', ';', '\t', '|' })
        {
            var tok = new CsvTokenizer(new StringReader(sample), d, quote, escape);
            var counts = new List<int>();
            var f = new List<(string, bool)>();
            while (counts.Count < 30 && tok.ReadRecord(f))
            {
                if (f.Count == 1 && f[0].Item1.Length == 0) continue;
                counts.Add(f.Count);
            }
            // The last record may be cut by the sample size.
            if (counts.Count > 2) counts.RemoveAt(counts.Count - 1);
            if (counts.Count == 0) continue;
            var mode = counts.GroupBy(c => c).OrderByDescending(g => g.Count()).First();
            if (mode.Key < 2) continue;
            var score = (double)mode.Count() / counts.Count * 1000 + mode.Key;
            if (score > bestScore) { bestScore = score; best = d; }
        }
        return best;
    }

    public static CsvRowSource Open(string path, SourceOptions options)
    {
        var o = options.Clone();
        if (string.IsNullOrWhiteSpace(o.Encoding) || o.Encoding == "auto" || string.IsNullOrWhiteSpace(o.Delimiter) || o.Delimiter == "auto")
            ResolveOptions(path, o);
        var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.SequentialScan);
        var counting = new CountingStream(fs);
        var encoding = Encodings.Resolve(o.Encoding);
        // detectEncodingFromByteOrderMarks strips a BOM of the matching encoding.
        var text = new StreamReader(counting, encoding, detectEncodingFromByteOrderMarks: true, 64 * 1024);
        var (delim, quote, escape) = Chars(o);
        var tok = new CsvTokenizer(text, delim, quote, escape);
        var fields = new List<(string Value, bool Quoted)>();
        try
        {
            for (var i = 0; i < o.Skip; i++) if (!tok.ReadRecord(fields)) break;
            var trim = o.TrimValues;
            List<string> columns;
            List<(string, bool)>? first = null;
            do
            {
                if (!tok.ReadRecord(fields)) { fields.Clear(); break; }
            } while (fields.Count == 1 && fields[0].Value.Length == 0 && !fields[0].Quoted);
            if (o.Header)
            {
                columns = ColumnNames.Normalize(fields.Select(f => f.Value.Trim()));
                if (columns.Count == 0) columns = [];
            }
            else
            {
                columns = ColumnNames.Normalize(Enumerable.Repeat<string?>(null, fields.Count));
                if (fields.Count > 0) first = [.. fields];
            }
            return new CsvRowSource(counting, text, tok, o, columns, first);
        }
        catch
        {
            text.Dispose();
            throw;
        }
    }

    public bool Read()
    {
        List<(string Value, bool Quoted)> f;
        if (_pending is not null) { f = _pending; _pending = null; }
        else
        {
            f = _fields;
            while (true)
            {
                if (!_tok.ReadRecord(f)) { Current = []; return false; }
                if (f.Count == 1 && f[0].Value.Length == 0 && !f[0].Quoted) continue; // blank line
                break;
            }
        }
        _row++;
        var values = new object?[_columns.Count];
        var trim = _options.TrimValues;
        for (var i = 0; i < values.Length; i++)
        {
            if (i >= f.Count) { values[i] = null; continue; }
            var (v, quoted) = f[i];
            if (trim) v = v.Trim();
            values[i] = !quoted && _nulls.Contains(v) ? null : v;
        }
        if (f.Count > _columns.Count && _extraRows++ == 0)
            _warnings.Add($"Row {_row} has {f.Count} fields but the header has {_columns.Count}; extra fields are ignored.");
        Current = values;
        return true;
    }

    public void Dispose() => _text.Dispose();
}
