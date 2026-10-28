# Users, roles, and privileges QA walkthrough

## Inspection

1. Expand a PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, ClickHouse, or Snowflake connection and expand **Security**.
2. Open **Users** and **Roles** and confirm the lazy Security workspace lists principals without loading on application startup.
3. Select a principal and verify Overview shows its kind, host (where applicable), role membership, and members.
4. Open Privileges and compare object, privilege, grantable state, and grantor with the server's native security catalog.
5. Open Script and confirm identifiers are quoted for the provider and passwords are represented only by `********`.
6. Confirm permission errors explain which catalog access is needed instead of showing an empty successful list.

## Guarded changes

1. On a writable PostgreSQL, MySQL/MariaDB, or SQL Server connection choose **New** and create a disposable user or role.
2. Confirm the first step only previews SQL, the password is masked, and no server change occurs before **Confirm and apply**.
3. Grant SELECT on a test table, add and remove a role membership, change the disposable user's password, revoke the grant, and drop the principal.
4. After every action confirm the list/detail refreshes and the server catalog matches the displayed state.
5. Mark the connection read-only and confirm all write buttons disappear and direct script/apply requests return `READ_ONLY`.
6. On Oracle, ClickHouse, and Snowflake confirm inspection works but the workspace clearly says it is inspection-only.
7. On SQLite and Cassandra confirm no Security group or Security command is offered.

## Provider details

1. MySQL/MariaDB: verify `user@host` is preserved and quoted independently.
2. SQL Server: verify server logins remain distinct from database users and roles; test in the selected database.
3. PostgreSQL: verify login roles and non-login roles are classified correctly.
4. Verify an SSH-backed connection uses the existing tunnel and does not open a direct connection.
