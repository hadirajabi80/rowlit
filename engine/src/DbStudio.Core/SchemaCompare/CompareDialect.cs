using DbStudio.Core.Models;

namespace DbStudio.Core.SchemaCompare;

/// <summary>Per-dialect statement builders of the schema compare (drops, qualified names).</summary>
internal static class CompareDialect
{
    public static string Quote(Dialect d, string name) => DialectInfo.QuoteIdentifier(d, name);

    public static string Qualify(Dialect d, string? schema, string name) =>
        string.IsNullOrEmpty(schema) ? Quote(d, name) : Quote(d, schema) + "." + Quote(d, name);

    public static string DropTable(Dialect d, string schema, string name) =>
        $"DROP TABLE {Qualify(d, schema, name)}" + (d == Dialect.PlSql ? " CASCADE CONSTRAINTS" : "");

    /// <summary>DROP statement of a view, routine, package, trigger, sequence or type.</summary>
    public static string Drop(Dialect d, string schema, DbObject obj, string kind)
    {
        var word = kind switch
        {
            CompareKinds.View => "VIEW", CompareKinds.Proc => "PROCEDURE", CompareKinds.Func => "FUNCTION", CompareKinds.Trigger => "TRIGGER",
            CompareKinds.Sequence => "SEQUENCE", CompareKinds.Type => "TYPE", CompareKinds.Package => "PACKAGE", _ => "TABLE",
        };
        var paren = obj.Name.IndexOf('(');
        var baseName = d == Dialect.PgSql && paren > 0 ? obj.Name[..paren] : obj.Name;
        var signature = d == Dialect.PgSql && paren > 0 && kind is CompareKinds.Proc or CompareKinds.Func ? obj.Name[paren..] : "";
        if (d == Dialect.PgSql && kind == CompareKinds.Trigger && obj.OnTable is { } table)
            return $"DROP TRIGGER {Quote(d, baseName)} ON {Qualify(d, schema, table)}";
        return $"DROP {word} {Qualify(d, schema, baseName)}{signature}";
    }
}
