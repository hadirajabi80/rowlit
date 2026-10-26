-- kind: linkedServer
-- placeholders: <password>
-- note: Uses the Microsoft OLE DB Driver for SQL Server (MSOLEDBSQL) on the target server; older servers can use SQLNCLI11.
-- Linked server crm → sqlserver member 'crm' (sqlserver sample)
-- Run as a login with ALTER ANY LINKED SERVER. Replace the placeholders before running.
EXEC master.dbo.sp_addlinkedserver @server = N'crm', @srvproduct = N'', @provider = N'MSOLEDBSQL', @datasrc = N'db.example.com,14333', @catalog = N'shop';
EXEC master.dbo.sp_addlinkedsrvlogin @rmtsrvname = N'crm', @useself = N'False', @locallogin = NULL, @rmtuser = N'sa', @rmtpassword = N'<password>';
EXEC master.dbo.sp_serveroption @server = N'crm', @optname = N'rpc out', @optvalue = N'true';

-- Examples
SELECT TOP (100) * FROM [crm].[shop].[dbo].[customers];
SELECT TOP (100) * FROM [crm].[shop].[dbo].[orders];
-- Remove: EXEC master.dbo.sp_dropserver @server = N'crm', @droplogins = 'droplogins';
