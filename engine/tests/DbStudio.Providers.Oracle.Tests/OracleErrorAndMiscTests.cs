using DbStudio.Core.Models;
using Oracle.ManagedDataAccess.Types;

namespace DbStudio.Providers.Oracle.Tests;

/// <summary>Oracle QA round: value text helpers that need no server.</summary>
public sealed class OracleValueTextTests
{
    [Theory]
    [InlineData(2026, 1, 1, 10, 20, 30, 123456789, "2026-01-01T10:20:30.123456789")]
    [InlineData(2026, 1, 1, 10, 20, 30, 500000000, "2026-01-01T10:20:30.5")]
    [InlineData(2026, 1, 1, 10, 20, 30, 120000, "2026-01-01T10:20:30.00012")]
    [InlineData(2026, 12, 31, 0, 0, 0, 0, "2026-12-31T00:00:00")]
    public void TimestampText_KeepsNanosecondsAndTrimsTrailingZeros(int y, int mo, int d, int h, int mi, int s, int ns, string expected) =>
        Assert.Equal(expected, OracleSession.TimestampText(y, mo, d, h, mi, s, ns));

    [Fact]
    public void NanosecondTimestampText_StillParsesAsADateTimeParam()
    {
        // The grid sends a displayed TIMESTAMP(9) value back as a datetime parameter: nine digits must not fail validation.
        var p = new DbStudio.Core.Params.QueryParam("ts", "datetime", System.Text.Json.Nodes.JsonValue.Create("2026-01-01T10:20:30.123456789"));
        DbStudio.Core.Params.ParamValues.Validate([p]);
        var parsed = Assert.IsType<DateTime>(DbStudio.Core.Params.ParamValues.ToClr(p));
        Assert.InRange((parsed - new DateTime(2026, 1, 1, 10, 20, 30)).Ticks, 1234567, 1234568); // .NET keeps 100 ns
    }

    [Fact]
    public void VectorText_UsesInvariantShortestRoundTrip()
    {
        Assert.Equal("[1,2.5,-3]", OracleSession.VectorText(new float[] { 1f, 2.5f, -3f }));
        Assert.Equal("[0.1,1E-05]", OracleSession.VectorText(new double[] { 0.1, 0.00001 }));
        Assert.Equal("[1,-2,3]", OracleSession.VectorText(new sbyte[] { 1, -2, 3 }));
        Assert.Equal("[]", OracleSession.VectorText(Array.Empty<float>()));
    }
}

public sealed class OracleErrorMappingTests
{
    private static ErrorInfo Map(int number, string message, string batchSql, int line = 1, int col = 1)
    {
        var batch = new SqlBatch(batchSql, line, col);
        var (sql, offset) = OracleSqlText.Prepare(batchSql);
        return OracleErrors.Map(number, message, batch, sql, offset, OracleSqlText.RewriteExec(batchSql.Trim()) is not null);
    }

    [Fact]
    public void Code_IsFiveDigitOra() => Assert.Equal("ORA-00942", OracleErrors.Code(942));

    [Fact]
    public void InvalidIdentifier_PointsAtFirstOccurrence()
    {
        var e = Map(904, "ORA-00904: \"NO_SUCH_COL\": invalid identifier", "SELECT ID,\n       no_such_col\nFROM CUSTOMERS", 5);
        Assert.Equal(("ORA-00904", 6, 8), (e.Code, e.Line, e.Col));
        Assert.Equal(904, e.ProviderCode);
    }

    [Fact]
    public void TableNotFound_23aiMessage_UsesLastQuotedPart()
    {
        var e = Map(942, "ORA-00942: table or view \"SHOP\".\"NO_SUCH_TABLE_XYZ\" does not exist\nhttps://docs.oracle.com/error-help/db/ora-00942/",
            "\n-- comment\nSELECT * FROM no_such_table_xyz", 10);
        Assert.Equal((12, 15), (e.Line, e.Col));
        Assert.Equal("ORA-00942: table or view \"SHOP\".\"NO_SUCH_TABLE_XYZ\" does not exist", e.Message);
        Assert.Equal("https://docs.oracle.com/error-help/db/ora-00942/", e.Detail);
    }

    [Fact]
    public void UnknownPosition_FallsBackToFirstToken()
    {
        var e = Map(942, "ORA-00942: table or view does not exist", "\n-- comment\nSELECT * FROM nope", 10, 1);
        Assert.Equal((12, 1), (e.Line, e.Col));
    }

    [Fact]
    public void PlSqlLineColumn_IsMappedRelativeToBlock()
    {
        var e = Map(6550, "ORA-06550: line 2, column 3:\nPLS-00201: identifier 'NO_SUCH_PROC_XYZ' must be declared\nORA-06550: line 2, column 3:\nPL/SQL: Statement ignored",
            "BEGIN\n  no_such_proc_xyz;\nEND;", 20);
        Assert.Equal((21, 3), (e.Line, e.Col));
    }

    [Fact]
    public void PlSqlLineColumn_OnFirstLine_AddsBatchColumn()
    {
        var e = Map(6550, "ORA-06550: line 1, column 7:\nPLS-00201: identifier 'X' must be declared", "  BEGIN x; END;", 3, 5);
        // Block starts at batch offset 2 → document column 5 + 2; error column 7 within the block.
        Assert.Equal((3, 5 + 2 + 7 - 1), (e.Line, e.Col));
    }

    [Fact]
    public void RewrittenExec_DoesNotMapPlSqlPositions()
    {
        var e = Map(6550, "ORA-06550: line 1, column 7:\nPLS-00201: identifier 'NOPE' must be declared", "EXEC nope", 4);
        Assert.Equal(4, e.Line);
    }

    [Fact]
    public void RuntimeErrorInAnonymousBlock_PointsAtTheFailingLine()
    {
        // RAISE_APPLICATION_ERROR / NO_DATA_FOUND: only "ORA-06512: at line N" tells where (QA round: it used to point at BEGIN).
        var e = Map(20001, "ORA-20001: boom\nORA-06512: at line 4\nhttps://docs.oracle.com/error-help/db/ora-20001/",
            "BEGIN\n  DBMS_OUTPUT.PUT_LINE('before');\n  NULL;\n    RAISE_APPLICATION_ERROR(-20001, 'boom');\nEND;", 10);
        Assert.Equal((13, 5), (e.Line, e.Col));
    }

    [Fact]
    public void RuntimeErrorInStoredUnit_UsesTheOutermostAnonymousFrame()
    {
        var e = Map(1403, "ORA-01403: no data found\nORA-06512: at \"SHOP.P\", line 7\nORA-06512: at line 2",
            "BEGIN\n  p;\nEND;", 1);
        Assert.Equal((2, 3), (e.Line, e.Col));
        // only named frames: no anonymous line to map, the statement start is used
        var f = Map(1403, "ORA-01403: no data found\nORA-06512: at \"SHOP.P\", line 7", "CALL p()", 3);
        Assert.Equal((3, 1), (f.Line, f.Col));
        Assert.Null(OracleErrors.AnonymousBlockLine("ORA-06512: at \"SHOP.P\", line 7"));
    }

    [Fact]
    public void RuntimeErrorFrame_OnRewrittenExec_IsNotMapped()
    {
        var e = Map(20001, "ORA-20001: x\nORA-06512: at line 1", "EXEC p", 6);
        Assert.Equal(6, e.Line);
    }

    [Theory]
    [InlineData(1, 6, 10, 1, 10, 6)]   // error on source line 1: column relative to the PROCEDURE keyword (offset 18)
    [InlineData(4, 1, 10, 1, 13, 1)]
    [InlineData(0, 0, 10, 1, 10, 19)]  // views report line 0: keyword position
    public void CompileErrors_MapToDocument(int errLine, int errCol, int batchLine, int batchCol, int expectedLine, int expectedCol)
    {
        const string sql = "CREATE OR REPLACE PROCEDURE ZZ AS\nBEGIN\n  NULL\nEND;";
        var unit = OracleSqlText.FindCreatedUnit(sql)!;
        var (line, col) = OracleErrors.MapCompileError(new SqlBatch(sql, batchLine, batchCol), unit.SourceOffset, errLine, errCol);
        Assert.Equal((expectedLine, errLine == 1 ? 18 + errCol : expectedCol), (line, col));
    }

    [Fact]
    public void CompileErrors_KeywordOnSecondLine()
    {
        const string sql = "CREATE OR REPLACE\n  PACKAGE BODY api AS\n  x NUMBER\nEND;";
        var unit = OracleSqlText.FindCreatedUnit(sql)!;
        Assert.Equal("PACKAGE BODY", unit.ObjectType);
        // ALL_SOURCE line 1 = "PACKAGE BODY api AS" on document line 6 (batch line 2), column 3.
        Assert.Equal((6, 3 + 5 - 1), OracleErrors.MapCompileError(new SqlBatch(sql, 5, 1), unit.SourceOffset, 1, 5));
        Assert.Equal((7, 11), OracleErrors.MapCompileError(new SqlBatch(sql, 5, 1), unit.SourceOffset, 2, 11));
    }

    [Theory]
    [InlineData("PLS-00103: Encountered the symbol \"END\"", "PLS-00103")]
    [InlineData("  ORA-00942: table or view does not exist", "ORA-00942")]
    [InlineData("PLW-06002: Unreachable code", "PLW-06002")]
    [InlineData("Some text", null)]
    public void LeadingCode(string text, string? expected) => Assert.Equal(expected, OracleErrors.LeadingCodeOf(text));

    [Fact]
    public void ProviderError_ForArgumentException()
    {
        var e = OracleProvider.ToProviderError(new ArgumentException("Host is required."));
        Assert.Equal(("PROVIDER_ERROR", "Host is required."), (e.Code, e.Message));
    }
}

public sealed class DbmsOutputTests
{
    [Fact]
    public void Lines_TakeOnlyReportedCount_AndMapNulls()
    {
        var array = new OracleString[] { new("a"), OracleString.Null, new("c"), new("stale") };
        Assert.Equal(new[] { "a", "", "c" }, OracleSession.DbmsOutputLines(array, 3));
    }

    [Fact]
    public void Lines_FromStringArray() => Assert.Equal(new[] { "x", "" }, OracleSession.DbmsOutputLines(new string?[] { "x", null }, 5));

    [Fact]
    public void Lines_NotAnArray_IsEmpty() => Assert.Empty(OracleSession.DbmsOutputLines(null, 10));
}

public sealed class OracleDdlGeneratorTests
{
    [Fact]
    public void GeneratesTable_WithKeysIndexesComments()
    {
        var details = new ObjectDetails(
            new ObjectRef(null, "SHOP", "ORDERS", ObjectTypes.Table),
            [
                new ColumnDetail("ID", "NUMBER(10)", false, null, true, true, false, null, 1),
                new ColumnDetail("CUSTOMER_ID", "NUMBER(10)", false, null, false, false, false, "Owner", 2),
                new ColumnDetail("STATUS", "VARCHAR2(10)", true, "'NEW'", false, false, false, null, 3),
                new ColumnDetail("TOTAL_TAX", "NUMBER", true, "TOTAL*0.19", false, false, true, null, 4),
            ],
            [new IndexDetail("PK_ORDERS", true, ["ID"], "NORMAL", true), new IndexDetail("IX_ORDERS_CUSTOMER", false, ["CUSTOMER_ID"], "NORMAL")],
            [new ForeignKeyRef("FK_ORDERS_CUSTOMERS", ["CUSTOMER_ID"], "SHOP", "CUSTOMERS", ["ID"])],
            [], [], [], null, null, null);
        var ddl = new OracleDdlGenerator().GenerateTableDdl(details.Ref, details);
        Assert.StartsWith("CREATE TABLE \"SHOP\".\"ORDERS\" (\n", ddl);
        Assert.Contains("\"ID\" NUMBER(10) GENERATED BY DEFAULT AS IDENTITY NOT NULL", ddl);
        Assert.Contains("\"STATUS\" VARCHAR2(10) DEFAULT 'NEW'", ddl);
        Assert.Contains("\"TOTAL_TAX\" NUMBER GENERATED ALWAYS AS (TOTAL*0.19) VIRTUAL", ddl);
        Assert.Contains("CONSTRAINT \"PK_ORDERS\" PRIMARY KEY (\"ID\")", ddl);
        Assert.Contains("CONSTRAINT \"FK_ORDERS_CUSTOMERS\" FOREIGN KEY (\"CUSTOMER_ID\") REFERENCES \"SHOP\".\"CUSTOMERS\" (\"ID\")", ddl);
        Assert.Contains("CREATE INDEX \"SHOP\".\"IX_ORDERS_CUSTOMER\" ON \"SHOP\".\"ORDERS\" (\"CUSTOMER_ID\");", ddl);
        Assert.DoesNotContain("INDEX \"SHOP\".\"PK_ORDERS\"", ddl);
        Assert.Contains("COMMENT ON COLUMN \"SHOP\".\"ORDERS\".\"CUSTOMER_ID\" IS 'Owner';", ddl);
    }
}

public sealed class OracleSeedScriptTests
{
    [Fact]
    public void SeedScript_SplitsIntoTerminatedStatements()
    {
        var statements = OracleBackend.SeedStatements();
        Assert.True(statements.Count >= 20, $"Only {statements.Count} statements.");
        Assert.Equal("ALTER SESSION SET CONTAINER", string.Join(" ", OracleSqlText.Tokenize(statements[0].Sql).Take(4).Select(t => t.Text)));
        foreach (var s in statements)
        {
            var (sql, _) = OracleSqlText.Prepare(s.Sql);
            Assert.False(string.IsNullOrWhiteSpace(sql));
            Assert.Empty(OracleSqlText.FindBindVariables(sql));
            // SQL statements carry no ';' (SQL*Plus would run them twice with the '/'); PL/SQL units keep theirs.
            if (!OracleSqlText.IsPlSql(s.Sql)) Assert.False(s.Sql.TrimEnd().EndsWith(';'), s.Sql);
        }
        var created = statements.Select(s => OracleSqlText.FindCreatedUnit(s.Sql)).Where(u => u is not null).Select(u => $"{u!.ObjectType} {u.Name}").ToList();
        foreach (var expected in new[] { "PACKAGE ORDER_API", "PACKAGE BODY ORDER_API", "PROCEDURE PRINT_CUSTOMER", "PROCEDURE CUSTOMER_REPORT", "FUNCTION FN_TAX", "VIEW CUSTOMER_ORDERS" })
            Assert.Contains(expected, created);
        // Line numbers point at the statement's first line in the file.
        var lines = File.ReadAllLines(OracleBackend.SeedScriptPath);
        Assert.All(statements, s => Assert.Equal(s.Sql.Split('\n')[0], lines[s.Line - 1]));
    }
}

public sealed class OracleUnreadableValueTests
{
    private const string Ora50071 =
        "ORA-50071: Custom type mapping for 'dataSource='(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=LOCALHOST)(PORT=1521)))' schemaName='SHOP' typeName='OBJ_T'' is not specified or is invalid";

    [Fact]
    public void ObjectTypeColumn_Ora50071_IsAnUnreadableCell_NotAFailedQuery()
    {
        // GetValue of a user-defined type column throws this InvalidOperationException; it must degrade to a placeholder.
        Assert.True(OracleSession.IsUnreadableValue(new InvalidOperationException(Ora50071)));
    }

    [Fact]
    public void OtherErrors_StillFailTheQuery()
    {
        Assert.False(OracleSession.IsUnreadableValue(new InvalidOperationException("Operation is not valid due to the current state of the object.")));
        Assert.False(OracleSession.IsUnreadableValue(new InvalidCastException(Ora50071)));
        Assert.False(OracleSession.IsUnreadableValue(new TimeoutException("ORA-50071")));
    }

    [Fact]
    public void Placeholder_NamesTheType()
    {
        Assert.Equal("(Object)", OracleSession.UnreadableValueText("Object"));
        Assert.Equal("(unsupported type)", OracleSession.UnreadableValueText(null));
        Assert.Equal("(unsupported type)", OracleSession.UnreadableValueText(" "));
    }
}
