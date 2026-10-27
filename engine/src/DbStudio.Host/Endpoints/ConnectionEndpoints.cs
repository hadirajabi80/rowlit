using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Host.Contracts;

namespace DbStudio.Host.Endpoints;

public static class ConnectionEndpoints
{
    public static RouteGroupBuilder MapConnections(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/connections");

        g.MapGet("", (ConnectionStore store) => store.List());

        g.MapPost("", (ConnectionInput? input, ConnectionStore store) =>
        {
            if (input is null) throw EngineException.Validation("A connection body is required.");
            return store.Create(input.ToProfile(), input.Password);
        });

        g.MapPut("/{id}", async (string id, ConnectionInput? input, ConnectionStore store, CatalogService catalog, SourceClientManager clients) =>
        {
            if (input is null) throw EngineException.Validation("A connection body is required.");
            var updated = store.Update(id, input.ToProfile(), input.Password);
            catalog.Forget(id); // the target may have changed; open sessions keep their connection until closed
            await clients.CloseAsync(id, "connection edited"); // M2: the next use reopens the source client with the new settings
            return updated;
        });

        // logic-21: 409 TX_OPEN (listing the sessions) while one of its sessions has an open transaction, unless force=true.
        g.MapDelete("/{id}", async (string id, bool? force, ConnectionStore store, CatalogService catalog, SessionManager sessions,
            Core.Filters.FilterStore filters, Core.Diagrams.DiagramStore diagrams, Core.Queries.SavedQueryStore queries, SourceClientManager clients,
            StreamManager streams) =>
        {
            store.Get(id); // 404 when unknown
            sessions.EnsureNoOpenTransactions(id, force ?? false);
            await sessions.CloseAllForConnectionAsync(id);
            await streams.CloseForConnectionAsync(id, "connection deleted"); // M2
            await clients.CloseAsync(id, "connection deleted");
            store.Delete(id);
            catalog.Forget(id);
            filters.DeleteForConnection(id); // M1.5 saved filters of the connection
            diagrams.DeleteForConnection(id); // M2-ER saved diagram layouts of the connection
            queries.DeleteForConnection(id); // queries saved into the connection's schemas
            return Results.NoContent();
        });

        // M2: dispatches through SourceRegistry, so redis/mongodb/kafka profiles can be tested too.
        g.MapPost("/test", async (TestConnectionRequest? req, ConnectionStore store, SourceRegistry providers, CancellationToken ct) =>
        {
            if (req?.Profile is null) throw EngineException.Validation("profile is required.", new { field = "profile" });
            var provider = providers.Get(req.Profile.ProviderId);
            var password = req.Password;
            var profile = req.Profile;
            if (!string.IsNullOrEmpty(req.Profile.Id))
            {
                // extra password-typed fields (D12: key passphrase, token, API key…) not retyped in the dialog come from the store,
                // also for providers whose main password is unused (Snowflake key pair / OAuth)
                profile = store.WithSecrets(req.Profile);
                if (req.UseStoredPassword) password ??= store.GetPassword(req.Profile.Id);
            }
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var seconds = Math.Clamp(req.Profile.GetInt("connectTimeout", 15) + 15, 5, 300);
            // Snowflake browser SSO waits up to 120 s for the person to finish the identity provider's login (MFA included)
            if (string.Equals(req.Profile.GetString("authenticator"), "externalbrowser", StringComparison.OrdinalIgnoreCase)) seconds = Math.Max(seconds, 135);
            timeout.CancelAfter(TimeSpan.FromSeconds(seconds));
            try
            {
                return await provider.TestAsync(profile, password, timeout.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                return new TestConnectionResult(false, null, 0, new ErrorInfo(ErrorCodes.ProviderError, "The connection test timed out."));
            }
        });

        return api;
    }
}
