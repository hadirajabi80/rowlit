-- kind: fdw
-- placeholders: <password>
-- note: tds_fdw (FreeTDS) must be installed on the PostgreSQL server.
-- Foreign server crm → sqlserver member 'crm' (sqlserver sample)
-- Replace the placeholders before running.
CREATE EXTENSION IF NOT EXISTS tds_fdw;
CREATE SERVER crm FOREIGN DATA WRAPPER tds_fdw OPTIONS (servername 'db.example.com', port '14333', database 'shop');
CREATE USER MAPPING FOR CURRENT_USER SERVER crm OPTIONS (username 'sa', password '<password>');
CREATE SCHEMA IF NOT EXISTS crm;
IMPORT FOREIGN SCHEMA "dbo" LIMIT TO (customers, orders) FROM SERVER crm INTO crm;

-- Examples
SELECT * FROM crm.customers LIMIT 100;
SELECT * FROM crm.orders LIMIT 100;
-- Remove: DROP SCHEMA crm CASCADE; DROP SERVER crm CASCADE;
