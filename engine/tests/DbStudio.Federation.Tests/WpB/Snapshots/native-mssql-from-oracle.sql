-- kind: linkedServer
-- placeholders: <password>
-- note: Needs the Oracle OLE DB provider (OraOLEDB.Oracle) installed on the SQL Server machine, with 'Allow inprocess' enabled.
-- Linked server crm → oracle member 'crm' (oracle sample)
-- Run as a login with ALTER ANY LINKED SERVER. Replace the placeholders before running.
EXEC master.dbo.sp_addlinkedserver @server = N'crm', @srvproduct = N'Oracle', @provider = N'OraOLEDB.Oracle', @datasrc = N'//ora.example.com:15211/FREEPDB1';
EXEC master.dbo.sp_addlinkedsrvlogin @rmtsrvname = N'crm', @useself = N'False', @locallogin = NULL, @rmtuser = N'shop', @rmtpassword = N'<password>';
EXEC master.dbo.sp_serveroption @server = N'crm', @optname = N'rpc out', @optvalue = N'true';

-- Examples
SELECT TOP (100) * FROM OPENQUERY([crm], N'SELECT * FROM "SHOP"."customers"');
SELECT TOP (100) * FROM OPENQUERY([crm], N'SELECT * FROM "SHOP"."orders"');
-- Remove: EXEC master.dbo.sp_dropserver @server = N'crm', @droplogins = 'droplogins';
