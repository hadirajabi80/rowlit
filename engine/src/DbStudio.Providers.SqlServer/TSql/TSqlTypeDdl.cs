using System.Text;

namespace DbStudio.Providers.SqlServer.TSql;

/// <summary>
/// CREATE TYPE / CREATE XML SCHEMA COLLECTION scripts for the user-defined types of SQL Server (SSMS: Programmability ›
/// Types). Table types cannot name their constraints, so keys, checks and defaults are written unnamed (like SSMS does).
/// </summary>
public static class TSqlTypeDdl
{
    /// <summary>Alias type: <c>CREATE TYPE dbo.Phone FROM nvarchar(20) NOT NULL</c>.</summary>
    public static string AliasType(string qualifiedName, string baseTypeText, bool nullable) =>
        $"CREATE TYPE {qualifiedName} FROM {baseTypeText}{(nullable ? " NULL" : " NOT NULL")};\n";

    /// <summary>CLR type: <c>CREATE TYPE dbo.Point EXTERNAL NAME [Geo].[Ns.Point]</c>.</summary>
    public static string ClrType(string qualifiedName, string assembly, string assemblyClass) =>
        $"CREATE TYPE {qualifiedName}\nEXTERNAL NAME {SqlServerNames.Quote(assembly)}.{SqlServerNames.Quote(assemblyClass)};\n";

    /// <summary>Table type with its columns, primary key / unique constraints, checks and inline indexes.</summary>
    public static string TableType(string qualifiedName, IReadOnlyList<SqlServerColumnDefinition> columns,
        IReadOnlyList<SqlServerIndexDefinition> indexes, IReadOnlyList<SqlServerCheckDefinition> checks)
    {
        var lines = new List<string>();
        foreach (var c in columns) lines.Add(TSqlDdlGenerator.ColumnLine(c, named: false));
        foreach (var ix in indexes.Where(i => i.IsPrimaryKey || i.IsUniqueConstraint))
        {
            var kind = ix.IsPrimaryKey ? "PRIMARY KEY" : "UNIQUE";
            lines.Add($"{kind} {TSqlDdlGenerator.Clustering(ix.TypeDesc)}({TSqlDdlGenerator.KeyList(ix.KeyColumns)})");
        }
        foreach (var ck in checks) lines.Add($"CHECK {ck.Definition}");
        foreach (var ix in indexes.Where(i => !i.IsPrimaryKey && !i.IsUniqueConstraint))
            lines.Add($"INDEX {SqlServerNames.Quote(ix.Name)} {TSqlDdlGenerator.Clustering(ix.TypeDesc)}({TSqlDdlGenerator.KeyList(ix.KeyColumns)})");

        var sb = new StringBuilder();
        sb.Append("CREATE TYPE ").Append(qualifiedName).Append(" AS TABLE (\n");
        for (var i = 0; i < lines.Count; i++) sb.Append("    ").Append(lines[i]).Append(i < lines.Count - 1 ? ",\n" : "\n");
        sb.Append(");\n");
        return sb.ToString();
    }

    /// <summary>XML schema collection: the schema documents of every target namespace in one literal.</summary>
    public static string XmlSchemaCollection(string qualifiedName, IEnumerable<string> schemaDocuments)
    {
        var docs = string.Concat(schemaDocuments);
        return $"CREATE XML SCHEMA COLLECTION {qualifiedName} AS {SqlServerNames.Literal(docs)};\n";
    }
}
