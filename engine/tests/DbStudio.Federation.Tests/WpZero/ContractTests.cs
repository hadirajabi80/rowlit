using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Tests.WpZero;

/// <summary>WP0: the frozen contracts round-trip on the wire and the shared naming rules behave as documented.</summary>
public sealed class ContractTests
{
    private static LinkDefinition Sample() => new()
    {
        Members =
        [
            new LinkMember { Alias = "crm", ConnectionId = "c_1", Database = "crm", Schema = "dbo", Tables = [new MountedTable { Name = "Customers", As = "customers", Type = "table" }] },
            new LinkMember { Alias = "shop", ConnectionId = "c_2", Schema = "public", AllTables = true },
        ],
        Relations =
        [
            new VirtualRelation { Id = "r1", From = new("shop", "orders"), FromColumns = ["customer_id"], To = new("crm", "customers"), ToColumns = ["id"] },
        ],
        Options = new LinkOptions { MaxRowsPerSource = 1000 },
    };

    [Fact]
    public void Definition_round_trips_through_profile_props()
    {
        var profile = new ConnectionProfile { Id = "c_link", Name = "Sales", ProviderId = LinkIds.ProviderId, Props = new() { ["keep"] = "me" } };
        Sample().WriteTo(profile.Props);
        // as the connection store persists and reloads it
        var json = JsonSerializer.Serialize(profile, CoreJson.Options);
        var back = JsonSerializer.Deserialize<ConnectionProfile>(json, CoreJson.Options)!;
        var def = LinkDefinition.FromProfile(back);

        Assert.Equal("me", back.GetString("keep"));
        Assert.Equal(2, def.Members.Count);
        Assert.Equal("customers", def.Members[0].Tables[0].LinkName);
        Assert.True(def.Members[1].AllTables);
        Assert.Equal(LinkMemberKinds.Connection, def.Members[1].Kind);
        Assert.Equal(new LinkTableRef("crm", "customers"), def.Relations[0].To);
        Assert.Equal(1000, def.Options.MaxRowsPerSource);
        Assert.Same(def.Members[1], def.FindMember("SHOP"));
    }

    [Fact]
    public void Wire_names_are_camel_case()
    {
        var node = JsonSerializer.SerializeToNode(Sample(), CoreJson.Options)!.AsObject();
        var member = node["members"]![0]!.AsObject();
        Assert.Equal("c_1", member["connectionId"]!.GetValue<string>());
        Assert.Equal("customers", member["tables"]![0]!["as"]!.GetValue<string>());
        Assert.False(member["tables"]![0]!.AsObject().ContainsKey("linkName"));
        Assert.Equal("orders", node["relations"]![0]!["from"]!["table"]!.GetValue<string>());
    }

    [Fact]
    public void Empty_profile_gives_an_empty_definition()
    {
        var def = LinkDefinition.FromProfile(new ConnectionProfile { ProviderId = LinkIds.ProviderId });
        Assert.Empty(def.Members);
        Assert.Empty(def.Relations);
        Assert.Null(def.Options.Engine);
    }

    [Fact]
    public void Invalid_props_are_a_validation_error()
    {
        var p = new ConnectionProfile { Name = "x", ProviderId = LinkIds.ProviderId, Props = new() { [LinkProps.Members] = JsonValue.Create("nope") } };
        var e = Assert.Throws<EngineException>(() => LinkDefinition.FromProfile(p));
        Assert.Equal(ErrorCodes.Validation, e.Code);
    }

    [Theory]
    [InlineData("Sales DB (prod)", "sales_db_prod")]
    [InlineData("  CRM ", "crm")]
    [InlineData("2024 archive", "_2024_archive")]
    [InlineData("پایگاه", "db")]
    [InlineData("a--b__c", "a_b_c")]
    public void Slugify(string name, string expected) => Assert.Equal(expected, LinkRules.Slugify(name));

    [Fact]
    public void Aliases()
    {
        Assert.True(LinkRules.IsValidAlias("crm"));
        Assert.True(LinkRules.IsValidAlias("_2024"));
        Assert.False(LinkRules.IsValidAlias("Crm"));
        Assert.False(LinkRules.IsValidAlias("main"));
        Assert.False(LinkRules.IsValidAlias("views"));
        Assert.False(LinkRules.IsValidAlias("order"));
        Assert.False(LinkRules.IsValidAlias(new string('a', 64)));
        Assert.Equal("crm_2", LinkRules.UniqueAlias("crm", ["CRM"]));
        Assert.Equal("crm_3", LinkRules.UniqueAlias("crm", ["crm", "crm_2"]));
        Assert.Equal("main_2", LinkRules.UniqueAlias("main", []));
    }

    [Theory]
    [InlineData("customers", "customers")]
    [InlineData("Customers", "Customers")]
    [InlineData("order", "\"order\"")]
    [InlineData("first name", "\"first name\"")]
    [InlineData("a\"b", "\"a\"\"b\"")]
    [InlineData("1st", "\"1st\"")]
    public void Quoting(string name, string expected) => Assert.Equal(expected, LinkSql.QuoteIdent(name));

    [Fact]
    public void Dialect_wire_token()
    {
        Assert.Equal("duckdb", CoreJson.ToWire(Dialect.DuckDb));
        Assert.Equal(Dialect.DuckDb, CoreJson.ParseDialect("duckdb"));
        Assert.Equal("\"duckdb\"", JsonSerializer.Serialize(Dialect.DuckDb, CoreJson.Options));
        Assert.False(DialectInfo.HasDatabases(Dialect.DuckDb));
        Assert.False(DialectInfo.SchemaIsDatabase(Dialect.DuckDb));
        Assert.Equal("\"x\"", DialectInfo.QuoteIdentifier(Dialect.DuckDb, "x"));
    }

    [Fact]
    public void Seed_golden_is_a_builder_model()
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "Goldens", "Builder");
        var files = Directory.GetFiles(dir, "*.json");
        Assert.NotEmpty(files);
        foreach (var file in files)
        {
            var golden = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
            var model = golden["model"].Deserialize<BuilderModel>(CoreJson.Options)!;
            Assert.NotEmpty(model.Tables);
            Assert.False(string.IsNullOrEmpty(golden["sql"]?.GetValue<string>()), file);
            // every table and join in the golden is well formed
            Assert.All(model.Joins, j => Assert.Contains(j.Type, BuilderJoinTypes.All));
            Assert.All(model.Columns.Where(c => c.Agg is not null), c => Assert.Contains(c.Agg!, BuilderAggregates.All));
        }
    }

    [Fact]
    public void Builder_filter_wire_matches_the_ui_shape()
    {
        var json = """{"kind":"group","id":"g","logic":"or","items":[{"kind":"condition","id":"f","column":"t1.name","op":"in","values":["a",1,true,null],"caseSensitive":true}]}""";
        var node = JsonSerializer.Deserialize<BuilderFilterNode>(json, CoreJson.Options)!;
        Assert.Equal("or", node.Logic);
        var c = node.Items![0];
        Assert.Equal(("t1", "name"), BuilderRefs.ParseColumnKey(c.Column!));
        Assert.Equal(4, c.Values!.Count);
        Assert.Null(c.Values[3]);
    }

    [Fact]
    public void Settings_have_link_defaults()
    {
        var links = SettingsService.Defaults()["links"]!.AsObject();
        Assert.Equal(2_000_000, links["maxRowsPerSource"]!.GetValue<int>());
        Assert.Equal(0, links["memoryLimitMb"]!.GetValue<int>());
    }
}
