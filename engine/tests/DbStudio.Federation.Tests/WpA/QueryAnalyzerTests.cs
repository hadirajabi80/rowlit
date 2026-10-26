using DbStudio.Federation.Contracts;
using DbStudio.Federation.Pushdown;

namespace DbStudio.Federation.Tests.WpA;

/// <summary>Analyzer fixtures: projection, predicates, outer-join safety, limits, fallbacks (DuckDB's real parser).</summary>
public sealed class QueryAnalyzerTests
{
    [Fact]
    public void Projection_is_the_referenced_columns_and_predicates_push()
    {
        var a = Cat.Analyze("""
            select c.name, sum(o.total) as t
            from crm.customers c join shop.orders o on o.customer_id = c.id and o.status = 'paid'
            where c.country_id in (1, 2) and o.total between 1 and 5.5 and c.name like 'A%' and c.email is not null and c.id <> 3
            group by c.name
            """);
        Assert.True(a.Parsed);
        var c = a.T("crm.customers");
        Assert.Equal(["id", "name", "email", "country_id"], c.Columns);
        Assert.Equal("country_id in int:1,int:2 AND name like string:A% AND email isNotNull AND id <> int:3", c.Preds());
        var o = a.T("shop.orders");
        Assert.Equal(["customer_id", "total", "status"], o.Columns);
        Assert.Equal("status = string:paid AND total between int:1,decimal:5.5", o.Preds());
        Assert.Null(c.Limit);
        Assert.Single(a.JoinPairs);
    }

    [Fact]
    public void Star_needs_whole_tables_and_count_star_the_first_key()
    {
        var a = Cat.Analyze("select * from crm.countries");
        Assert.True(a.T("crm.countries").AllColumns);
        Assert.Equal(["id", "name"], a.T("crm.countries").Columns);

        var b = Cat.Analyze("select count(*) from shop.orders");
        Assert.Equal(["id"], b.T("shop.orders").Columns);

        var c = Cat.Analyze("select o.*, c.name from shop.orders o join crm.customers c on c.id = o.customer_id");
        Assert.True(c.T("shop.orders").AllColumns);
        Assert.False(c.T("crm.customers").AllColumns);
        Assert.Equal(["id", "name"], c.T("crm.customers").Columns);
    }

    [Fact]
    public void Unqualified_names_are_attributed_to_every_table_that_has_them()
    {
        // "name" exists in customers and countries: both fetch it (DuckDB decides which one binds).
        var a = Cat.Analyze("select name from crm.customers join crm.countries on countries.id = customers.country_id");
        Assert.Contains("name", a.T("crm.customers").Columns);
        Assert.Contains("name", a.T("crm.countries").Columns);
    }

    [Fact]
    public void Default_schema_resolves_unqualified_tables()
    {
        var a = Cat.Analyze("select name from customers where id = 1");
        Assert.Equal("id = int:1", a.T("crm.customers").Preds());
    }

    [Fact]
    public void Left_join_pushes_on_predicates_of_the_right_side_only()
    {
        var a = Cat.Analyze("select * from crm.customers c left join shop.orders o on o.customer_id = c.id and o.status = 'paid' and c.active = true");
        Assert.Equal("status = string:paid", a.T("shop.orders").Preds());
        Assert.Equal("", a.T("crm.customers").Preds()); // c.active in the ON of a LEFT JOIN keeps unmatched rows
    }

    [Fact]
    public void Right_join_pushes_on_predicates_of_the_left_side_only()
    {
        var a = Cat.Analyze("select * from crm.customers c right join shop.orders o on o.customer_id = c.id and o.status = 'paid' and c.active = true");
        Assert.Equal("", a.T("shop.orders").Preds());
        Assert.Equal("active = bool:true", a.T("crm.customers").Preds());
    }

    [Fact]
    public void Full_join_pushes_no_on_predicate()
    {
        var a = Cat.Analyze("select * from crm.customers c full join shop.orders o on o.customer_id = c.id and o.status = 'paid' and c.id > 2");
        Assert.Equal("", a.T("shop.orders").Preds());
        Assert.Equal("", a.T("crm.customers").Preds());
    }

    [Fact]
    public void Where_predicates_push_to_both_sides_of_an_outer_join_because_they_reject_nulls()
    {
        var a = Cat.Analyze("select * from crm.customers c left join shop.orders o on o.customer_id = c.id where o.total > 100 and c.id < 5");
        Assert.Equal("total > int:100", a.T("shop.orders").Preds());
        Assert.Equal("id < int:5", a.T("crm.customers").Preds());
    }

    [Fact]
    public void Null_accepting_and_complex_predicates_never_push()
    {
        var a = Cat.Analyze("""
            select * from crm.customers c left join shop.orders o on o.customer_id = c.id
            where o.id is null or c.id = 1
            """);
        Assert.Equal("", a.T("shop.orders").Preds());
        Assert.Equal("", a.T("crm.customers").Preds());

        var b = Cat.Analyze("select * from crm.customers where email is null and not (id in (1, 2)) and lower(name) = 'x' and id::varchar = '1' and name not like 'a%' and name ilike 'b'");
        Assert.Equal("", b.T("crm.customers").Preds());
        // DuckDB's parser itself turns NOT (a = b) into a <> b, which is exact for numbers
        Assert.Equal("id <> int:1", Cat.Analyze("select * from crm.customers where not (id = 1)").T("crm.customers").Preds());
    }

    [Fact]
    public void Parameters_do_not_push()
    {
        var a = Cat.Analyze("select * from crm.customers where id = $id and name = 'x'");
        Assert.Equal("name = string:x", a.T("crm.customers").Preds());
    }

    [Fact]
    public void String_ranges_and_inequality_do_not_push_but_numbers_do()
    {
        var a = Cat.Analyze("select * from crm.customers where name <> 'x' and name > 'b' and name in ('a','b') and id >= 2 and 10 > id");
        Assert.Equal("name in string:a,string:b AND id >= int:2 AND id < int:10", a.T("crm.customers").Preds());
    }

    [Fact]
    public void Typed_literals_push_for_dates_guids_and_bools()
    {
        var a = Cat.Analyze("""
            select * from crm.customers
            where created >= DATE '2024-01-01' and created < TIMESTAMP '2024-02-01 10:30:00' and birthday = '1990-05-04'
              and uid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' and active = true
            """);
        Assert.Equal("created >= datetime:2024-01-01T00:00:00 AND created < datetime:2024-02-01T10:30:00 AND birthday = date:1990-05-04 " +
                     "AND uid = guid:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 AND active = bool:true", a.T("crm.customers").Preds());
    }

    [Fact]
    public void A_table_read_twice_gets_only_the_common_predicates()
    {
        var a = Cat.Analyze("""
            select * from crm.customers a join crm.customers b on b.id = a.id
            where a.country_id = 1 and b.country_id = 1 and a.name = 'x'
            """);
        Assert.Equal("country_id = int:1", a.T("crm.customers").Preds());

        var sub = Cat.Analyze("select * from crm.customers where id in (select customer_id from shop.orders where total > 5) and id = 1");
        Assert.Equal("id = int:1", sub.T("crm.customers").Preds());
        Assert.Equal("total > int:5", sub.T("shop.orders").Preds());
    }

    [Fact]
    public void Ctes_and_derived_tables_are_their_own_scopes()
    {
        var a = Cat.Analyze("""
            with big as (select customer_id, total from shop.orders where total > 100)
            select c.name, b.total from crm.customers c join big b on b.customer_id = c.id where c.id = 2
            """);
        Assert.Equal("total > int:100", a.T("shop.orders").Preds());
        Assert.Equal("id = int:2", a.T("crm.customers").Preds());
        Assert.Equal(["customer_id", "total"], a.T("shop.orders").Columns.Order().ToList());

        var d = Cat.Analyze("select x.name from (select * from crm.customers where active = true) x where x.id = 1");
        Assert.Equal("active = bool:true", d.T("crm.customers").Preds());
        Assert.True(d.T("crm.customers").AllColumns);
    }

    [Fact]
    public void Limit_pushes_only_for_simple_single_table_queries()
    {
        Assert.Equal(10, Cat.Analyze("select id, name from crm.customers where country_id = 1 limit 10").T("crm.customers").Limit);
        Assert.Equal(15, Cat.Analyze("select * from crm.customers limit 10 offset 5").T("crm.customers").Limit);
        Assert.Null(Cat.Analyze("select * from crm.customers order by name limit 10").T("crm.customers").Limit);
        Assert.Null(Cat.Analyze("select distinct name from crm.customers limit 10").T("crm.customers").Limit);
        Assert.Null(Cat.Analyze("select count(*) from crm.customers limit 10").T("crm.customers").Limit);
        Assert.Null(Cat.Analyze("select * from crm.customers where lower(name) = 'a' limit 10").T("crm.customers").Limit);
        Assert.Null(Cat.Analyze("select * from crm.customers c join crm.countries k on k.id = c.country_id limit 10").T("crm.customers").Limit);
        Assert.Null(Cat.Analyze("select row_number() over () from crm.customers limit 10").T("crm.customers").Limit);
        Assert.True(Cat.Analyze("select * from crm.customers limit 3").LimitWithoutOrder);
        Assert.False(Cat.Analyze("select * from crm.customers order by id limit 3").LimitWithoutOrder);
    }

    [Fact]
    public void Natural_join_and_positional_join_read_whole_tables_without_predicates()
    {
        var n = Cat.Analyze("select * from crm.customers natural join crm.countries where customers.id = 1");
        Assert.True(n.T("crm.countries").AllColumns);
        var p = Cat.Analyze("select c.id from crm.customers c positional join shop.orders o where c.id = 1");
        Assert.Equal("", p.T("crm.customers").Preds());
    }

    [Fact]
    public void Using_columns_are_projected()
    {
        var a = Cat.Analyze("select count(*) from shop.orders join shop.lines on lines.order_id = orders.id join crm.customers using (id)");
        Assert.Contains("id", a.T("crm.customers").Columns);
    }

    [Fact]
    public void Statements_the_parser_cannot_serialize_fall_back_to_whole_tables()
    {
        // DESCRIBE / SUMMARIZE serialize as a SHOW_REF over the table: whole table, nothing pushed.
        var a = Cat.Analyze("DESCRIBE crm.customers");
        Assert.True(a.T("crm.customers").AllColumns);
        Assert.Empty(a.T("crm.customers").Predicates);
        Assert.True(Cat.Analyze("SUMMARIZE crm.customers").T("crm.customers").AllColumns);

        // PIVOT cannot be serialized: text fallback.
        var p = Cat.Analyze("PIVOT shop.orders ON status USING sum(total)");
        Assert.False(p.Parsed);
        Assert.NotNull(p.FallbackReason);
        Assert.True(p.T("shop.orders").AllColumns);
        Assert.Empty(p.T("shop.orders").Predicates);
    }

    [Fact]
    public void Syntax_errors_fetch_nothing()
    {
        var a = Cat.Analyze("selec * frm crm.customers");
        Assert.False(a.Parsed);
        Assert.NotNull(a.SyntaxError);
        Assert.Empty(a.Tables);
    }

    [Fact]
    public void Unknown_tables_and_ctes_are_ignored()
    {
        var a = Cat.Analyze("with customers as (select 1 as id) select * from customers, crm.nope");
        Assert.Empty(a.Tables);
    }

    [Fact]
    public void Row_struct_reference_fetches_the_whole_table()
    {
        var a = Cat.Analyze("select c from crm.customers c");
        Assert.True(a.T("crm.customers").AllColumns);
    }

    [Fact]
    public void Decimal_literals_keep_their_scale()
    {
        Assert.Equal("-2.25", QueryAnalyzer.FormatDecimal(-225, 2));
        Assert.Equal("0.05", QueryAnalyzer.FormatDecimal(5, 2));
        Assert.Equal("120.50", QueryAnalyzer.FormatDecimal(12050, 2));
        var a = Cat.Analyze("select * from shop.orders where total = 120.50 and total > -0.5");
        Assert.Equal("total = decimal:120.50 AND total > decimal:-0.5", a.T("shop.orders").Preds());
    }
}
