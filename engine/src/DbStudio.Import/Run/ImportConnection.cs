using System.Data.Common;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Providers.ClickHouse;
using DbStudio.Providers.MySql;
using DbStudio.Providers.Oracle;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.Snowflake;
using DbStudio.Providers.SqlServer;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using MySqlConnector;
using Npgsql;
using Oracle.ManagedDataAccess.Client;
using Snowflake.Data.Client;

namespace DbStudio.Import.Run;

/// <summary>An open, dedicated (unpooled) connection of the import with whatever else must be disposed with it.</summary>
public sealed class ImportConnection(DbConnection connection, IAsyncDisposable? owner = null) : IAsyncDisposable
{
    public DbConnection Db { get; } = connection;

    public async ValueTask DisposeAsync()
    {
        await Db.DisposeAsync().ConfigureAwait(false);
        if (owner is not null) await owner.DisposeAsync().ConfigureAwait(false);
    }
}

/// <summary>Opens the connection an import writes through, per provider (the same builders the sessions use).</summary>
public static class ImportConnections
{
    public static async Task<ImportConnection> OpenAsync(IDbProvider provider, ConnectionProfile profile, string? password, string? database,
        IServiceProvider services, CancellationToken ct)
    {
        var db = string.IsNullOrWhiteSpace(database) ? null : database;
        switch (provider.Id)
        {
            case "sqlserver":
            {
                var c = new SqlConnection(SqlServerConnectionStrings.Build(profile, password, pooling: false));
                await OpenGuarded(c, ct, async () => { if (db is not null) await c.ChangeDatabaseAsync(db, ct).ConfigureAwait(false); }).ConfigureAwait(false);
                return new ImportConnection(c);
            }
            case "postgresql":
            {
                var c = new NpgsqlConnection(PgConnectionStrings.Build(profile, password, pooling: false, db));
                await OpenGuarded(c, ct).ConfigureAwait(false);
                return new ImportConnection(c);
            }
            case "oracle":
            {
                var c = new OracleConnection(OracleConnectionStrings.Build(profile, password, pooling: false));
                await OpenGuarded(c, ct).ConfigureAwait(false);
                return new ImportConnection(c);
            }
            case "sqlite":
            {
                // Opened by the provider: it also attaches the profile's "attach" databases (an import target may live there).
                return new ImportConnection(await DbStudio.Providers.Sqlite.SqliteProvider.OpenImportConnectionAsync(profile, ct).ConfigureAwait(false));
            }
            case "mysql" or "mariadb":
            {
                var b = MySqlConnectionStrings.Builder(profile, password, pooling: false, db);
                b.UseAffectedRows = false; // ExecuteNonQuery counts matched rows (update-only imports)
                var c = new MySqlConnection(b.ConnectionString);
                await OpenGuarded(c, ct).ConfigureAwait(false);
                return new ImportConnection(c);
            }
            case "clickhouse":
            {
                var ch = await ChConnections.OpenAsync(profile, password, db, null, ct).ConfigureAwait(false);
                return new ImportConnection(ch.Connection, new Owned(ch));
            }
            case "snowflake":
            {
                var secrets = services.GetService(typeof(SnowflakeSecrets)) as SnowflakeSecrets ?? SnowflakeSecrets.None;
                var built = SnowflakeConnectionStrings.Build(secrets.Hydrate(profile), password, pooling: false, db, SnowflakeConnectionStrings.ApplicationName);
                try { SnowflakeCredentialManagerFactory.UseInMemoryCredentialManager(); } catch (Exception) { /* older drivers */ }
                var c = new SnowflakeDbConnection(built.ConnectionString);
                if (built.Password is not null) c.Password = built.Password;
                if (built.Token is not null) c.Token = built.Token;
                await OpenGuarded(c, ct).ConfigureAwait(false);
                return new ImportConnection(c);
            }
            default:
                throw new NotSupportedException($"Importing into '{provider.DisplayName}' connections is not supported.");
        }
    }

    private sealed class Owned(ChConnection ch) : IAsyncDisposable
    {
        // ChConnection disposes the driver connection and its HTTP client; the ImportConnection disposes the DbConnection first.
        public ValueTask DisposeAsync() => ch.DisposeAsync();
    }

    private static async Task OpenGuarded(DbConnection c, CancellationToken ct, Func<Task>? after = null)
    {
        try
        {
            await c.OpenAsync(ct).ConfigureAwait(false);
            if (after is not null) await after().ConfigureAwait(false);
        }
        catch
        {
            await c.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }
}
