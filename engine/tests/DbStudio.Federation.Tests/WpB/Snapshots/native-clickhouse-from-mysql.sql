-- kind: clickhouseEngine
-- placeholders: <password>
-- note: The database engine maps every table of the remote database/schema; ClickHouse reads them on each query (no copy).
-- note: The member's host is 'localhost' as Rowlit reaches it; from the target server (another machine, a container) it is probably a different address.
-- Database crm → mysql member 'crm' (mysql sample), read live through the MySQL database engine
-- Replace the placeholders before running.
CREATE DATABASE IF NOT EXISTS `crm` ENGINE = MySQL('localhost:13306', 'shop', 'shop', '<password>');

-- Examples
SELECT * FROM `crm`.`customers` LIMIT 100;
SELECT * FROM `crm`.`orders` LIMIT 100;
-- Remove: DROP DATABASE `crm`;
