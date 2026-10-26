-- kind: federated
-- placeholders: <password>
-- note: MySQL: the FEDERATED engine is disabled by default; start the server with --federated (or federated=ON in my.cnf). The column list must match the remote table.
-- note: The member's host is 'localhost' as Rowlit reaches it; from the target server (another machine, a container) it is probably a different address.
-- FEDERATED tables over server crm → mysql member 'crm' (mysql sample)
-- Replace the placeholders before running.
CREATE SERVER `crm` FOREIGN DATA WRAPPER mysql OPTIONS (HOST 'localhost', PORT 13306, DATABASE 'shop', USER 'shop', PASSWORD '<password>');

CREATE TABLE `crm_customers` (
    `id` int NOT NULL,
    `name` varchar(100) NOT NULL,
    `email` varchar(200),
    PRIMARY KEY (`id`)
) ENGINE = FEDERATED CONNECTION = 'crm/customers';

CREATE TABLE `crm_orders` (
    `id` int NOT NULL,
    `total` decimal(10,2),
    PRIMARY KEY (`id`)
) ENGINE = FEDERATED CONNECTION = 'crm/orders';

-- Remove: DROP TABLE … ; DROP SERVER `crm`;
