# Server monitor QA walkthrough

## Setup

1. Save a PostgreSQL, SQL Server, MySQL/MariaDB, ClickHouse, Oracle, or Snowflake connection.
2. For write-action checks, use a non-read-only PostgreSQL, SQL Server, or MySQL/MariaDB connection with permission to terminate a test session.
3. Open another client and start a harmless long-running query.

## Dashboard and refresh

1. Select the connection and run **Server: Open monitor** from the command palette (or press **Ctrl+Alt+M**).
2. Confirm metric cards are grouped into Sessions, Throughput, Memory and cache, I/O, and Server where the provider exposes them.
3. Confirm unavailable metrics show an em dash and a useful tooltip instead of zero.
4. Change the refresh interval and verify the timestamp advances at the selected cadence.
5. Pause the monitor and verify the timestamp and sparklines stop changing; resume it and verify polling restarts.
6. Switch to another tab for at least one interval, return, and confirm the monitor did not build a hidden-tab polling backlog.
7. Leave the monitor open long enough to confirm sparklines appear after a second sample and retain no more than 30 minutes.

## Detail sections

1. Confirm database sizes are listed where supported.
2. Confirm the harmless long-running query appears under **Longest running queries** with its session id, user, database, duration, and SQL text.
3. Click **Open Activity** and confirm the connection's Activity view opens.
4. On a writable supported connection, choose **Kill**, inspect the generated statement in the confirmation dialog, confirm it, and verify the session disappears after refresh.
5. Repeat with the connection marked read-only and confirm no Kill action is offered.

## Failure and compatibility checks

1. Stop the server while the tab is open and confirm the last snapshot remains visible with a retryable error banner.
2. Restart the server and use **Retry** or **Refresh** to recover without reopening the tab.
3. Open a SQLite, Cassandra, Redis, Kafka, MongoDB, or Elasticsearch connection and confirm the monitor command is not offered.
4. Verify SSH-backed connections collect metrics through the existing connection/tunnel path.
