using System.Text.Json.Nodes;
using DbStudio.Federation.Builder;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Tests.WpB;

/// <summary>SQL → builder model: the subset parses (and compiles back to the same statement), everything else gives null + a reason.</summary>
public sealed class BuilderParserTests
{
    private static readonly BuilderCatalog Shop = BuilderGoldenTests.Load("b-001-select-star-limit.json").Catalog;

    private static Task<ParseResult> Parse(string sql, BuilderCatalog? catalog = null) =>
        BuilderParser.ParseAsync(sql, catalog ?? Shop, BuilderGoldenTests.Serialize, CancellationToken.None);

    [Theory]
    [InlineData("WITH q AS (SELECT 1) SELECT * FROM q", "WITH")]
    [InlineData("SELECT * FROM crm.customers UNION SELECT * FROM crm.customers", "UNION")]
    [InlineData("SELECT * FROM (SELECT 1) AS s", "Subqueries")]
    [InlineData("SELECT * FROM crm.customers WHERE id IN (SELECT customer_id FROM shop.orders)", "Subqueries")]
    [InlineData("SELECT row_number() OVER () FROM crm.customers", "Window")]
    [InlineData("SELECT * FROM crm.customers c JOIN shop.orders o USING (id)", "USING")]
    [InlineData("SELECT * FROM crm.customers NATURAL JOIN shop.orders", "NATURAL")]
    [InlineData("SELECT * FROM crm.customers c SEMI JOIN shop.orders o ON o.customer_id = c.id", "SEMI")]
    [InlineData("SELECT * FROM crm.customers WHERE id = $fp1", "parameters")]
    [InlineData("SELECT 1; SELECT 2", "one statement")]
    [InlineData("SELECT country FROM crm.customers GROUP BY ROLLUP (country)", "ROLLUP")]
    [InlineData("INSERT INTO crm.customers VALUES (1)", "SELECT")]
    [InlineData("SELECT * FROM crm.customers c JOIN shop.orders o ON o.customer_id > c.id + 1", "Join conditions")]
    [InlineData("SELECT * FROM crm.customers c JOIN shop.orders o ON o.customer_id = c.id OR o.id = c.id", "Join conditions")]
    [InlineData("SELECT * FROM crm.customers c JOIN shop.orders o ON lower(o.status) = c.name", "wrapping")]
    [InlineData("SELECT * FROM crm.customers WHERE length(name) > 3", "filter")]
    [InlineData("SELECT * FROM crm.customers c JOIN shop.orders o ON o.customer_id = c.id WHERE c.name = o.status", "filter")]
    [InlineData("SELECT sum(id) / count(*) AS avg_id FROM crm.customers", "aggregate")]
    [InlineData("SELECT name FROM crm.customers ORDER BY length(name)", "ORDER BY")]
    [InlineData("SELECT DISTINCT ON (name) name FROM crm.customers", "DISTINCT ON")]
    [InlineData("SELECT * FROM crm.customers WHERE name = NULL", "NULL")]
    [InlineData("SELECT * FROM crm.customers WHERE name LIKE 'a%b'", "filter")]
    [InlineData("SELECT * FROM crm.customers LIMIT 10 PERCENT", "PERCENT")]
    [InlineData("SELECT * FROM crm.customers QUALIFY id > 1", "QUALIFY")]
    [InlineData("SELECT * FROM range(10)", "Table functions")]
    [InlineData("SELECT 1", "no FROM")]
    [InlineData("SELECT * FROM", "does not parse")]
    [InlineData("   ", "empty")]
    public async Task Returns_null_for_SQL_outside_the_builder(string sql, string reasonPart)
    {
        var r = await Parse(sql);
        Assert.Null(r.Model);
        Assert.NotNull(r.Reason);
        Assert.Contains(reasonPart, r.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Hand_written_query_becomes_a_builder_model()
    {
        var r = await Parse("""
            select c.name, count(*) as n, sum(o.total) total
            from crm.customers c
            join shop.orders o on o.customer_id = c.id
            where o.status = 'paid' and o.total > 100 and c.name ilike '%ann%'
            group by c.name
            having count(*) >= 2
            order by n desc, 1
            limit 10 offset 5
            """);
        var m = Assert.IsType<BuilderModel>(r.Model);
        Assert.Equal(["c", "o"], m.Tables.Select(t => t.As));
        Assert.Equal(("crm", "customers"), (m.Tables[0].Alias, m.Tables[0].Table));
        var j = Assert.Single(m.Joins);
        Assert.Equal((BuilderJoinTypes.Inner, "t1", "t2"), (j.Type, j.Left, j.Right));
        var on = Assert.Single(j.On);
        Assert.Equal(("id", "customer_id", "="), (on.LeftColumn, on.RightColumn, on.Op)); // mirrored onto the earlier table
        Assert.Equal(3, m.Columns.Count);
        Assert.Equal((BuilderAggregates.Count, "n"), (m.Columns[1].Agg, m.Columns[1].Alias));
        Assert.Equal((BuilderAggregates.Sum, "t2", "total", "total"), (m.Columns[2].Agg, m.Columns[2].TableId, m.Columns[2].Column, m.Columns[2].Alias));
        Assert.True(m.AutoGroup);
        var where = m.Filter!.Items!;
        Assert.Equal(("t2.status", "eq", true), (where[0].Column, where[0].Op, where[0].CaseSensitive == true));
        Assert.Equal(("t2.total", "gt"), (where[1].Column, where[1].Op));
        Assert.Equal(100L, where[1].Values![0]!.GetValue<long>());
        Assert.Equal(("t1.name", "contains", "ann"), (where[2].Column, where[2].Op, where[2].Values![0]!.GetValue<string>()));
        Assert.Null(where[2].CaseSensitive);
        Assert.Equal(("c2", "gte"), (m.Having!.Items![0].Column, m.Having.Items[0].Op));
        Assert.Equal(["c2", "c1"], m.Sort.Select(s => s.Ref.ColumnId));
        Assert.Equal(["desc", "asc"], m.Sort.Select(s => s.Dir));
        Assert.Equal((10L, 5L), (m.Limit, m.Offset));

        var sql = BuilderCompiler.Compile(m, Shop).Sql;
        Assert.Equal("""
            SELECT c.name, count(*) AS n, sum(o.total) AS total
            FROM crm.customers AS c
            INNER JOIN shop.orders AS o ON c.id = o.customer_id
            WHERE o.status = $fp1 AND o.total > $fp2 AND c.name ILIKE '%' || $fp3 || '%' ESCAPE '\'
            GROUP BY c.name
            HAVING count(*) >= $fp4
            ORDER BY n DESC, c.name ASC
            LIMIT 10 OFFSET 5
            """.ReplaceLineEndings("\n"), sql);
    }

    [Fact]
    public async Task Calculated_columns_keep_the_users_text()
    {
        var r = await Parse("SELECT (o.total * 1.2)::DECIMAL(10,2) AS gross, upper( o.status ), sum(o.total - 1) AS net FROM shop.orders o GROUP BY ALL");
        var m = Assert.IsType<BuilderModel>(r.Model);
        Assert.Equal("(o.total * 1.2)::DECIMAL(10,2)", m.Columns[0].Expr);
        Assert.Equal("gross", m.Columns[0].Alias);
        Assert.Equal("upper( o.status )", m.Columns[1].Expr);
        Assert.Null(m.Columns[1].Alias);
        Assert.Equal(("o.total - 1", BuilderAggregates.Sum), (m.Columns[2].Expr, m.Columns[2].Agg));
        Assert.True(m.AutoGroup);
        Assert.Equal("SELECT (o.total * 1.2)::DECIMAL(10,2) AS gross, upper( o.status ), sum(o.total - 1) AS net\nFROM shop.orders AS o\nGROUP BY (o.total * 1.2)::DECIMAL(10,2), upper( o.status )",
            BuilderCompiler.Compile(m, Shop).Sql);
    }

    [Fact]
    public async Task Unqualified_columns_resolve_through_the_catalog_and_unaliased_tables_get_their_name()
    {
        var r = await Parse("SELECT name, status FROM crm.customers JOIN shop.orders ON customer_id = customers.id WHERE status IN ('a', 'b') ORDER BY name");
        var m = Assert.IsType<BuilderModel>(r.Model);
        Assert.Equal(["customers", "orders"], m.Tables.Select(t => t.As));
        Assert.Equal(("t1", "name"), (m.Columns[0].TableId, m.Columns[0].Column));
        Assert.Equal(("t2.status", "in", true), (m.Filter!.Items![0].Column, m.Filter.Items[0].Op, m.Filter.Items[0].CaseSensitive == true));
        Assert.Equal("c1", m.Sort[0].Ref.ColumnId);
    }

    [Fact]
    public async Task Ambiguous_bare_column_is_refused()
    {
        var r = await Parse("SELECT id FROM crm.customers c JOIN shop.orders o ON o.customer_id = c.id");
        Assert.Null(r.Model);
    }

    [Fact]
    public async Task Outer_joins_with_options_and_cross_join_parse()
    {
        var r = await Parse("""
            SELECT * FROM crm.customers c
            LEFT JOIN shop.orders o ON lower(trim(c.name)) = lower(trim(o.status)) AND o.customer_id = c.id
            CROSS JOIN shop."Order Lines" l
            FULL OUTER JOIN shop.orders o2 ON o2.id <= o.id
            """);
        var m = Assert.IsType<BuilderModel>(r.Model);
        Assert.Empty(m.Columns);
        Assert.Equal([BuilderJoinTypes.Left, BuilderJoinTypes.Cross, BuilderJoinTypes.Full], m.Joins.Select(j => j.Type));
        Assert.True(m.Joins[0].On[0].IgnoreCase && m.Joins[0].On[0].Trim);
        Assert.Equal("Order Lines", m.Tables[2].Table);
        Assert.Equal(("t2", "id", ">="), (m.Joins[2].Left, m.Joins[2].On[0].LeftColumn, m.Joins[2].On[0].Op));
    }

    [Fact]
    public async Task Date_and_time_literals_become_exact_filters()
    {
        var r = await Parse("SELECT * FROM shop.orders WHERE ordered = DATE '2024-01-05' AND ship_time < '10:30' AND shipped_at BETWEEN '2024-01-01' AND '2024-01-31 23:59:59'");
        var m = Assert.IsType<BuilderModel>(r.Model);
        var items = m.Filter!.Items!;
        Assert.Equal(("eq", "2024-01-05T00:00:00"), (items[0].Op, items[0].Values![0]!.GetValue<string>()));
        Assert.Equal(("before", "10:30:00"), (items[1].Op, items[1].Values![0]!.GetValue<string>()));
        Assert.Equal("between", items[2].Op);
        var c = BuilderCompiler.Compile(m, Shop);
        Assert.Equal("SELECT *\nFROM shop.orders AS orders\nWHERE orders.ordered = $fp1 AND orders.ship_time < $fp2 AND orders.shipped_at BETWEEN $fp3 AND $fp4", c.Sql);
        Assert.Equal(["datetime", "time", "datetime", "datetime"], c.Params.Select(p => p.Kind));
    }

    [Fact]
    public async Task Not_like_and_boolean_forms()
    {
        var r = await Parse("SELECT * FROM shop.orders o WHERE o.status NOT ILIKE '%x\\_y%' ESCAPE '\\' AND NOT (o.ref IS NULL OR o.ref = '') AND o.status LIKE 'A%'");
        var m = Assert.IsType<BuilderModel>(r.Model);
        var items = m.Filter!.Items!;
        Assert.Equal(("notContains", "x_y"), (items[0].Op, items[0].Values![0]!.GetValue<string>()));
        Assert.Equal(("group", true, "or"), (items[1].Kind, items[1].Negate == true, items[1].Logic));
        Assert.Equal(["isNull", "isEmpty"], items[1].Items!.Select(i => i.Op));
        Assert.Equal(("startsWith", true), (items[2].Op, items[2].CaseSensitive == true));
    }

    [Fact]
    public async Task Works_without_a_catalog_for_qualified_references()
    {
        var r = await Parse("SELECT o.status, count(*) FROM shop.orders o WHERE o.total >= 10 GROUP BY o.status", BuilderCatalog.Empty);
        var m = Assert.IsType<BuilderModel>(r.Model);
        Assert.Equal("t1.total", m.Filter!.Items![0].Column);
        Assert.Equal(JsonValue.Create(10L).ToJsonString(), m.Filter.Items[0].Values![0]!.ToJsonString());
    }
}
