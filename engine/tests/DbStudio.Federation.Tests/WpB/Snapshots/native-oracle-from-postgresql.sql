-- kind: dbLink
-- placeholders: <gateway_tns_alias>, <password>
-- note: A non-Oracle member goes through Oracle Database Gateway for ODBC (DG4ODBC): configure an ODBC DSN for the postgresql server (pg.example.com:15432), an init<sid>.ora with HS_FDS_CONNECT_INFO, a listener SID_DESC with PROGRAM=dg4odbc and a tnsnames.ora entry with (HS=OK); <gateway_tns_alias> is that entry.
-- Database link CRM → postgresql member 'crm' (postgresql sample)
-- Needs the CREATE DATABASE LINK privilege. Replace the placeholders before running.
CREATE DATABASE LINK "CRM" CONNECT TO "shop" IDENTIFIED BY "<password>"
    USING '<gateway_tns_alias>';

-- Examples (remote names in the member's own case, quoted)
SELECT * FROM "customers"@"CRM";
SELECT * FROM "orders"@"CRM";
-- Remove: DROP DATABASE LINK "CRM";
