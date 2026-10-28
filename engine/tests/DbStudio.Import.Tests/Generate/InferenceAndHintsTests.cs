using DbStudio.Core.Models;
using DbStudio.Import.Generate;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;

namespace DbStudio.Import.Tests.Generate;

public sealed class GenerateInferenceTests
{
    private static readonly DateTime Now = new(2026, 1, 15, 8, 0, 0);

    private static GenerateColumn Infer(Dialect dialect, string table, string name, string type, bool nullable = true, bool pk = false, bool identity = false,
        bool computed = false, string? fk = null, bool unique = false, ColumnHint? hint = null, string? dflt = null)
    {
        var d = ImportDialect.For(dialect);
        var detail = new ColumnDetail(name, type, nullable, dflt, pk, identity, computed, null, 1);
        var kind = d.Classify(type, out var max);
        var tc = new TargetCol(name, kind, type, max, nullable, false, identity);
        return Inference.Infer(d, table, detail, tc, TypeBounds.Context(d, detail, tc), fk, unique, hint, Now);
    }

    [Theory]
    [InlineData("email", "varchar(255)", "email")]
    [InlineData("Email_Address", "text", "email")]
    [InlineData("first_name", "varchar(50)", "first_name")]
    [InlineData("LastName", "varchar(50)", "last_name")]
    [InlineData("phone", "varchar(30)", "phone")]
    [InlineData("city", "varchar(80)", "city")]
    [InlineData("country", "varchar(80)", "country")]
    [InlineData("company_name", "varchar(80)", "company")]
    [InlineData("website", "varchar(200)", "url")]
    [InlineData("zip", "varchar(10)", "postal_code")]
    [InlineData("address", "varchar(200)", "street_address")]
    [InlineData("job_title", "varchar(80)", "job_title")]
    [InlineData("notes", "text", "paragraph")]
    [InlineData("description", "varchar(120)", "sentence")]
    [InlineData("sku", "varchar(20)", "pattern")]
    [InlineData("status", "varchar(20)", "list")]
    public void Text_columns_are_chosen_by_name(string name, string type, string generator)
    {
        var c = Infer(Dialect.PgSql, "things", name, type);
        Assert.Equal(generator, c.Generator);
        Assert.Equal("text", c.Kind);
    }

    [Fact]
    public void Plain_name_depends_on_the_table()
    {
        Assert.Equal("full_name", Infer(Dialect.PgSql, "customers", "name", "varchar(80)").Generator);
        Assert.Equal("company", Infer(Dialect.PgSql, "suppliers", "name", "varchar(80)").Generator);
        Assert.Equal("title", Infer(Dialect.PgSql, "products", "name", "varchar(80)").Generator);
        Assert.Equal("city", Infer(Dialect.PgSql, "cities", "name", "varchar(80)").Generator);
    }

    [Fact]
    public void Long_text_generators_shrink_to_short_columns()
    {
        Assert.Equal("paragraph", Infer(Dialect.PgSql, "t", "body", "text").Generator);
        Assert.Equal("sentence", Infer(Dialect.PgSql, "t", "comment", "varchar(120)").Generator);
        Assert.Equal("title", Infer(Dialect.PgSql, "t", "comment", "varchar(30)").Generator);
        Assert.Equal("word", Infer(Dialect.PgSql, "t", "comment", "varchar(10)").Generator);
    }

    [Fact]
    public void Key_columns_get_sequences_and_codes()
    {
        var id = Infer(Dialect.PgSql, "t", "id", "integer", nullable: false, pk: true, unique: true);
        Assert.Equal("sequence", id.Generator);
        Assert.Equal("auto", id.Options["start"]);
        Assert.True(id.Unique);
        Assert.Equal(0, id.NullPercent);
        Assert.Equal("sequence", Infer(Dialect.TSql, "t", "no", "bigint", nullable: false, pk: true).Generator);
        var code = Infer(Dialect.PgSql, "t", "token_key", "varchar(8)", nullable: false, pk: true);
        Assert.Equal("pattern", code.Generator);
        Assert.Matches(@"^\[A-Z0-9\]\{8\}$", code.Options["pattern"]!);
        Assert.Equal("uuid", Infer(Dialect.PgSql, "t", "id", "uuid", nullable: false, pk: true).Generator);
    }

    [Fact]
    public void Identity_computed_and_foreign_key_columns()
    {
        var identity = Infer(Dialect.TSql, "t", "id", "int", nullable: false, pk: true, identity: true);
        Assert.Equal("skip", identity.Generator);
        Assert.Contains("Identity", identity.Note);
        Assert.Equal("skip", Infer(Dialect.PgSql, "t", "total", "numeric(10,2)", computed: true).Generator);
        var fk = Infer(Dialect.PgSql, "orders", "customer_id", "integer", nullable: false, fk: "fk_cust");
        Assert.Equal("foreignKey", fk.Generator);
        Assert.Equal("fk_cust", fk.ForeignKey);
        Assert.Equal(0, fk.NullPercent);
    }

    [Fact]
    public void Keys_numbered_by_a_sequence_default_are_left_to_the_database()
    {
        var serial = Infer(Dialect.PgSql, "t", "id", "integer", nullable: false, pk: true, dflt: "nextval('t_id_seq'::regclass)");
        Assert.Equal("skip", serial.Generator);
        Assert.Contains("sequence", serial.Note);
        Assert.Equal("skip", Infer(Dialect.PlSql, "t", "ID", "NUMBER(10)", nullable: false, pk: true, dflt: "\"SHOP\".\"T_SEQ\".nextval").Generator);
        // a plain constant default on a key is not a counter
        Assert.Equal("sequence", Infer(Dialect.PgSql, "t", "id", "integer", nullable: false, pk: true, dflt: "0").Generator);
        // a default on an ordinary column is just a default: values are still generated
        Assert.Equal("int", Infer(Dialect.PgSql, "t", "age", "integer", dflt: "18").Generator);
    }

    [Fact]
    public void Nullable_ordinary_columns_get_a_small_null_share()
    {
        Assert.Equal(5, Infer(Dialect.PgSql, "t", "nickname", "varchar(20)", nullable: true).NullPercent);
        Assert.Equal(0, Infer(Dialect.PgSql, "t", "nickname", "varchar(20)", nullable: false).NullPercent);
    }

    [Fact]
    public void Numbers_follow_name_and_type_bounds()
    {
        var age = Infer(Dialect.PgSql, "t", "age", "integer");
        Assert.Equal(("int", "18", "80"), (age.Generator, age.Options["min"], age.Options["max"]));
        var price = Infer(Dialect.PgSql, "t", "unit_price", "numeric(10,2)");
        Assert.Equal("decimal", price.Generator);
        Assert.Equal("2", price.Options["decimals"]);
        Assert.Equal("500", price.Options["max"]);
        // numeric(4,2) cannot hold 500: the range is cut to 99.99
        var small = Infer(Dialect.PgSql, "t", "price", "numeric(4,2)");
        Assert.Equal("99.99", small.Options["max"]);
        // SQL Server tinyint is 0..255, MySQL tinyint is -128..127
        Assert.Equal("100", Infer(Dialect.TSql, "t", "qty", "tinyint").Options["max"]);
        var tiny = Infer(Dialect.MySql, "t", "level", "tinyint");
        Assert.Equal("127", tiny.Options["max"]);
        Assert.Equal("255", Infer(Dialect.MySql, "t", "level", "tinyint unsigned").Options["max"]);
        Assert.Equal("32767", Infer(Dialect.PgSql, "t", "weirdcol", "smallint").Options["max"]);
        Assert.Equal("100000", Infer(Dialect.PgSql, "t", "weirdcol", "bigint").Options["max"]);
        Assert.Equal("1000", Infer(Dialect.PgSql, "t", "owner_id", "integer").Options["max"]);
        Assert.Equal("99", Infer(Dialect.PlSql, "t", "weirdcol", "NUMBER(2)").Options["max"]);
        Assert.Equal("double precision", Infer(Dialect.PgSql, "t", "latitude", "double precision").Type);
        Assert.Equal("decimal", Infer(Dialect.PgSql, "t", "latitude", "double precision").Generator);
    }

    [Fact]
    public void Booleans_dates_and_other_kinds()
    {
        Assert.Equal("85", Infer(Dialect.PgSql, "t", "is_active", "boolean").Options["trueP"]);
        Assert.Equal("5", Infer(Dialect.PgSql, "t", "is_deleted", "boolean").Options["trueP"]);
        Assert.Equal("50", Infer(Dialect.PgSql, "t", "flag", "boolean").Options["trueP"]);
        Assert.Equal("bool", Infer(Dialect.TSql, "t", "flag", "bit").Generator);

        var created = Infer(Dialect.PgSql, "t", "created_at", "timestamp without time zone");
        Assert.Equal("datetime", created.Generator);
        Assert.Equal("2024-01-15", created.Options["from"]);
        Assert.Equal("2026-01-15", created.Options["to"]);
        var birth = Infer(Dialect.PgSql, "t", "birth_date", "date");
        Assert.Equal("date", birth.Generator);
        Assert.Equal("1950-01-01", birth.Options["from"]);
        Assert.Equal("2008-01-15", birth.Options["to"]);
        Assert.Equal("2027-01-15", Infer(Dialect.PgSql, "t", "expires_at", "date").Options["to"]);
        Assert.Equal("date", Infer(Dialect.TSql, "t", "order_date", "datetime2").Generator);

        Assert.Equal("time", Infer(Dialect.PgSql, "t", "opens", "time").Generator);
        Assert.Equal("uuid", Infer(Dialect.TSql, "t", "ref", "uniqueidentifier").Generator);
        Assert.Equal("binary", Infer(Dialect.TSql, "t", "blob", "varbinary(max)").Generator);
        Assert.Equal("json", Infer(Dialect.PgSql, "t", "payload", "jsonb").Generator);
        Assert.Equal("constant", Infer(Dialect.TSql, "t", "doc", "xml").Generator);
    }

    [Fact]
    public void Mysql_enum_values_become_a_list()
    {
        var c = Infer(Dialect.MySql, "t", "size", "enum('small','it''s big','large')");
        Assert.Equal("list", c.Generator);
        Assert.Equal("small\nit's big\nlarge", c.Options["values"]);
    }

    [Fact]
    public void Constraint_hints_override_names_and_narrow_ranges()
    {
        var list = Infer(Dialect.PgSql, "t", "email", "text", hint: new ColumnHint(Values: ["a@x", "b@x"]));
        Assert.Equal("list", list.Generator);
        Assert.Equal("a@x\nb@x", list.Options["values"]);
        var age = Infer(Dialect.PgSql, "t", "age", "integer", hint: new ColumnHint(Min: 21, Max: 65));
        Assert.Equal(("21", "65"), (age.Options["min"], age.Options["max"]));
        var exclusive = Infer(Dialect.PgSql, "t", "qty", "integer", hint: new ColumnHint(Min: 0, MinExclusive: true));
        Assert.Equal("1", exclusive.Options["min"]);
        var num = Infer(Dialect.PgSql, "t", "weirdcol", "integer", hint: new ColumnHint(Values: ["1", "2", "3"]));
        Assert.Equal("list", num.Generator);
    }

    [Fact]
    public void Every_inferred_generator_can_be_created()
    {
        // Whatever the inference picks must run with the options it sets (the dialog starts from these).
        var cases = new (Dialect, string, string)[]
        {
            (Dialect.PgSql, "email", "text"), (Dialect.PgSql, "age", "integer"), (Dialect.PgSql, "price", "numeric(10,2)"), (Dialect.PgSql, "created_at", "timestamptz"),
            (Dialect.TSql, "flag", "bit"), (Dialect.TSql, "birth", "date"), (Dialect.TSql, "uid", "uniqueidentifier"), (Dialect.MySql, "size", "enum('a','b')"),
            (Dialect.PgSql, "sku", "varchar(12)"), (Dialect.PgSql, "payload", "json"), (Dialect.PgSql, "blob", "bytea"), (Dialect.PlSql, "qty", "NUMBER(5)"),
            (Dialect.Sqlite, "title", "TEXT"), (Dialect.PgSql, "rating", "numeric(3,1)"), (Dialect.PgSql, "latitude", "real"),
        };
        foreach (var (dialect, name, type) in cases)
        {
            var d = ImportDialect.For(dialect);
            var detail = new ColumnDetail(name, type, true, null, false, false, false, null, 1);
            var kind = d.Classify(type, out var max);
            var tc = new TargetCol(name, kind, type, max, true, false, false);
            var cc = TypeBounds.Context(d, detail, tc);
            var col = Inference.Infer(d, "things", detail, tc, cc, null, false, null, Now);
            var gen = GeneratorCatalog.Create(col.Generator, new GenArgs(col.Options, cc, 1, Now));
            var rng = new Rng(1);
            for (var i = 0; i < 20; i++) Assert.NotNull(gen.Next(rng, i));
        }
    }
}

public sealed class CheckHintsTests
{
    private static readonly string[] Cols = ["status", "age", "qty", "grade", "price"];

    [Fact]
    public void Postgres_any_array_with_casts()
    {
        var h = CheckHints.Parse("CHECK (((status)::text = ANY ((ARRAY['new'::character varying, 'paid'::character varying, 'void'::character varying])::text[])))", Cols);
        Assert.Equal(["new", "paid", "void"], h["status"].Values);
        h = CheckHints.Parse("CHECK ((status = ANY (ARRAY['a'::text, 'b'::text])))", Cols);
        Assert.Equal(["a", "b"], h["status"].Values);
    }

    [Fact]
    public void Postgres_ranges()
    {
        var h = CheckHints.Parse("CHECK (((age >= 18) AND (age <= 65)))", Cols);
        Assert.Equal((18m, 65m, false, false), (h["age"].Min, h["age"].Max, h["age"].MinExclusive, h["age"].MaxExclusive));
        h = CheckHints.Parse("CHECK ((qty > 0))", Cols);
        Assert.Equal((0m, true), (h["qty"].Min, h["qty"].MinExclusive));
        Assert.Null(h["qty"].Max);
        h = CheckHints.Parse("CHECK ((price >= (0)::numeric))", Cols);
        Assert.Equal(0m, h["price"].Min);
    }

    [Fact]
    public void SqlServer_definitions()
    {
        var h = CheckHints.Parse("([status]='new' OR [status]='paid' OR [status]='void')", Cols);
        Assert.Equal(["new", "paid", "void"], h["status"].Values);
        h = CheckHints.Parse("([age]>=(18) AND [age]<=(65))", Cols);
        Assert.Equal((18m, 65m), (h["age"].Min, h["age"].Max));
        h = CheckHints.Parse("([qty]>(0))", Cols);
        Assert.Equal(0m, h["qty"].Min);
        h = CheckHints.Parse("([status] IN (N'a',N'b'))", Cols);
        Assert.Equal(["a", "b"], h["status"].Values);
    }

    [Fact]
    public void MySql_and_Oracle_definitions()
    {
        var h = CheckHints.Parse("(`status` in (_utf8mb4'a',_utf8mb4'b'))", Cols);
        Assert.Equal(["a", "b"], h["status"].Values);
        h = CheckHints.Parse("`age` between 1 and 99", Cols);
        Assert.Equal((1m, 99m), (h["age"].Min, h["age"].Max));
        h = CheckHints.Parse("status IN ('A','B')", Cols);
        Assert.Equal(["A", "B"], h["status"].Values);
        h = CheckHints.Parse("\"GRADE\" BETWEEN 1 AND 5", Cols);
        Assert.Equal((1m, 5m), (h["grade"].Min, h["grade"].Max));
    }

    [Fact]
    public void Numeric_lists_and_quoted_values()
    {
        var h = CheckHints.Parse("grade IN (1, 2, 3)", Cols);
        Assert.Equal(["1", "2", "3"], h["grade"].Values);
        h = CheckHints.Parse("status IN ('it''s', 'ok, fine')", Cols);
        Assert.Equal(["it's", "ok, fine"], h["status"].Values);
    }

    [Fact]
    public void Things_it_cannot_express_are_ignored()
    {
        Assert.Empty(CheckHints.Parse("status = 'a' OR age > 5", Cols));            // two columns joined by OR
        Assert.Empty(CheckHints.Parse("age >= 18 OR age = -1", Cols));              // not a plain range
        Assert.Empty(CheckHints.Parse("unknown IN ('a','b')", Cols));               // not a column of the table
        Assert.Empty(CheckHints.Parse("length(status) > 3", Cols));
        Assert.Empty(CheckHints.Parse("", Cols));
        Assert.Empty(CheckHints.Parse("age > price", Cols));
    }

    [Fact]
    public void Sqlite_check_bodies_are_extracted_with_balanced_parentheses()
    {
        const string sql = "CREATE TABLE t (id INTEGER PRIMARY KEY, status TEXT CHECK (status IN ('new','paid')), age INT, CHECK (age >= 0 AND (age < 150)))";
        var bodies = CheckHints.SqliteChecks(sql).ToList();
        Assert.Equal(2, bodies.Count);
        Assert.Equal("status IN ('new','paid')", bodies[0]);
        Assert.Equal("age >= 0 AND (age < 150)", bodies[1]);
        var h = CheckHints.Parse(bodies[1], Cols);
        Assert.Equal((0m, 150m, true), (h["age"].Min, h["age"].Max, h["age"].MaxExclusive));
    }
}
