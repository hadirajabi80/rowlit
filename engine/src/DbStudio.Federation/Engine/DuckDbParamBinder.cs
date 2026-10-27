using System.Data.Common;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Services;
using DbStudio.Core.Sql;
using DbStudio.Federation.Contracts;
using DuckDB.NET.Data;

namespace DbStudio.Federation.Engine;

/// <summary>
/// Parameter binding of link SQL (DuckDB): <c>$name</c> (the builder's <c>$fp1</c>…), <c>$1</c> and <c>?</c>, found with
/// the DuckDB lexer so strings, comments and <c>$$…$$</c> bodies are skipped. Values are the request params converted
/// with <see cref="ParamValues.ToClr"/>; DuckDB infers each parameter's type from where it is used.
/// </summary>
internal sealed class DuckDbParamBinder : ParamBinderBase
{
    public static readonly DuckDbParamBinder Instance = new();

    public override string ProviderId => LinkIds.ProviderId;

    public override IReadOnlyList<ParamPlaceholder> FindPlaceholders(string sql)
    {
        var list = new List<ParamPlaceholder>();
        foreach (var t in SqlTokenizer.Tokenize(sql, Dialect.DuckDb))
        {
            if (t.Kind != SqlTokenKind.Parameter || t.Value.Length == 0) continue;
            if (t.Value == "?") list.Add(new ParamPlaceholder(null, t.Start));
            else if (t.Value[0] == '$' && t.Value.Length > 1) list.Add(new ParamPlaceholder(t.Value[1..], t.Start));
        }
        return list;
    }

    protected override DbParameter CreateParameter(DbCommand command, QueryParam p, string? placeholderName)
    {
        if (p.IsOutput)
            throw EngineException.Validation($"Parameter '{p.BareName}': linked databases have no OUT parameters.", new { field = "params", name = p.BareName });
        if (p.Kind == ParamKinds.RefCursor)
            throw EngineException.Validation($"Parameter '{p.BareName}': linked databases have no REF CURSOR parameters.", new { field = "params", name = p.BareName });
        // An exact big number goes as its text: DuckDB casts the value to the type it infers for the parameter.
        var value = ParamValues.ToClr(p) switch { null => DBNull.Value, ExactDecimal exact => exact.Text, var v => v };
        return placeholderName is null ? new DuckDBParameter { Value = value } : new DuckDBParameter(placeholderName, value);
    }
}
