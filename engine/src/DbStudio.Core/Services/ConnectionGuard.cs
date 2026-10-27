using System.Net.Sockets;

namespace DbStudio.Core.Services;

/// <summary>
/// Raised when a bounded connection / metadata call got no answer in time (a server that vanished behind a stale pooled
/// connection, a half-open socket). The driver is told to stop and the call is abandoned.
/// </summary>
public sealed class OperationTimeoutException(TimeSpan timeout, string? what = null)
    : TimeoutException($"{(what is null ? "The server" : what)} did not answer within {Format(timeout)}.")
{
    public TimeSpan Timeout { get; } = timeout;

    private static string Format(TimeSpan t) => t.TotalSeconds >= 1 ? $"{Math.Round(t.TotalSeconds)} s" : $"{Math.Round(t.TotalMilliseconds)} ms";
}

/// <summary>
/// Bounded timeouts and dead-connection detection for the calls that run on pooled / catalog connections (catalog, object
/// browser, session open). A driver call on a connection whose peer disappeared without a reset (Docker Desktop restarted,
/// a NAT dropped the mapping) can block for minutes; nothing here relies on the driver noticing.
/// </summary>
public static class ConnectionGuard
{
    /// <summary>
    /// Runs <paramref name="op"/> with a deadline. The token handed to the operation is cancelled when the deadline passes
    /// or <paramref name="ct"/> is cancelled, and the caller stops waiting at the deadline even when the driver ignores the
    /// token (the abandoned task is observed so that its late failure is not reported as unobserved).
    /// </summary>
    /// <exception cref="OperationTimeoutException">The deadline passed (and <paramref name="ct"/> was not cancelled).</exception>
    /// <param name="discardLate">Disposes the result of an abandoned call that finishes after all (a connection opened late must not leak).</param>
    public static async Task<T> BoundedAsync<T>(Func<CancellationToken, Task<T>> op, TimeSpan timeout, CancellationToken ct, string? what = null,
        Func<T, ValueTask>? discardLate = null)
    {
        ArgumentNullException.ThrowIfNull(op);
        ct.ThrowIfCancellationRequested();
        if (timeout <= TimeSpan.Zero || timeout == Timeout.InfiniteTimeSpan) return await op(ct).ConfigureAwait(false);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var task = Run(op, cts.Token);
        try
        {
            return await task.WaitAsync(timeout, ct).ConfigureAwait(false);
        }
        catch (TimeoutException) when (!ct.IsCancellationRequested && !task.IsCompleted)
        {
            Abandon(cts, task, discardLate);
            throw new OperationTimeoutException(timeout, what);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            Abandon(cts, task, discardLate);
            throw;
        }

        static async Task<T> Run(Func<CancellationToken, Task<T>> op, CancellationToken token) => await op(token).ConfigureAwait(false);
    }

    public static Task BoundedAsync(Func<CancellationToken, Task> op, TimeSpan timeout, CancellationToken ct, string? what = null) =>
        BoundedAsync<bool>(async t =>
        {
            await op(t).ConfigureAwait(false);
            return true;
        }, timeout, ct, what);

    private static void Abandon<T>(CancellationTokenSource cts, Task<T> task, Func<T, ValueTask>? discardLate)
    {
        try { cts.Cancel(); } catch (ObjectDisposedException) { /* finished */ }
        _ = task.ContinueWith(static t => _ = t.Exception, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        if (discardLate is null) return;
        _ = task.ContinueWith(async t =>
        {
            try { await discardLate(t.Result).ConfigureAwait(false); }
            catch (Exception) { /* already gone */ }
        }, CancellationToken.None, TaskContinuationOptions.OnlyOnRanToCompletion, TaskScheduler.Default);
    }

    /// <summary>
    /// True when <paramref name="ex"/> (or a cause) says the connection to the server is gone or unresponsive: a socket
    /// error, a deadline (<see cref="OperationTimeoutException"/> or a driver's <see cref="TimeoutException"/>), the stream
    /// ended. <paramref name="includeBareIo"/> also counts a plain <see cref="IOException"/> (what a driver throws when the
    /// transport failed); leave it off where files are read too.
    /// </summary>
    public static bool IsBrokenConnection(Exception? ex, bool includeBareIo = false)
    {
        for (var e = ex; e is not null; e = e.InnerException)
        {
            if (e is OperationCanceledException) return false; // a cancel is the caller's, not the server's
            if (e is AggregateException agg) return agg.InnerExceptions.Any(i => IsBrokenConnection(i, includeBareIo));
            if (e is SocketException or TimeoutException or EndOfStreamException) return true;
            if (e.GetType() == typeof(IOException) && (includeBareIo || e.InnerException is SocketException or EndOfStreamException)) return true;
        }
        return false;
    }

    /// <summary>The message of the innermost cause ("An existing connection was forcibly closed by the remote host").</summary>
    public static string RootMessage(Exception ex)
    {
        if (ex is OperationTimeoutException) return ex.Message;
        var e = ex;
        while (e.InnerException is { } inner) e = inner;
        return string.IsNullOrWhiteSpace(e.Message) ? ex.Message : e.Message.TrimEnd();
    }

    /// <summary>"Server not reachable: …" (503 <see cref="ErrorCodes.Unreachable"/>) for a call that failed on a broken connection.</summary>
    public static EngineException Unreachable(Exception ex, string? connectionName = null) =>
        new(503, ErrorCodes.Unreachable, $"Server not reachable: {RootMessage(ex)}", connectionName is null ? null : new { connection = connectionName });
}
