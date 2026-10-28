using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Logs.Endpoints;
using DbStudio.Logs.Monitor;
using DbStudio.Logs.Providers.Kafka;
using DbStudio.Logs.Providers.Mongo;
using DbStudio.Logs.Providers.Oracle;
using DbStudio.Logs.Providers.PostgreSql;
using DbStudio.Logs.Providers.Redis;
using DbStudio.Logs.Providers.SqlServer;
using DbStudio.Logs.Sql;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace DbStudio.Logs;

/// <summary>
/// Composition root of the logs and activity package (docs/PLAN-M2.md 8, D9), discovered by <c>EngineModules.Discover</c>.
/// Registers the per-provider <see cref="ILogSource"/>/<see cref="IActivitySource"/> (keyed by provider id; SQLite has
/// none, so its Logs tab shows the engine log only), the gateway seams (TryAdd: an integrator may register adapters over
/// the M2-R/M/K clients first), the <c>logs.tail</c> and <c>activity.poll</c> stream factories and <c>/logs/{cid}/…</c>.
/// </summary>
public sealed class LogsModule : IEngineModule
{
    public void ConfigureServices(IServiceCollection services)
    {
        services.TryAddSingleton(sp => new EngineLogSource(sp.GetRequiredService<AppPaths>().LogsDir));
        services.TryAddSingleton<ISqlRunnerFactory>(sp => new SessionSqlRunnerFactory(sp.GetRequiredService<ProviderRegistry>(), sp.GetRequiredService<ConnectionStore>(),
            sp.GetService<Microsoft.Extensions.Logging.ILogger<SessionSqlRunnerFactory>>()));
        services.TryAddSingleton<IRedisLogGateway>(sp =>
        {
            var store = sp.GetRequiredService<ConnectionStore>();
            return new RespRedisGateway(store.GetPassword, (p, ct) => store.ResolveForOpenAsync(p, ct)); // WP-SSH
        });
        services.TryAddSingleton<IMongoLogGateway>(sp => new ReflectionMongoGateway(sp.GetRequiredService<SourceClientManager>()));
        services.TryAddSingleton<IKafkaLogGateway>(sp => new ReflectionKafkaGateway(sp.GetRequiredService<SourceClientManager>(), sp));

        services.AddSingleton<SqlServerLogSource>();
        services.AddSingleton<OracleLogSource>();
        services.AddSingleton<PgLogSource>();
        services.AddSingleton<RedisLogSource>();
        services.AddSingleton<MongoLogSource>();
        services.AddSingleton(sp => new KafkaLogSource(sp.GetRequiredService<IKafkaLogGateway>(), sp.GetRequiredService<JobManager>(), () => sp.GetService<StreamManager>()));
        Keyed<SqlServerLogSource>(services, "sqlserver");
        Keyed<OracleLogSource>(services, "oracle");
        Keyed<PgLogSource>(services, "postgresql");
        Keyed<RedisLogSource>(services, "redis");
        Keyed<MongoLogSource>(services, "mongodb");
        Keyed<KafkaLogSource>(services, "kafka");

        services.AddSingleton(LogService.FromServices);

        // WP-12 server monitor: the readers only need the SQL runner, so every provider's keyed reader is registered here
        // (the provider modules are untouched); MySQL and MariaDB share one implementation under two ids.
        services.AddKeyedSingleton<IMetricsReader>("postgresql", (sp, _) => new PgMetricsReader(sp.GetRequiredService<ISqlRunnerFactory>()));
        services.AddKeyedSingleton<IMetricsReader>("sqlserver", (sp, _) => new SqlServerMetricsReader(sp.GetRequiredService<ISqlRunnerFactory>()));
        services.AddKeyedSingleton<IMetricsReader>("mysql", (sp, _) => new MySqlMetricsReader(sp.GetRequiredService<ISqlRunnerFactory>(), "mysql"));
        services.AddKeyedSingleton<IMetricsReader>("mariadb", (sp, _) => new MySqlMetricsReader(sp.GetRequiredService<ISqlRunnerFactory>(), "mariadb"));
        services.AddKeyedSingleton<IMetricsReader>("clickhouse", (sp, _) => new ClickHouseMetricsReader(sp.GetRequiredService<ISqlRunnerFactory>()));
        services.AddKeyedSingleton<IMetricsReader>("oracle", (sp, _) => new OracleMetricsReader(sp.GetRequiredService<ISqlRunnerFactory>()));
        services.AddKeyedSingleton<IMetricsReader>("snowflake", (sp, _) => new SnowflakeMetricsReader(sp.GetRequiredService<ISqlRunnerFactory>()));
        services.AddSingleton(MonitorService.FromServices);
        services.AddKeyedSingleton<IStreamFactory>(LogTailStreamFactory.Kind, (sp, _) =>
            new LogTailStreamFactory(sp.GetRequiredService<LogService>(), () => TailInterval(sp.GetService<SettingsService>())));
        services.AddKeyedSingleton<IStreamFactory>(ActivityPollStreamFactory.Kind, (sp, _) => new ActivityPollStreamFactory(sp.GetRequiredService<LogService>()));
    }

    private static void Keyed<T>(IServiceCollection services, string providerId) where T : class, ILogSource, IActivitySource
    {
        services.AddKeyedSingleton<ILogSource>(providerId, (sp, _) => sp.GetRequiredService<T>());
        services.AddKeyedSingleton<IActivitySource>(providerId, (sp, _) => sp.GetRequiredService<T>());
    }

    /// <summary>settings logs.tailIntervalMs (default 2000).</summary>
    public static int TailInterval(SettingsService? settings)
    {
        var node = settings?.Get()["logs"]?["tailIntervalMs"];
        return node is null ? 2000 : (int)Math.Clamp(SettingsService.Number(node), 250, 600_000);
    }

    public void MapEndpoints(RouteGroupBuilder api)
    {
        api.MapLogs();
        api.MapMonitor(); // WP-12
    }
}
