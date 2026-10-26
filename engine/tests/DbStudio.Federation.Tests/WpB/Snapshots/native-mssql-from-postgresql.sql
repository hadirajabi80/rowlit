-- kind: linkedServer
-- placeholders: <password>
-- note: Goes through ODBC (MSDASQL): install the 'PostgreSQL Unicode(x64)' ODBC driver on the SQL Server machine (or point @provstr at a system DSN).
-- Linked server crm → postgresql member 'crm' (postgresql sample)
-- Run as a login with ALTER ANY LINKED SERVER. Replace the placeholders before running.
EXEC master.dbo.sp_addlinkedserver @server = N'crm', @srvproduct = N'postgresql', @provider = N'MSDASQL',
    @provstr = N'Driver={PostgreSQL Unicode(x64)};Server=pg.example.com;Port=15432;Database=shop;';
EXEC master.dbo.sp_addlinkedsrvlogin @rmtsrvname = N'crm', @useself = N'False', @locallogin = NULL, @rmtuser = N'shop', @rmtpassword = N'<password>';
EXEC master.dbo.sp_serveroption @server = N'crm', @optname = N'rpc out', @optvalue = N'true';

-- Examples
SELECT TOP (100) * FROM OPENQUERY([crm], N'SELECT * FROM "public"."customers"');
SELECT TOP (100) * FROM OPENQUERY([crm], N'SELECT * FROM "public"."orders"');
-- Remove: EXEC master.dbo.sp_dropserver @server = N'crm', @droplogins = 'droplogins';
