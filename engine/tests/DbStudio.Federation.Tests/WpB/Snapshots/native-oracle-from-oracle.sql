-- kind: dbLink
-- placeholders: <password>
-- Database link CRM → oracle member 'crm' (oracle sample)
-- Needs the CREATE DATABASE LINK privilege. Replace the placeholders before running.
CREATE DATABASE LINK "CRM" CONNECT TO "SHOP" IDENTIFIED BY "<password>"
    USING '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=ora.example.com)(PORT=15211))(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))';

-- Examples
SELECT * FROM "SHOP"."customers"@"CRM" FETCH FIRST 100 ROWS ONLY;
SELECT * FROM "SHOP"."orders"@"CRM" FETCH FIRST 100 ROWS ONLY;
-- Remove: DROP DATABASE LINK "CRM";
