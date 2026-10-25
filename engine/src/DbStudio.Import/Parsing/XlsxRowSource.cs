using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace DbStudio.Import.Parsing;

/// <summary>
/// Minimal streaming .xlsx reader (System.IO.Compression + XmlReader): sheet list, shared strings, date styles
/// (1900 and 1904 systems), inline strings, booleans. The sheet XML is read forward only; only the shared-string table
/// is held in memory.
/// </summary>
public sealed class XlsxRowSource : IRowSource
{
    private readonly ZipArchive _zip;
    private readonly CountingStream _sheetStream;
    private readonly XmlReader _xml;
    private readonly List<string?> _shared;
    private readonly bool[] _dateStyles;
    private readonly bool _date1904;
    private readonly SourceOptions _options;
    private readonly List<string> _columns;
    private readonly List<string> _warnings = [];
    private object?[]? _pending;
    private long _row;

    public IReadOnlyList<string> Columns => _columns;
    public object?[] Current { get; private set; } = [];
    public long RowNumber => _row;
    public long Position => _sheetStream.BytesRead;
    public long Length => _sheetStream.Length;
    public IReadOnlyList<string> Warnings => _warnings;

    private XlsxRowSource(ZipArchive zip, CountingStream sheetStream, XmlReader xml, List<string?> shared, bool[] dateStyles, bool date1904,
        SourceOptions options, List<string> columns, object?[]? pending)
    {
        _zip = zip; _sheetStream = sheetStream; _xml = xml; _shared = shared; _dateStyles = dateStyles; _date1904 = date1904;
        _options = options; _columns = columns; _pending = pending;
    }

    private sealed record SheetRef(string Name, string Path);

    /// <summary>Sheet names in workbook order.</summary>
    public static IReadOnlyList<string> SheetNames(string path)
    {
        using var zip = OpenZip(path);
        return ReadSheets(zip, out _).Select(s => s.Name).ToList();
    }

    private static ZipArchive OpenZip(string path)
    {
        try
        {
            return new ZipArchive(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete), ZipArchiveMode.Read);
        }
        catch (InvalidDataException)
        {
            throw new InvalidDataException("The file is not a valid .xlsx workbook (the old binary .xls format is not supported).");
        }
    }

    private static XmlReaderSettings Settings() => new() { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, IgnoreComments = true };

    private static List<SheetRef> ReadSheets(ZipArchive zip, out bool date1904)
    {
        date1904 = false;
        var wb = zip.GetEntry("xl/workbook.xml") ?? throw new InvalidDataException("xl/workbook.xml is missing: not an .xlsx workbook.");
        var rels = new Dictionary<string, string>(StringComparer.Ordinal);
        var relEntry = zip.GetEntry("xl/_rels/workbook.xml.rels");
        if (relEntry is not null)
        {
            using var rs = relEntry.Open();
            using var r = XmlReader.Create(rs, Settings());
            while (r.Read())
                if (r.NodeType == XmlNodeType.Element && r.LocalName == "Relationship")
                {
                    var id = r.GetAttribute("Id");
                    var target = r.GetAttribute("Target");
                    if (id is not null && target is not null) rels[id] = target;
                }
        }
        var sheets = new List<SheetRef>();
        using var ws = wb.Open();
        using var x = XmlReader.Create(ws, Settings());
        var n = 0;
        while (x.Read())
        {
            if (x.NodeType != XmlNodeType.Element) continue;
            if (x.LocalName == "workbookPr") date1904 = x.GetAttribute("date1904") is "1" or "true";
            else if (x.LocalName == "sheet")
            {
                n++;
                var name = x.GetAttribute("name") ?? "Sheet" + n;
                var rid = x.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships");
                string target = rid is not null && rels.TryGetValue(rid, out var t) ? t : $"worksheets/sheet{n}.xml";
                target = target.StartsWith('/') ? target.TrimStart('/') : "xl/" + target;
                sheets.Add(new SheetRef(name, target));
            }
        }
        return sheets;
    }

    private static List<string?> ReadSharedStrings(ZipArchive zip)
    {
        var list = new List<string?>();
        var e = zip.GetEntry("xl/sharedStrings.xml");
        if (e is null) return list;
        using var s = e.Open();
        using var r = XmlReader.Create(s, Settings());
        var sb = new StringBuilder();
        while (r.Read())
        {
            if (r.NodeType != XmlNodeType.Element || r.LocalName != "si") continue;
            sb.Clear();
            if (!r.IsEmptyElement)
            {
                using var si = r.ReadSubtree();
                si.Read(); // the <si> element itself
                si.Read();
                while (!si.EOF)
                {
                    if (si.NodeType == XmlNodeType.Element && si.LocalName == "rPh") { si.Skip(); continue; }
                    if (si.NodeType == XmlNodeType.Element && si.LocalName == "t")
                    {
                        if (si.IsEmptyElement) si.Read();
                        else sb.Append(si.ReadElementContentAsString());
                        continue;
                    }
                    si.Read();
                }
            }
            list.Add(sb.ToString());
        }
        return list;
    }

    private static readonly Regex DateCode = new(@"[ymdhs]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Quoted = new("\"[^\"]*\"|\\[[^\\]]*\\]|\\\\.|_.", RegexOptions.Compiled);

    internal static bool IsDateFormat(int id, string? code)
    {
        if (id is >= 14 and <= 22 or >= 27 and <= 36 or >= 45 and <= 47 or >= 50 and <= 58) return true;
        if (code is null || code.Equals("General", StringComparison.OrdinalIgnoreCase)) return false;
        var stripped = Quoted.Replace(code.Split(';')[0], "");
        return DateCode.IsMatch(stripped);
    }

    private static bool[] ReadDateStyles(ZipArchive zip)
    {
        var e = zip.GetEntry("xl/styles.xml");
        if (e is null) return [];
        var formats = new Dictionary<int, string>();
        var xfs = new List<int>();
        using var s = e.Open();
        using var r = XmlReader.Create(s, Settings());
        var inCellXfs = false;
        while (r.Read())
        {
            if (r.NodeType == XmlNodeType.Element)
            {
                switch (r.LocalName)
                {
                    case "numFmt":
                        if (int.TryParse(r.GetAttribute("numFmtId"), CultureInfo.InvariantCulture, out var id)) formats[id] = r.GetAttribute("formatCode") ?? "";
                        break;
                    case "cellXfs": inCellXfs = true; break;
                    case "xf" when inCellXfs:
                        xfs.Add(int.TryParse(r.GetAttribute("numFmtId"), CultureInfo.InvariantCulture, out var f) ? f : 0);
                        break;
                }
            }
            else if (r.NodeType == XmlNodeType.EndElement && r.LocalName == "cellXfs") inCellXfs = false;
        }
        return xfs.Select(id => IsDateFormat(id, formats.GetValueOrDefault(id))).ToArray();
    }

    public static XlsxRowSource Open(string path, SourceOptions options)
    {
        var zip = OpenZip(path);
        try
        {
            var sheets = ReadSheets(zip, out var date1904);
            if (sheets.Count == 0) throw new InvalidDataException("The workbook has no sheets.");
            var sheet = string.IsNullOrWhiteSpace(options.Sheet)
                ? sheets[0]
                : sheets.FirstOrDefault(s => s.Name.Equals(options.Sheet, StringComparison.OrdinalIgnoreCase))
                  ?? throw new ArgumentException($"Sheet '{options.Sheet}' not found. Sheets: {string.Join(", ", sheets.Select(s => s.Name))}.");
            var entry = zip.GetEntry(sheet.Path) ?? throw new InvalidDataException($"Sheet part '{sheet.Path}' is missing.");
            var shared = ReadSharedStrings(zip);
            var dateStyles = ReadDateStyles(zip);
            var counting = new CountingStream(entry.Open(), entry.Length);
            var xml = XmlReader.Create(counting, Settings());
            var src = new XlsxRowSource(zip, counting, xml, shared, dateStyles, date1904, options, [], null);
            src.InitHeader();
            return src;
        }
        catch
        {
            zip.Dispose();
            throw;
        }
    }

    private void InitHeader()
    {
        // Skip rows by sheet row number, then take the first non-empty row as header (or as first data row).
        object?[]? first;
        do
        {
            first = ReadRawRow(out var rowNo);
            if (first is not null && rowNo <= _options.Skip) first = [];
        } while (first is not null && first.All(IsEmptyCell));
        if (first is null) return;
        if (_options.Header)
        {
            _columns.AddRange(ColumnNames.Normalize(first.Select(v => v is null ? null : CellText(v))));
        }
        else
        {
            _columns.AddRange(ColumnNames.Normalize(Enumerable.Repeat<string?>(null, first.Length)));
            _pending = first;
        }
    }

    private static bool IsEmptyCell(object? v) => v is null || v is string { Length: 0 };

    private static string CellText(object v) => v switch
    {
        string s => s.Trim(),
        DateTime d => d.TimeOfDay == TimeSpan.Zero ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : d.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString() ?? "",
    };

    public bool Read()
    {
        object?[]? raw;
        if (_pending is not null) { raw = _pending; _pending = null; }
        else
        {
            while (true)
            {
                raw = ReadRawRow(out _);
                if (raw is null) { Current = []; return false; }
                if (!raw.All(IsEmptyCell)) break;
            }
        }
        _row++;
        var values = new object?[_columns.Count];
        var nulls = _options.Nulls;
        for (var i = 0; i < values.Length && i < raw.Length; i++)
        {
            var v = raw[i];
            if (v is string s)
            {
                if (_options.TrimValues) s = s.Trim();
                v = nulls.Contains(s) ? null : s;
            }
            values[i] = v;
        }
        Current = values;
        return true;
    }

    private bool _done;

    /// <summary>The next sheet row as cell values (gaps are null), or null at the end of the sheet.</summary>
    private object?[]? ReadRawRow(out int rowNumber)
    {
        rowNumber = 0;
        if (_done) return null;
        while (_xml.Read())
        {
            if (_xml.NodeType != XmlNodeType.Element || _xml.LocalName != "row") continue;
            int.TryParse(_xml.GetAttribute("r"), CultureInfo.InvariantCulture, out rowNumber);
            var cells = new List<object?>();
            if (_xml.IsEmptyElement) return cells.ToArray();
            using var row = _xml.ReadSubtree();
            row.Read();
            while (row.Read())
            {
                if (row.NodeType != XmlNodeType.Element || row.LocalName != "c") continue;
                var col = ColumnIndex(row.GetAttribute("r"), cells.Count);
                var type = row.GetAttribute("t");
                var style = int.TryParse(row.GetAttribute("s"), CultureInfo.InvariantCulture, out var st) ? st : 0;
                string? v = null, inline = null;
                if (!row.IsEmptyElement)
                {
                    using var cell = row.ReadSubtree();
                    cell.Read();
                    while (cell.Read())
                    {
                        if (cell.NodeType != XmlNodeType.Element) continue;
                        if (cell.LocalName == "v") v = cell.ReadElementContentAsString();
                        else if (cell.LocalName == "is") inline = ReadInline(cell);
                    }
                }
                while (cells.Count < col) cells.Add(null);
                var value = Convert(type, style, v, inline);
                if (col < cells.Count) cells[col] = value; else cells.Add(value);
            }
            return cells.ToArray();
        }
        _done = true;
        return null;
    }

    private static string ReadInline(XmlReader r)
    {
        var sb = new StringBuilder();
        var depth = r.Depth;
        while (r.Read() && r.Depth > depth)
            if (r.NodeType == XmlNodeType.Element && r.LocalName == "t") sb.Append(r.ReadElementContentAsString());
        return sb.ToString();
    }

    internal static int ColumnIndex(string? cellRef, int fallback)
    {
        if (string.IsNullOrEmpty(cellRef)) return fallback;
        var n = 0;
        foreach (var ch in cellRef)
        {
            if (ch is >= 'A' and <= 'Z') n = n * 26 + (ch - 'A' + 1);
            else if (ch is >= 'a' and <= 'z') n = n * 26 + (ch - 'a' + 1);
            else break;
        }
        return n == 0 ? fallback : n - 1;
    }

    private object? Convert(string? type, int style, string? v, string? inline)
    {
        switch (type)
        {
            case "inlineStr": return inline ?? v;
            case "s":
                return int.TryParse(v, CultureInfo.InvariantCulture, out var idx) && idx >= 0 && idx < _shared.Count ? _shared[idx] : null;
            case "str": return v;
            case "b": return v is "1" or "true";
            case "e": return null;
            case "d":
                return DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var iso)
                    ? DateTime.SpecifyKind(iso, DateTimeKind.Unspecified) : v;
        }
        if (v is null) return null;
        if (!decimal.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var num))
            return double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var dbl) ? dbl : v;
        if (style >= 0 && style < _dateStyles.Length && _dateStyles[style]) return SerialToValue((double)num, _date1904);
        if (num == decimal.Truncate(num) && Math.Abs(num) < 1e15m) return (long)num;
        return num;
    }

    /// <summary>Excel serial date to DateTime (or TimeSpan for values below one day).</summary>
    public static object SerialToValue(double serial, bool date1904)
    {
        if (serial >= 0 && serial < 1 && !date1904)
            return TimeSpan.FromTicks((long)Math.Round(serial * TimeSpan.TicksPerDay / TimeSpan.TicksPerMillisecond) * TimeSpan.TicksPerMillisecond);
        DateTime baseDate = date1904 ? new DateTime(1904, 1, 1) : serial < 61 ? new DateTime(1899, 12, 31) : new DateTime(1899, 12, 30);
        var ms = Math.Round(serial * 86_400_000d);
        return baseDate.AddMilliseconds(ms);
    }

    public void Dispose()
    {
        _xml.Dispose();
        _sheetStream.Dispose();
        _zip.Dispose();
    }
}
