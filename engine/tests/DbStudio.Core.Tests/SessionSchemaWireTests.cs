using System.Text.Json;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Core.Tests;

/// <summary>Wire shape of the session's default schema (SessionInfo / session.changed) and the SQLite session's "none".</summary>
public sealed class SessionSchemaWireTests
{
    [Fact]
    public void SessionInfo_CarriesSchemaSearchPathAndMode()
    {
        var info = new SessionInfo("s1", "c1", new ServerInfo("17", null, null, null, "shop"), "shop", TransactionMode.Auto, false,
            SessionState.Idle, Dialect.PgSql, Schema: "sales", SearchPath: ["sales", "public"], SchemaMode: SchemaMode.Session);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(info, CoreJson.Options));
        Assert.Equal("sales", doc.RootElement.GetProperty("schema").GetString());
        Assert.Equal(["sales", "public"], doc.RootElement.GetProperty("searchPath").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal("session", doc.RootElement.GetProperty("schemaMode").GetString());
    }

    [Fact]
    public void SessionInfo_ReadOnlyAndNoneModes_AreCamelCase()
    {
        var ro = new SessionInfo("s1", "c1", new ServerInfo("16", null, null, null, "shop"), "shop", TransactionMode.Auto, false,
            SessionState.Idle, Dialect.TSql, Schema: "dbo", SchemaMode: SchemaMode.ReadOnly);
        using var a = JsonDocument.Parse(JsonSerializer.Serialize(ro, CoreJson.Options));
        Assert.Equal("readOnly", a.RootElement.GetProperty("schemaMode").GetString());
        var none = ro with { Schema = null, SchemaMode = SchemaMode.None };
        using var b = JsonDocument.Parse(JsonSerializer.Serialize(none, CoreJson.Options));
        Assert.Equal("none", b.RootElement.GetProperty("schemaMode").GetString());
    }

    [Fact]
    public void SessionChangedEvent_CarriesTheSchema()
    {
        var ev = new SessionChangedEvent("s1", SessionState.Idle, false, "shop", TransactionMode.Auto, "sales", ["sales", "public"]);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(ev, ev.GetType(), CoreJson.Options));
        Assert.Equal("sales", doc.RootElement.GetProperty("schema").GetString());
    }
}
