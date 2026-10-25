using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace DbStudio.Import.Parsing;

/// <summary>
/// Forward-only scanner over UTF-8 JSON bytes that hands out whole values one at a time, so a file with millions of array
/// elements is parsed element by element (each element goes through JsonDocument) and never held in memory as a whole.
/// </summary>
internal sealed class JsonScanner
{
    private readonly Stream _s;
    private readonly byte[] _buf = new byte[64 * 1024];
    private int _pos, _len;
    private bool _eof;
    public long Consumed { get; private set; }

    public JsonScanner(Stream s) => _s = s;

    private int Peek()
    {
        if (_pos >= _len)
        {
            if (_eof) return -1;
            _len = _s.Read(_buf, 0, _buf.Length);
            _pos = 0;
            if (_len <= 0) { _eof = true; _len = 0; return -1; }
        }
        return _buf[_pos];
    }

    private int Next()
    {
        var c = Peek();
        if (c >= 0) { _pos++; Consumed++; }
        return c;
    }

    public int SkipWs()
    {
        int c;
        while ((c = Peek()) is ' ' or '\t' or '\r' or '\n') Next();
        return c;
    }

    public int PeekNonWs() => SkipWs();

    public void Expect(char ch)
    {
        var c = SkipWs();
        if (c != ch) throw new JsonException(c < 0 ? $"Unexpected end of JSON, expected '{ch}'." : $"Invalid JSON: expected '{ch}' but found '{(char)c}'.");
        Next();
    }

    public bool TryConsume(char ch)
    {
        if (SkipWs() != ch) return false;
        Next();
        return true;
    }

    /// <summary>Reads a property name and the colon after it.</summary>
    public string ReadPropertyName()
    {
        var bytes = new ArrayBufferWriter<byte>(64);
        CaptureValueInto(bytes);
        var name = JsonSerializer.Deserialize<string>(bytes.WrittenSpan) ?? "";
        Expect(':');
        return name;
    }

    public ReadOnlyMemory<byte> CaptureValue()
    {
        var w = new ArrayBufferWriter<byte>(256);
        CaptureValueInto(w);
        return w.WrittenMemory;
    }

    /// <summary>Consumes the next value without keeping it.</summary>
    public void SkipValue() => CaptureValueInto(null);

    private void CaptureValueInto(ArrayBufferWriter<byte>? w)
    {
        var c = SkipWs();
        if (c < 0) throw new JsonException("Unexpected end of JSON.");
        void Put(int b) { if (w is not null) w.GetSpan(1)[0] = (byte)b; w?.Advance(1); }
        if (c == '"')
        {
            Put(Next());
            while (true)
            {
                var b = Next();
                if (b < 0) throw new JsonException("Unterminated JSON string.");
                Put(b);
                if (b == '\\') { var e = Next(); if (e < 0) throw new JsonException("Unterminated JSON string."); Put(e); }
                else if (b == '"') return;
            }
        }
        if (c == '{' || c == '[')
        {
            var depth = 0;
            while (true)
            {
                var b = Next();
                if (b < 0) throw new JsonException("Unexpected end of JSON.");
                Put(b);
                if (b == '"')
                {
                    while (true)
                    {
                        var d = Next();
                        if (d < 0) throw new JsonException("Unterminated JSON string.");
                        Put(d);
                        if (d == '\\') { var e = Next(); if (e < 0) throw new JsonException("Unterminated JSON string."); Put(e); }
                        else if (d == '"') break;
                    }
                }
                else if (b == '{' || b == '[') depth++;
                else if (b == '}' || b == ']') { if (--depth == 0) return; }
            }
        }
        // number, true, false, null
        var any = false;
        while (true)
        {
            var b = Peek();
            if (b < 0 || b is ',' or ']' or '}' or ' ' or '\t' or '\r' or '\n') break;
            Put(Next());
            any = true;
        }
        if (!any) throw new JsonException($"Invalid JSON near '{(char)c}'.");
    }
}

/// <summary>Streaming JSON (array of objects, optionally below a path) and NDJSON reader.</summary>
public sealed class JsonRowSource : IRowSource
{
    private const int DiscoverRecords = 500;
    private const int MaxFlattenDepth = 4;

    private readonly Stream _stream;
    private readonly CountingStream _counting;
    private readonly JsonScanner _scan;
    private readonly bool _ndjson;
    private readonly List<string> _columns;
    private readonly Dictionary<string, int> _index;
    private readonly SourceOptions _options;
    private readonly List<string> _warnings = [];
    private bool _inArray, _first = true, _finished, _singleRoot;
    private long _row;

    public IReadOnlyList<string> Columns => _columns;
    public object?[] Current { get; private set; } = [];
    public long RowNumber => _row;
    public long Position => _counting.BytesRead;
    public long Length => _counting.Length;
    public IReadOnlyList<string> Warnings => _warnings;

    private JsonRowSource(Stream stream, CountingStream counting, SourceOptions options, bool ndjson, List<string> columns)
    {
        _stream = stream;
        _counting = counting;
        _scan = new JsonScanner(stream);
        _options = options;
        _ndjson = ndjson;
        _columns = columns;
        _index = columns.Select((c, i) => (c, i)).ToDictionary(t => t.c, t => t.i, StringComparer.Ordinal);
    }

    private static (Stream Stream, CountingStream Counting) OpenStream(string path, SourceOptions o)
    {
        var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.SequentialScan);
        var counting = new CountingStream(fs);
        var head = new byte[4];
        // Detect a BOM without a seekable stream: peek through a small prefix.
        var n = ReadFully(counting, head);
        var prefix = head.AsSpan(0, n).ToArray();
        var (name, bom) = Encodings.Detect(prefix);
        Encoding enc;
        if (string.IsNullOrWhiteSpace(o.Encoding) || o.Encoding == "auto") enc = Encodings.Resolve(name.StartsWith("utf-16", StringComparison.Ordinal) ? name : "utf-8");
        else enc = Encodings.Resolve(o.Encoding);
        var skip = bom > 0 && ((enc.CodePage == 65001) == (bom == 3)) ? bom : 0;
        Stream rest = new PrefixStream(prefix.AsSpan(skip).ToArray(), counting);
        if (enc.CodePage != 65001) rest = Encoding.CreateTranscodingStream(rest, enc, Encoding.UTF8, leaveOpen: false);
        return (rest, counting);
    }

    private static int ReadFully(Stream s, byte[] buf)
    {
        var n = 0;
        while (n < buf.Length) { var r = s.Read(buf, n, buf.Length - n); if (r <= 0) break; n += r; }
        return n;
    }

    private sealed class PrefixStream(byte[] prefix, Stream inner) : Stream
    {
        private int _p;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => inner.Length;
        public override long Position { get => 0; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_p < prefix.Length)
            {
                var n = Math.Min(count, prefix.Length - _p);
                Array.Copy(prefix, _p, buffer, offset, n);
                _p += n;
                return n;
            }
            return inner.Read(buffer, offset, count);
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
    }

    public static JsonRowSource Open(string path, SourceOptions options, bool ndjson)
    {
        // Pass 1: discover the columns from the first records.
        List<string> columns;
        List<string> warnings;
        {
            var (s1, c1) = OpenStream(path, options);
            using var _ = s1;
            var probe = new JsonRowSource(s1, c1, options, ndjson, []);
            columns = probe.Discover();
            warnings = probe._warnings;
        }
        var (s2, c2) = OpenStream(path, options);
        var src = new JsonRowSource(s2, c2, options, ndjson, columns);
        src._warnings.AddRange(warnings);
        return src;
    }

    /// <summary>Flattened property names of the first records, in order of appearance.</summary>
    private List<string> Discover()
    {
        var names = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var n = 0;
        var scalarOnly = false;
        _warnings.Clear();
        while (n < DiscoverRecords && NextRecordBytes() is { } bytes)
        {
            n++;
            using var doc = JsonDocument.Parse(bytes);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
            {
                var keys = new List<string>();
                Flatten(root, "", 0, (k, _) => keys.Add(k));
                foreach (var k in keys) if (seen.Add(k)) names.Add(k);
            }
            else if (root.ValueKind == JsonValueKind.Array)
            {
                var len = root.GetArrayLength();
                for (var i = 0; i < len; i++) { var k = "Column" + (i + 1); if (seen.Add(k)) names.Add(k); }
            }
            else
            {
                scalarOnly = true;
            }
        }
        if (names.Count == 0 && scalarOnly) names.Add("value");
        if (n == DiscoverRecords) _warnings.Add($"Columns were detected from the first {DiscoverRecords} records; properties that first appear later are ignored.");
        return names;
    }

    /// <summary>Bytes of the next record, or null at the end.</summary>
    private ReadOnlyMemory<byte>? NextRecordBytes()
    {
        if (_finished) return null;
        if (_ndjson)
        {
            if (_scan.SkipWs() < 0) { _finished = true; return null; }
            return _scan.CaptureValue();
        }
        if (_first)
        {
            _first = false;
            EnterArray();
        }
        if (_fromMemory)
        {
            if (_memoryIndex < _memory.Count) return Encoding.UTF8.GetBytes(_memory[_memoryIndex++]);
            _finished = true;
            return null;
        }
        if (_singleRoot)
        {
            _finished = true;
            return _singleBytes;
        }
        if (!_inArray) { _finished = true; return null; }
        if (_scan.SkipWs() == ']') { _scan.Expect(']'); _finished = true; return null; }
        var rec = _scan.CaptureValue();
        var c = _scan.SkipWs();
        if (c == ',') _scan.Expect(',');
        else if (c != ']') throw new JsonException("Invalid JSON: expected ',' or ']' after an array element.");
        return rec;
    }

    private ReadOnlyMemory<byte> _singleBytes;

    /// <summary>Positions the scanner inside the array to import (following the JSON path).</summary>
    private void EnterArray()
    {
        var segments = (_options.JsonPath ?? "").Trim().TrimStart('$').Trim('.').Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var c = _scan.SkipWs();
        if (c < 0) throw new JsonException("The file is empty.");
        foreach (var seg in segments)
        {
            if (_scan.SkipWs() != '{') throw new ArgumentException($"JSON path '{_options.JsonPath}': '{seg}' is not inside an object.");
            _scan.Expect('{');
            var found = false;
            while (_scan.SkipWs() != '}')
            {
                var name = _scan.ReadPropertyName();
                if (name == seg) { found = true; break; }
                _scan.SkipValue();
                if (_scan.SkipWs() == ',') _scan.Expect(',');
            }
            if (!found) throw new ArgumentException($"JSON path '{_options.JsonPath}' was not found (no property '{seg}').");
        }
        c = _scan.SkipWs();
        if (c == '[') { _scan.Expect('['); _inArray = true; return; }
        if (c == '{' && segments.Length == 0)
        {
            // Root object: use its first array property, else treat the object as the only record.
            var bytes = _scan.CaptureValue();
            using var doc = JsonDocument.Parse(bytes);
            var prop = doc.RootElement.EnumerateObject().FirstOrDefault(p => p.Value.ValueKind == JsonValueKind.Array);
            if (prop.Value.ValueKind == JsonValueKind.Array)
            {
                // Re-read the array from the captured bytes: stream the elements from memory.
                _memory = [.. prop.Value.EnumerateArray().Select(e => e.GetRawText())];
                _memoryIndex = 0;
                _inArray = false;
                _fromMemory = true;
                _warnings.Add($"The file is an object; its array property '{prop.Name}' was imported (set a JSON path to choose another).");
                return;
            }
            _singleRoot = true;
            _singleBytes = bytes;
            return;
        }
        if (c == '{') { _singleRoot = true; _singleBytes = _scan.CaptureValue(); return; }
        throw new ArgumentException(segments.Length == 0 ? "The JSON root must be an array of objects (or set a JSON path)." : $"JSON path '{_options.JsonPath}' does not point to an array.");
    }

    private List<string> _memory = [];
    private int _memoryIndex;
    private bool _fromMemory;

    public bool Read()
    {
        var rec = NextRecordBytes();
        if (rec is null) { Current = []; return false; }
        using var doc = JsonDocument.Parse(rec.Value);
        var values = new object?[_columns.Count];
        var root = doc.RootElement;
        switch (root.ValueKind)
        {
            case JsonValueKind.Object:
                Flatten(root, "", 0, (k, v) => { if (_index.TryGetValue(k, out var i)) values[i] = v; });
                break;
            case JsonValueKind.Array:
                var idx = 0;
                foreach (var e in root.EnumerateArray())
                {
                    if (idx < values.Length) values[idx] = Scalar(e);
                    idx++;
                }
                break;
            default:
                if (values.Length > 0) values[0] = Scalar(root);
                break;
        }
        if (_options.TrimValues)
            for (var i = 0; i < values.Length; i++) if (values[i] is string s) values[i] = s.Trim();
        var nulls = _options.Nulls;
        for (var i = 0; i < values.Length; i++)
            if (values[i] is string s2 && s2.Length == 0 && nulls.Contains("")) values[i] = null;
        _row++;
        Current = values;
        return true;
    }

    private static object? Scalar(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => Number(e),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => e.GetRawText(),
    };

    private static object Number(JsonElement e)
    {
        if (e.TryGetInt64(out var l)) return l;
        if (e.TryGetDecimal(out var d)) return d;
        return e.GetDouble();
    }

    private static void Flatten(JsonElement obj, string prefix, int depth, Action<string, object?> emit)
    {
        foreach (var p in obj.EnumerateObject())
        {
            var key = prefix.Length == 0 ? p.Name : prefix + "." + p.Name;
            if (p.Value.ValueKind == JsonValueKind.Object && depth < MaxFlattenDepth) Flatten(p.Value, key, depth + 1, emit);
            else emit(key, Scalar(p.Value));
        }
    }

    public void Dispose() => _stream.Dispose();

    /// <summary>
    /// Property paths whose value is an array (candidates for the JSON path), found by walking at most <paramref name="maxBytes"/>
    /// of the file.
    /// </summary>
    public static IReadOnlyList<string> FindArrayPaths(string path, SourceOptions options, long maxBytes = 8 << 20)
    {
        var result = new List<string>();
        var (s, c) = OpenStream(path, options);
        using var _ = s;
        var scan = new JsonScanner(s);
        try
        {
            Walk(scan, "", 0, result, maxBytes);
        }
        catch (JsonException) { /* partial results */ }
        return result;
    }

    private static void Walk(JsonScanner scan, string prefix, int depth, List<string> result, long maxBytes)
    {
        var c = scan.SkipWs();
        if (c == '[') { if (prefix.Length > 0) result.Add(prefix); scan.SkipValue(); return; }
        if (c != '{' || depth > 4) { scan.SkipValue(); return; }
        scan.Expect('{');
        while (scan.SkipWs() != '}' && scan.Consumed < maxBytes)
        {
            var name = scan.ReadPropertyName();
            Walk(scan, prefix.Length == 0 ? name : prefix + "." + name, depth + 1, result, maxBytes);
            if (scan.SkipWs() == ',') scan.Expect(',');
        }
        scan.TryConsume('}');
    }
}
