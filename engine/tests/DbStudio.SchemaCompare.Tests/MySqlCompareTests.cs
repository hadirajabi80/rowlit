using DbStudio.Core.SchemaCompare;

namespace DbStudio.SchemaCompare.Tests;

/// <summary>Scratch databases cmp_src / cmp_dst on the MySQL and MariaDB sample servers (the shop database is never touched).</summary>
public sealed class MySqlCompareTests
{
    private static IEnumerable<string> Common(string s) =>
    [
        $"CREATE DATABASE {s}",
        $"CREATE TABLE {s}.countries (id INT NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL) ENGINE=InnoDB",
    ];

    private static IEnumerable<string> Source(string s) => Common(s).Concat(
    [
        $"CREATE TABLE {s}.customers (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(200) NULL, phone VARCHAR(30) NULL, " +
        $"country_id INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_customers_email (email), " +
        $"CONSTRAINT fk_customers_country FOREIGN KEY (country_id) REFERENCES {s}.countries (id), CONSTRAINT ck_customers_name CHECK (CHAR_LENGTH(name) > 0)) ENGINE=InnoDB",
        $"CREATE TABLE {s}.products (id INT NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, price DECIMAL(10,2) NULL, sku VARCHAR(20) NULL, UNIQUE KEY uq_products_sku (sku)) ENGINE=InnoDB",
        $"CREATE TABLE {s}.orders (id INT NOT NULL PRIMARY KEY, customer_id INT NOT NULL, total DECIMAL(12,2) NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'new', " +
        $"CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES {s}.customers (id) ON DELETE CASCADE, KEY ix_orders_customer (customer_id, total)) ENGINE=InnoDB",
        $"CREATE TABLE {s}.order_lines (order_id INT NOT NULL, product_id INT NOT NULL, qty INT NOT NULL, PRIMARY KEY (order_id, product_id), " +
        $"CONSTRAINT fk_lines_order FOREIGN KEY (order_id) REFERENCES {s}.orders (id), CONSTRAINT fk_lines_product FOREIGN KEY (product_id) REFERENCES {s}.products (id)) ENGINE=InnoDB",
        $"CREATE TABLE {s}.reviews (id INT NOT NULL PRIMARY KEY, customer_id INT NOT NULL, body TEXT NULL, CONSTRAINT fk_reviews_customer FOREIGN KEY (customer_id) REFERENCES {s}.customers (id)) ENGINE=InnoDB COMMENT='Customer reviews'",
        $"CREATE VIEW {s}.customer_orders AS SELECT c.id AS customer_id, c.name, COUNT(o.id) AS orders FROM {s}.customers c LEFT JOIN {s}.orders o ON o.customer_id = c.id GROUP BY c.id, c.name",
        $"CREATE VIEW {s}.v_new_only AS SELECT id, name FROM {s}.countries",
        $"CREATE FUNCTION {s}.fn_tax(amount DECIMAL(12,2)) RETURNS DECIMAL(12,2) DETERMINISTIC RETURN amount * 0.19",
        $"CREATE FUNCTION {s}.fn_only_source() RETURNS INT DETERMINISTIC RETURN 1",
        $"CREATE PROCEDURE {s}.get_customer(IN p_id INT) BEGIN SELECT * FROM {s}.customers WHERE id = p_id; END",
        $"CREATE TRIGGER {s}.trg_orders_check BEFORE INSERT ON {s}.orders FOR EACH ROW BEGIN IF NEW.total < 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'negative total'; END IF; END",
    ]);

    private static IEnumerable<string> Target(string s) => Common(s).Concat(
    [
        $"CREATE TABLE {s}.customers (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(100) NULL, nickname VARCHAR(30) NULL, " +
        $"country_id INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_customers_email (email), " +
        $"CONSTRAINT fk_customers_country FOREIGN KEY (country_id) REFERENCES {s}.countries (id), CONSTRAINT ck_customers_name CHECK (CHAR_LENGTH(name) > 1)) ENGINE=InnoDB",
        $"CREATE TABLE {s}.products (id INT NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, price DECIMAL(8,2) NULL, sku VARCHAR(20) NULL) ENGINE=InnoDB",
        $"CREATE TABLE {s}.orders (id INT NOT NULL PRIMARY KEY, customer_id INT NOT NULL, total DECIMAL(12,2) NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'new', " +
        $"CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES {s}.customers (id), KEY ix_orders_customer (customer_id)) ENGINE=InnoDB",
        $"CREATE TABLE {s}.order_lines (order_id INT NOT NULL, product_id INT NOT NULL, qty INT NOT NULL, PRIMARY KEY (order_id, product_id), " +
        $"CONSTRAINT fk_lines_order FOREIGN KEY (order_id) REFERENCES {s}.orders (id), CONSTRAINT fk_lines_product FOREIGN KEY (product_id) REFERENCES {s}.products (id)) ENGINE=InnoDB",
        $"CREATE TABLE {s}.legacy_audit (id INT NOT NULL PRIMARY KEY, customer_id INT NULL, note TEXT NULL, CONSTRAINT fk_audit_customer FOREIGN KEY (customer_id) REFERENCES {s}.customers (id)) ENGINE=InnoDB",
        $"CREATE VIEW {s}.customer_orders AS SELECT c.id AS customer_id, c.name FROM {s}.customers c",
        $"CREATE VIEW {s}.v_old AS SELECT id FROM {s}.countries",
        $"CREATE FUNCTION {s}.fn_tax(amount DECIMAL(12,2)) RETURNS DECIMAL(12,2) DETERMINISTIC RETURN amount * 0.2",
        $"CREATE FUNCTION {s}.fn_only_target() RETURNS INT DETERMINISTIC RETURN 2",
        $"CREATE PROCEDURE {s}.get_customer(IN p_id INT) BEGIN SELECT * FROM {s}.customers WHERE id = p_id; END",
        $"CREATE TRIGGER {s}.trg_old BEFORE DELETE ON {s}.orders FOR EACH ROW BEGIN SET @x = 1; END",
    ]);

    private static IEnumerable<string> Cleanup(string s) => [$"DROP DATABASE IF EXISTS {s}"];

    private static readonly Dictionary<string, string> Expected = new()
    {
        ["table:customers"] = CompareStatus.Alter,
        ["table:products"] = CompareStatus.Alter,
        ["table:orders"] = CompareStatus.Alter,
        ["table:reviews"] = CompareStatus.Create,
        ["table:legacy_audit"] = CompareStatus.Drop,
        ["view:customer_orders"] = CompareStatus.Alter,
        ["view:v_new_only"] = CompareStatus.Create,
        ["view:v_old"] = CompareStatus.Drop,
        ["func:fn_tax"] = CompareStatus.Alter,
        ["func:fn_only_source"] = CompareStatus.Create,
        ["func:fn_only_target"] = CompareStatus.Drop,
        ["trigger:trg_orders_check"] = CompareStatus.Create,
        ["trigger:trg_old"] = CompareStatus.Drop,
    };

    private static async Task RunAsync(bool maria)
    {
        var s = maria ? Servers.MariaDb : Servers.MySql;
        Skip.IfNot(await Servers.ReachableAsync(s.Host, s.Port), $"{(maria ? "MariaDB" : "MySQL")} sample server is not reachable.");
        using var env = new CompareEnv();
        var conn = env.Add(maria ? "mariadb" : "mysql", maria ? "mariadb" : "mysql", Servers.MySqlProps(maria), s.Password);
        var (result, script) = await ScratchRunner.RunAsync(env, new Scratch(conn, null, "cmp_src", "cmp_dst", Source, Target, Cleanup, Expected));
        Assert.False(result.TransactionalDdl);
        Assert.Contains("DELIMITER $$", script.Text);
    }

    [SkippableFact]
    public Task MySql_Compare_Script_Apply_ThenIdentical() => RunAsync(false);

    [SkippableFact]
    public Task MariaDb_Compare_Script_Apply_ThenIdentical() => RunAsync(true);
}
