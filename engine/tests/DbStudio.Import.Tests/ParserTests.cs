using System.IO.Compression;
using System.Text;
using DbStudio.Import.Parsing;

namespace DbStudio.Import.Tests;

public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "rowlit-import-" + Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public string File(string name, string content, Encoding? enc = null, bool bom = false)
    {
        var p = System.IO.Path.Combine(Path, name);
        var e = enc ?? new UTF8Encoding(false);
        var bytes = e.GetBytes(content);
        if (bom) bytes = e.GetPreamble().Concat(bytes).ToArray();
        System.IO.File.WriteAllBytes(p, bytes);
        return p;
    }
    public string Combine(string name) => System.IO.Path.Combine(Path, name);
    public void Dispose() { try { Directory.Delete(Path, true); } catch (IOException) { } }
}

public static class Read
{
    public static (List<string> Columns, List<object?[]> Rows) All(string path, SourceOptions? options = null)
    {
        var o = RowSources.Resolve(path, options ?? new SourceOptions());
        using var src = RowSources.Open(path, o);
        var rows = new List<object?[]>();
        while (src.Read()) rows.Add((object?[])src.Current.Clone());
        return (src.Columns.ToList(), rows);
    }
}

public class CsvParserTests
{
    [Fact]
    public void Basic_header_and_rows()
    {
        using var d = new TempDir();
        var (cols, rows) = Read.All(d.File("a.csv", "id,name\n1,Ann\n2,Bob\n"));
        Assert.Equal(["id", "name"], cols);
        Assert.Equal(2, rows.Count);
        Assert.Equal("Bob", rows[1][1]);
    }

    [Fact]
    public void Quoted_fields_with_delimiters_quotes_and_newlines()
    {
        using var d = new TempDir();
        var (_, rows) = Read.All(d.File("a.csv", "a,b\r\n\"x,y\",\"say \"\"hi\"\"\"\r\n\"line1\nline2\",z\r\n"));
        Assert.Equal("x,y", rows[0][0]);
        Assert.Equal("say \"hi\"", rows[0][1]);
        Assert.Equal("line1\nline2", rows[1][0]);
    }

    [Theory]
    [InlineData(",")]
    [InlineData(";")]
    [InlineData("\t")]
    [InlineData("|")]
    public void Delimiter_is_detected(string delim)
    {
        using var d = new TempDir();
        var text = string.Join("\n", new[] { "id", "name", "city" }.Aggregate("", (a, c) => a + (a.Length > 0 ? delim : "") + c),
            "1" + delim + "Ann" + delim + "Paris", "2" + delim + "Bob" + delim + "Rome");
        var (cols, rows) = Read.All(d.File("a.txt", text));
        Assert.Equal(3, cols.Count);
        Assert.Equal("Rome", rows[1][2]);
    }

    [Fact]
    public void Detects_semicolon_when_commas_are_decimal_marks()
    {
        Assert.Equal(';', CsvRowSource.DetectDelimiter("a;b;c\n1,5;2,5;3\n4,5;5,5;6\n"));
    }

    [Fact]
    public void Utf8_bom_is_stripped_and_blank_lines_skipped()
    {
        using var d = new TempDir();
        var (cols, rows) = Read.All(d.File("a.csv", "id,name\n\n1,Ann\n\n2,Bob\n", new UTF8Encoding(true), bom: true));
        Assert.Equal("id", cols[0]);
        Assert.Equal(2, rows.Count);
    }

    [Fact]
    public void Persian_text_in_windows_1256_is_decoded()
    {
        using var d = new TempDir();
        Encodings.Resolve("utf-8"); // registers the code page provider
        var enc = Encodings.Resolve("windows-1256");
        var path = d.File("fa.csv", "نام,شهر\nعلي,تهران\nمريم,شيراز\n", enc);
        var (cols, rows) = Read.All(path, new SourceOptions { Encoding = "windows-1256" });
        Assert.Equal(["نام", "شهر"], cols);
        Assert.Equal("تهران", rows[0][1]);
        Assert.Equal("مريم", rows[1][0]); // windows-1256 has the Arabic yeh only
    }

    [Fact]
    public void Utf16_with_bom_is_detected()
    {
        using var d = new TempDir();
        var (cols, rows) = Read.All(d.File("u16.csv", "a,b\n1,2\n", new UnicodeEncoding(false, true), bom: true));
        Assert.Equal(["a", "b"], cols);
        Assert.Equal("2", rows[0][1]);
    }

    [Fact]
    public void Utf8_without_bom_with_persian_is_detected_as_utf8()
    {
        using var d = new TempDir();
        var o = RowSources.Resolve(d.File("fa.csv", "نام,شهر\nعلی,تهران\n"), new SourceOptions());
        Assert.Equal("utf-8", o.Encoding);
    }

    [Fact]
    public void Latin1_bytes_fall_back_to_windows_1252()
    {
        using var d = new TempDir();
        var path = d.Combine("l.csv");
        File.WriteAllBytes(path, [.. "name\n"u8, 0xE9, (byte)'\n']);
        var (_, rows) = Read.All(path);
        Assert.Equal("é", rows[0][0]);
    }

    [Fact]
    public void Skip_rows_no_header_and_ragged_rows()
    {
        using var d = new TempDir();
        var path = d.File("a.csv", "junk line\nreport\nid,name\n1,Ann\n2\n3,Cy,extra\n");
        var (cols, rows) = Read.All(path, new SourceOptions { SkipRows = 2 });
        Assert.Equal(["id", "name"], cols);
        Assert.Equal(3, rows.Count);
        Assert.Null(rows[1][1]);
        var (cols2, rows2) = Read.All(d.File("b.csv", "1,Ann\n2,Bob\n"), new SourceOptions { HasHeader = false });
        Assert.Equal(["Column1", "Column2"], cols2);
        Assert.Equal(2, rows2.Count);
    }

    [Fact]
    public void Backslash_escape_and_custom_quote()
    {
        using var d = new TempDir();
        var (_, rows) = Read.All(d.File("a.csv", "a,b\n\"x\\\"y\",'p,q'\n"), new SourceOptions { Escape = "\\", Quote = "\"" });
        Assert.Equal("x\"y", rows[0][0]);
        var (_, rows2) = Read.All(d.File("b.csv", "a,b\n'p,q',1\n"), new SourceOptions { Quote = "'" });
        Assert.Equal("p,q", rows2[0][0]);
    }

    [Fact]
    public void Null_tokens_apply_to_unquoted_fields_only_and_duplicate_headers_are_renamed()
    {
        using var d = new TempDir();
        var (cols, rows) = Read.All(d.File("a.csv", "a,a,\nNULL,\"\",\"NULL\"\n"));
        Assert.Equal(["a", "a_2", "Column3"], cols);
        Assert.Null(rows[0][0]);
        Assert.Equal("", rows[0][1]);
        Assert.Equal("NULL", rows[0][2]);
    }

    [Fact]
    public void Large_file_streams_without_loading_it()
    {
        using var d = new TempDir();
        var path = d.Combine("big.csv");
        using (var w = new StreamWriter(path))
        {
            w.WriteLine("id,name,amount");
            for (var i = 1; i <= 200_000; i++) w.WriteLine($"{i},name {i},{i * 0.5:0.0}");
        }
        var o = RowSources.Resolve(path, new SourceOptions());
        using var src = RowSources.Open(path, o);
        long n = 0;
        while (src.Read()) n++;
        Assert.Equal(200_000, n);
        Assert.Equal(src.Length, src.Position);
    }
}

public class JsonParserTests
{
    [Fact]
    public void Array_of_objects_with_nested_values_is_flattened()
    {
        using var d = new TempDir();
        var path = d.File("a.json", """[{"id":1,"name":"Ann","address":{"city":"Paris","zip":"75"},"tags":["a","b"]},{"id":2,"name":"Bob","extra":true}]""");
        var (cols, rows) = Read.All(path, new SourceOptions { Format = "json" });
        Assert.Equal(["id", "name", "address.city", "address.zip", "tags", "extra"], cols);
        Assert.Equal(1L, rows[0][0]);
        Assert.Equal("Paris", rows[0][2]);
        Assert.Equal("[\"a\",\"b\"]", rows[0][4]);
        Assert.Equal(true, rows[1][5]);
        Assert.Null(rows[1][2]);
    }

    [Fact]
    public void Json_path_selects_nested_array_and_root_object_uses_first_array()
    {
        using var d = new TempDir();
        var path = d.File("a.json", """{"meta":{"n":2},"data":{"items":[{"x":1},{"x":2}]},"other":[{"y":1}]}""");
        var (cols, rows) = Read.All(path, new SourceOptions { Format = "json", JsonPath = "$.data.items" });
        Assert.Equal(["x"], cols);
        Assert.Equal(2, rows.Count);
        var (cols2, rows2) = Read.All(path, new SourceOptions { Format = "json" });
        Assert.Equal(["y"], cols2);
        Assert.Single(rows2);
        Assert.Contains("data.items", JsonRowSource.FindArrayPaths(path, new SourceOptions { Format = "json" }));
    }

    [Fact]
    public void Missing_json_path_is_an_error()
    {
        using var d = new TempDir();
        var path = d.File("a.json", """{"a":[{"x":1}]}""");
        Assert.Throws<ArgumentException>(() => Read.All(path, new SourceOptions { Format = "json", JsonPath = "b.c" }));
    }

    [Fact]
    public void Ndjson_reads_one_record_per_line_with_unicode_and_numbers()
    {
        using var d = new TempDir();
        var path = d.File("a.ndjson", "{\"id\":1,\"name\":\"علی\",\"p\":1.5}\n\n{\"id\":2,\"name\":\"x\\ny\",\"p\":2}\n");
        var (cols, rows) = Read.All(path, new SourceOptions { Format = "ndjson" });
        Assert.Equal(["id", "name", "p"], cols);
        Assert.Equal("علی", rows[0][1]);
        Assert.Equal(1.5m, rows[0][2]);
        Assert.Equal("x\ny", rows[1][1]);
        Assert.Equal(2L, rows[1][2]);
    }

    [Fact]
    public void Json_array_of_scalars_and_arrays()
    {
        using var d = new TempDir();
        var (cols, rows) = Read.All(d.File("a.json", "[1,2,3]"), new SourceOptions { Format = "json" });
        Assert.Equal(["value"], cols);
        Assert.Equal(3, rows.Count);
        var (cols2, rows2) = Read.All(d.File("b.json", "[[1,\"a\"],[2,\"b\"]]"), new SourceOptions { Format = "json" });
        Assert.Equal(["Column1", "Column2"], cols2);
        Assert.Equal("b", rows2[1][1]);
    }

    [Fact]
    public void Large_json_array_streams()
    {
        using var d = new TempDir();
        var path = d.Combine("big.json");
        using (var w = new StreamWriter(path))
        {
            w.Write("[");
            for (var i = 0; i < 50_000; i++) w.Write((i > 0 ? "," : "") + $"{{\"id\":{i},\"s\":\"v\\\"{i}\"}}");
            w.Write("]");
        }
        var o = RowSources.Resolve(path, new SourceOptions { Format = "json" });
        using var src = RowSources.Open(path, o);
        long n = 0;
        while (src.Read()) n++;
        Assert.Equal(50_000, n);
    }

    [Fact]
    public void Utf16_json_is_transcoded()
    {
        using var d = new TempDir();
        var (_, rows) = Read.All(d.File("a.json", "[{\"n\":\"é\"}]", new UnicodeEncoding(false, true), bom: true), new SourceOptions { Format = "json" });
        Assert.Equal("é", rows[0][0]);
    }
}

public class XlsxParserTests
{
    private static string Build(TempDir d, string sheetXml, string[]? shared = null, string styles = "", string extraSheets = "", bool date1904 = false)
    {
        var path = d.Combine("t.xlsx");
        using var fs = File.Create(path);
        using var zip = new ZipArchive(fs, ZipArchiveMode.Create);
        void Put(string name, string content)
        {
            var e = zip.CreateEntry(name);
            using var w = new StreamWriter(e.Open(), new UTF8Encoding(false));
            w.Write(content);
        }
        Put("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
        Put("xl/workbook.xml", $"""<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr{(date1904 ? " date1904=\"1\"" : "")}/><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>""");
        Put("xl/_rels/workbook.xml.rels", """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>""");
        Put("xl/worksheets/sheet1.xml", $"""<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{sheetXml}</sheetData></worksheet>""");
        Put("xl/worksheets/sheet2.xml", """<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>other</t></is></c></row><row r="2"><c r="A2"><v>7</v></c></row></sheetData></worksheet>""");
        if (shared is not null)
            Put("xl/sharedStrings.xml", "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" + string.Concat(shared.Select(s => $"<si><t xml:space=\"preserve\">{s}</t></si>")) + "</sst>");
        if (styles.Length > 0) Put("xl/styles.xml", styles);
        return path;
    }

    private const string Styles = """<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="0"/></cellXfs></styleSheet>""";

    [Fact]
    public void Shared_strings_numbers_booleans_inline_strings_and_gaps()
    {
        using var d = new TempDir();
        var path = Build(d,
            """<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>""" +
            """<row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2.5</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="inlineStr"><is><t>سلام</t></is></c></row>""" +
            """<row r="3"/><row r="4"><c r="A4"><v>3</v></c><c r="D4" t="str"><v>f</v></c></row>""",
            ["id", "amount", "note"]);
        var (cols, rows) = Read.All(path);
        Assert.Equal(["id", "amount", "Column3", "note"], cols);
        Assert.Equal(2, rows.Count);
        Assert.Equal(1L, rows[0][0]);
        Assert.Equal(2.5m, rows[0][1]);
        Assert.Equal(true, rows[0][2]);
        Assert.Equal("سلام", rows[0][3]);
        Assert.Equal(3L, rows[1][0]);
        Assert.Equal("f", rows[1][3]);
    }

    [Fact]
    public void Dates_use_the_cell_style_and_the_1900_system()
    {
        using var d = new TempDir();
        var path = Build(d, """<row r="1"><c r="A1" t="inlineStr"><is><t>d</t></is></c><c r="B1" t="inlineStr"><is><t>dt</t></is></c><c r="C1" t="inlineStr"><is><t>n</t></is></c></row>""" +
                            """<row r="2"><c r="A2" s="1"><v>45000</v></c><c r="B2" s="2"><v>45000.5</v></c><c r="C2" s="3"><v>45000</v></c></row>""", styles: Styles);
        var (_, rows) = Read.All(path);
        Assert.Equal(new DateTime(2023, 3, 15), rows[0][0]);
        Assert.Equal(new DateTime(2023, 3, 15, 12, 0, 0), rows[0][1]);
        Assert.Equal(45000L, rows[0][2]);
    }

    [Fact]
    public void Date_1904_system_and_serial_edge_cases()
    {
        Assert.Equal(new DateTime(2023, 3, 15), XlsxRowSource.SerialToValue(45000, false));
        Assert.Equal(new DateTime(1904, 1, 2), XlsxRowSource.SerialToValue(1, true));
        Assert.Equal(new DateTime(1900, 1, 1), XlsxRowSource.SerialToValue(1, false));
        Assert.Equal(new DateTime(1900, 3, 1), XlsxRowSource.SerialToValue(61, false));
        Assert.Equal(TimeSpan.FromHours(6), XlsxRowSource.SerialToValue(0.25, false));
        Assert.True(XlsxRowSource.IsDateFormat(14, null));
        Assert.True(XlsxRowSource.IsDateFormat(200, "[$-409]d-mmm-yy;@"));
        Assert.False(XlsxRowSource.IsDateFormat(200, "0.00\"d\""));
        Assert.False(XlsxRowSource.IsDateFormat(0, "General"));
    }

    [Fact]
    public void Sheet_picker_and_sheet_names_and_skip_rows()
    {
        using var d = new TempDir();
        var path = Build(d, """<row r="1"><c r="A1" t="inlineStr"><is><t>title junk</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>h</t></is></c></row><row r="3"><c r="A3"><v>9</v></c></row>""");
        Assert.Equal(["Data", "Second"], XlsxRowSource.SheetNames(path));
        var (cols, rows) = Read.All(path, new SourceOptions { Sheet = "Second" });
        Assert.Equal(["other"], cols);
        Assert.Equal(7L, rows[0][0]);
        var (cols2, rows2) = Read.All(path, new SourceOptions { SkipRows = 1 });
        Assert.Equal(["h"], cols2);
        Assert.Equal(9L, rows2[0][0]);
        Assert.Throws<ArgumentException>(() => Read.All(path, new SourceOptions { Sheet = "Nope" }));
    }

    [Fact]
    public void Round_trips_files_written_by_the_export_writer()
    {
        using var d = new TempDir();
        var path = d.Combine("w.xlsx");
        using (var fs = File.Create(path))
        {
            var cols = new[]
            {
                new DbStudio.Core.Models.ColumnInfo("id", 0, "int", "int", false), new DbStudio.Core.Models.ColumnInfo("name", 1, "nvarchar", "string", true),
                new DbStudio.Core.Models.ColumnInfo("price", 2, "decimal", "decimal", true), new DbStudio.Core.Models.ColumnInfo("created", 3, "datetime", "datetime", true),
            };
            var w = DbStudio.Core.Export.ExportFormats.Create("xlsx", fs, new DbStudio.Core.Export.ExportOptions(), DbStudio.Core.Models.Dialect.TSql);
            w.BeginAsync(cols, default).Wait();
            w.WriteRowAsync([1, "علی", "12.50", "2024-05-06T07:08:09"], default).Wait();
            w.WriteRowAsync([2, null, null, null], default).Wait();
            w.EndAsync(default).Wait();
            w.DisposeAsync().AsTask().Wait();
        }
        var (c, rows) = Read.All(path);
        Assert.Equal(["id", "name", "price", "created"], c);
        Assert.Equal(2, rows.Count);
        Assert.Equal("علی", rows[0][1]);
        Assert.Equal(1L, rows[0][0]);
    }

    [Fact]
    public void Non_xlsx_file_gives_a_clear_error()
    {
        using var d = new TempDir();
        var path = d.File("x.xlsx", "this is not a zip");
        var ex = Assert.Throws<InvalidDataException>(() => XlsxRowSource.SheetNames(path));
        Assert.Contains(".xlsx", ex.Message);
    }
}
