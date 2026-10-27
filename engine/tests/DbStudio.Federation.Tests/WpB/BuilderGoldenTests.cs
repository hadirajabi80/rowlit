using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Params;
using DbStudio.Core.Services;
using DbStudio.Federation.Builder;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Diagnostics;

namespace DbStudio.Federation.Tests.WpB;

/// <summary>
/// The shared builder goldens (Goldens/Builder/*.json: b-* by WP-B, c-* by WP-C) through the engine compiler, and the
/// parse round trip: inline the params into the compiled SQL, parse it back, compile again → same SQL and params.
/// </summary>
public sealed class BuilderGoldenTests
{
    internal static readonly DateTime FixedNow = new(2024, 6, 15, 12, 0, 0, DateTimeKind.Unspecified);

    internal sealed record Golden(string File, string Name, BuilderCatalog Catalog, BuilderModel Model, string Sql, JsonArray Params, IReadOnlyList<string> Warnings)
    {
        public override string ToString() => File;
    }

    internal static string Dir => Path.Combine(AppContext.BaseDirectory, "Goldens", "Builder");

    internal static Golden Load(string file)
    {
        var root = JsonNode.Parse(File.ReadAllText(Path.Combine(Dir, file)))!.AsObject();
        var catalog = new Dictionary<string, IReadOnlyList<BuilderCatalogColumn>>();
        foreach (var (key, cols) in root["catalog"]!.AsObject())
            catalog[key] = cols!.AsArray().Select(c => new BuilderCatalogColumn((string)c!["name"]!, (string)c["kind"]!, (string?)c["type"])).ToList();
        var model = root["model"].Deserialize<BuilderModel>(CoreJson.Options)!;
        var warnings = root["warnings"]?.AsArray().Select(w => w is JsonObject o ? (string)o["code"]! : (string)w!).ToList() ?? [];
        var paths = root["paths"]?.AsObject().ToDictionary(kv => kv.Key, kv => (IReadOnlyList<string>)kv.Value!.AsArray().Select(x => (string)x!).ToList());
        return new Golden(file, (string)root["name"]!, new BuilderCatalog(catalog, paths), model, (string)root["sql"]!, root["params"]!.AsArray(), warnings);
    }

    public static TheoryData<string> Files()
    {
        var data = new TheoryData<string>();
        foreach (var f in Directory.GetFiles(Dir, "*.json").Select(Path.GetFileName).Order(StringComparer.Ordinal)) data.Add(f!);
        return data;
    }

    internal static JsonArray ParamsJson(IReadOnlyList<QueryParam> ps) =>
        new(ps.Select(p => (JsonNode)new JsonObject { ["name"] = p.Name, ["kind"] = p.Kind, ["value"] = p.Value?.DeepClone() }).ToArray());

    [Theory]
    [MemberData(nameof(Files))]
    public void Compiles_to_the_golden_sql(string file)
    {
        var g = Load(file);
        var result = BuilderCompiler.Compile(g.Model, g.Catalog, FixedNow);
        if (Environment.GetEnvironmentVariable("GOLDEN_WRITE") == "1" && file.StartsWith("b-", StringComparison.Ordinal) && g.Sql.Length == 0)
        {
            var path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Goldens", "Builder", file);
            var root = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
            root["sql"] = result.Sql;
            root["params"] = ParamsJson(result.Params);
            root["warnings"] = new JsonArray(result.Warnings.Select(w => (JsonNode)JsonValue.Create(w.Code)!).ToArray());
            File.WriteAllText(path, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }) + "\n");
            return;
        }
        Assert.Equal(g.Sql, result.Sql);
        Assert.True(JsonNode.DeepEquals(g.Params, ParamsJson(result.Params)), $"params: expected {g.Params.ToJsonString()} got {ParamsJson(result.Params).ToJsonString()}");
        Assert.Equal(g.Warnings.Order(StringComparer.Ordinal), result.Warnings.Select(w => w.Code).Order(StringComparer.Ordinal));
    }

    [Theory]
    [MemberData(nameof(Files))]
    public async Task Parse_of_the_inlined_sql_compiles_back_to_the_same_statement(string file)
    {
        var g = Load(file);
        var first = BuilderCompiler.Compile(g.Model, g.Catalog, FixedNow);
        var inlined = Inline.Sql(first.Sql, first.Params);
        var parsed = await BuilderParser.ParseAsync(inlined, g.Catalog, Serialize, CancellationToken.None);
        Assert.True(parsed.Model is not null, $"{file}: {parsed.Reason}\n{inlined}");
        var second = BuilderCompiler.Compile(parsed.Model!, g.Catalog, FixedNow);
        // Same statement: DuckDB flattens nested ANDs, so "a AND (b AND c)" and "a AND b AND c" are the same tree.
        // four-part names (wide members) only parse in their engine spelling
        Assert.Equal(AstShape(g.Catalog.ToEngineNames(first.Sql)), AstShape(g.Catalog.ToEngineNames(second.Sql)));
        Assert.True(JsonNode.DeepEquals(ParamsJson(first.Params), ParamsJson(second.Params)),
            $"params: {ParamsJson(first.Params).ToJsonString()} vs {ParamsJson(second.Params).ToJsonString()}");
    }

    /// <summary>The DuckDB AST of a statement without source positions.</summary>
    internal static string AstShape(string sql)
    {
        var ast = DuckDbProbe.SerializeSql(sql);
        Assert.True(ast.Ok, ast.Error);
        return System.Text.RegularExpressions.Regex.Replace(ast.Json!, "\"query_location\":\\d+", "");
    }

    internal static Task<SqlAst> Serialize(string sql, CancellationToken ct) => Task.FromResult(DuckDbProbe.SerializeSql(sql));
}

/// <summary>C# twin of ui/src/filter/sql.ts inlineParams/literal for duckdb (what the UI shows in Advanced mode).</summary>
internal static class Inline
{
    public static string Sql(string sql, IReadOnlyList<QueryParam> ps)
    {
        var byName = ps.ToDictionary(p => p.Name, StringComparer.Ordinal);
        return System.Text.RegularExpressions.Regex.Replace(sql, @"(?<![\w$])\$([A-Za-z_]\w*)", m =>
            byName.TryGetValue(m.Groups[1].Value, out var p) ? Literal(p) : m.Value);
    }

    private static string Literal(QueryParam p)
    {
        var v = p.Value;
        if (v is null) return "NULL";
        var jv = v.AsValue();
        switch (jv.GetValueKind())
        {
            case JsonValueKind.True: return "TRUE";
            case JsonValueKind.False: return "FALSE";
            case JsonValueKind.Number: return jv.ToJsonString();
        }
        var s = jv.GetValue<string>();
        if (p.Kind is "int" or "float" or "decimal") return s;
        return "'" + s.Replace("'", "''", StringComparison.Ordinal) + "'";
    }
}
