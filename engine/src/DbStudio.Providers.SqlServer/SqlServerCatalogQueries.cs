namespace DbStudio.Providers.SqlServer;

/// <summary>
/// Catalog T-SQL (docs/PLAN.md 2.6). All schema-scoped queries take @sid (schema_id) and run in the target database.
/// Every string here is parsed with ScriptDom by the unit tests.
/// </summary>
public static class SqlServerCatalogQueries
{
    /// <summary>
    /// Keeps sys/INFORMATION_SCHEMA, guest and role-owned schemas (db_owner, db_datareader...) out of object listings
    /// (DependencyQueries). The schema list (<see cref="Schemas"/>) itself shows every schema: the tree groups objects
    /// under their owning schema, and a schema with no user objects is a fact about it, not a reason to hide it.
    /// </summary>
    public const string SchemaFilter =
        "s.name NOT IN ('sys','INFORMATION_SCHEMA') AND ((s.name<>'guest' AND s.principal_id NOT IN (SELECT principal_id FROM sys.database_principals WHERE type='R')) " +
        "OR EXISTS (SELECT 1 FROM sys.objects xo WHERE xo.schema_id=s.schema_id AND xo.is_ms_shipped=0))";

    public const string ObjectTypeList = "'U','V','P','PC','FN','IF','TF','FS','FT','SN','SO','TR'";

    public const string Databases =
        "SELECT name FROM sys.databases WHERE state_desc='ONLINE' AND HAS_DBACCESS(name)=1 ORDER BY name";

    public const string CurrentDatabase = "SELECT DB_NAME()";

    public const string DefaultSchema = "SELECT SCHEMA_NAME()";

    public const string ServerInfo =
        "SELECT @@VERSION, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)), @@SERVERNAME, SUSER_SNAME(), DB_NAME()";

    /// <summary>Every schema of the database (sys.schemas under the login's visibility), with its user-object count.</summary>
    public const string Schemas =
        "SELECT s.schema_id, s.name, " +
        "(SELECT COUNT(*) FROM sys.objects o WHERE o.schema_id=s.schema_id AND o.is_ms_shipped=0 AND o.type IN (" + ObjectTypeList + ")) AS object_count " +
        "FROM sys.schemas s ORDER BY s.name";

    public const string SchemaId = "SELECT SCHEMA_ID(@schema)";

    public const string Objects =
        "SELECT o.object_id, o.name, o.type, o.modify_date, CAST(ep.value AS nvarchar(4000)) AS comment, o.parent_object_id " +
        "FROM sys.objects o LEFT JOIN sys.extended_properties ep ON ep.major_id=o.object_id AND ep.minor_id=0 AND ep.class=1 AND ep.name='MS_Description' " +
        "WHERE o.schema_id=@sid AND o.type IN (" + ObjectTypeList + ") AND o.is_ms_shipped=0";

    public const string Columns =
        "SELECT c.object_id, c.column_id, c.name, t.name AS type_name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed, " +
        "dc.definition AS default_def, CAST(ep.value AS nvarchar(4000)) AS comment, t.is_user_defined " +
        "FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id " +
        "LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id " +
        "LEFT JOIN sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.class=1 AND ep.name='MS_Description' " +
        "WHERE c.object_id IN (SELECT object_id FROM sys.objects WHERE schema_id=@sid) " +
        "ORDER BY c.object_id, c.column_id";

    public const string KeyConstraints =
        "SELECT kc.parent_object_id, kc.name, kc.type, ic.column_id, ic.key_ordinal " +
        "FROM sys.key_constraints kc JOIN sys.index_columns ic ON ic.object_id=kc.parent_object_id AND ic.index_id=kc.unique_index_id " +
        "WHERE kc.schema_id=@sid ORDER BY kc.parent_object_id, kc.name, ic.key_ordinal";

    /// <summary>
    /// Both directions: outgoing (parent table in @sid) and incoming (referenced table in @sid). Names come from explicit
    /// joins to sys.objects / sys.schemas / sys.columns (LEFT: a referenced table the login cannot see yields NULL names,
    /// which the reader reports instead of producing an edge to ""), the parent side is filtered by the parent table's
    /// schema (not fk.schema_id). Mapped by column name (<see cref="SqlServerCatalogReader.ReadForeignKeyRow"/>).
    /// Works on SQL Server 2005+ at any compatibility level.
    /// </summary>
    public const string ForeignKeys =
        "SELECT fk.object_id AS fk_id, fk.name AS fk_name, fk.parent_object_id AS parent_id, po.schema_id AS parent_schema_id, " +
        "ps.name AS parent_schema, po.name AS parent_table, pc.name AS parent_column, " +
        "ro.schema_id AS ref_schema_id, rs.name AS ref_schema, ro.name AS ref_table, rc.name AS ref_column, " +
        "fkc.constraint_column_id AS ordinal, fk.is_disabled, fk.is_not_trusted " +
        "FROM sys.foreign_keys fk " +
        "JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id " +
        "LEFT JOIN sys.objects po ON po.object_id=fk.parent_object_id " +
        "LEFT JOIN sys.schemas ps ON ps.schema_id=po.schema_id " +
        "LEFT JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id " +
        "LEFT JOIN sys.objects ro ON ro.object_id=fk.referenced_object_id " +
        "LEFT JOIN sys.schemas rs ON rs.schema_id=ro.schema_id " +
        "LEFT JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id " +
        "WHERE po.schema_id=@sid OR ro.schema_id=@sid " +
        "ORDER BY fk.object_id, fkc.constraint_column_id";

    public const string Parameters =
        "SELECT p.object_id, p.parameter_id, p.name, t.name AS type_name, p.max_length, p.precision, p.scale, p.is_output, p.has_default_value, " +
        "CAST(p.default_value AS nvarchar(4000)) AS default_value " +
        "FROM sys.parameters p JOIN sys.types t ON t.user_type_id=p.user_type_id " +
        "WHERE p.object_id IN (SELECT object_id FROM sys.objects WHERE schema_id=@sid AND type IN ('P','PC','FN','IF','TF','FS','FT')) " +
        "ORDER BY p.object_id, p.parameter_id";

    public const string Synonyms =
        "SELECT sn.name, sn.base_object_name, (SELECT o.type FROM sys.objects o WHERE o.object_id=OBJECT_ID(sn.base_object_name)) AS target_type " +
        "FROM sys.synonyms sn WHERE sn.schema_id=@sid";

    public const string UserTypes =
        "SELECT t.user_type_id, t.name, bt.name AS base_type, t.max_length, t.precision, t.scale, t.is_nullable, t.is_table_type, " +
        "tt.type_table_object_id, t.is_assembly_type " +
        "FROM sys.types t LEFT JOIN sys.types bt ON bt.user_type_id=t.system_type_id " +
        "LEFT JOIN sys.table_types tt ON tt.user_type_id=t.user_type_id " +
        "WHERE t.is_user_defined=1 AND t.schema_id=@sid";

    /// <summary>SQL Server 2005 (no table types: sys.table_types and sys.types.is_table_type are 2008+). Same columns as <see cref="UserTypes"/>.</summary>
    public const string UserTypes2005 =
        "SELECT t.user_type_id, t.name, bt.name AS base_type, t.max_length, t.precision, t.scale, t.is_nullable, CAST(0 AS bit) AS is_table_type, " +
        "CAST(NULL AS int) AS type_table_object_id, t.is_assembly_type " +
        "FROM sys.types t LEFT JOIN sys.types bt ON bt.user_type_id=t.system_type_id " +
        "WHERE t.is_user_defined=1 AND t.schema_id=@sid";

    /// <summary>CLR user-defined types of a schema: the assembly and class behind them.</summary>
    public const string ClrTypes =
        "SELECT ast.user_type_id, a.name AS assembly_name, ast.assembly_class " +
        "FROM sys.assembly_types ast JOIN sys.assemblies a ON a.assembly_id=ast.assembly_id " +
        "WHERE ast.is_user_defined=1 AND ast.schema_id=@sid";

    /// <summary>XML schema collections of a schema (sys.xml_schema_collections; the built-in one lives in sys).</summary>
    public const string XmlSchemaCollections =
        "SELECT x.xml_collection_id, x.name FROM sys.xml_schema_collections x WHERE x.schema_id=@sid ORDER BY x.name";

    /// <summary>The built-in data types of the database (SSMS: System Data Types).</summary>
    public const string SystemTypes =
        "SELECT t.name, t.max_length, t.precision, t.scale, t.collation_name, t.is_nullable " +
        "FROM sys.types t WHERE t.is_user_defined=0 ORDER BY t.name";

    public const string TableTypeColumns =
        "SELECT tt.user_type_id, c.column_id, c.name, t.name AS type_name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed " +
        "FROM sys.table_types tt JOIN sys.columns c ON c.object_id=tt.type_table_object_id JOIN sys.types t ON t.user_type_id=c.user_type_id " +
        "WHERE tt.schema_id=@sid ORDER BY tt.user_type_id, c.column_id";

    public const string ObjectIdByName =
        "SELECT o.object_id, o.type, o.create_date, o.modify_date FROM sys.objects o WHERE o.schema_id=SCHEMA_ID(@schema) AND o.name=@name";

    public const string DetailColumns =
        "SELECT c.column_id, c.name, t.name AS type_name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed, " +
        "dc.definition AS default_def, dc.name AS default_name, CAST(ep.value AS nvarchar(4000)) AS comment, " +
        "cc.definition AS computed_def, cc.is_persisted, CAST(ic.seed_value AS bigint) AS seed, CAST(ic.increment_value AS bigint) AS increment, " +
        "c.collation_name, t.is_user_defined, SCHEMA_NAME(t.schema_id) AS type_schema " +
        "FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id " +
        "LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id " +
        "LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id " +
        "LEFT JOIN sys.identity_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id " +
        "LEFT JOIN sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.class=1 AND ep.name='MS_Description' " +
        "WHERE c.object_id=@id ORDER BY c.column_id";

    public const string DetailIndexes =
        "SELECT i.index_id, i.name, i.is_unique, i.is_primary_key, i.is_unique_constraint, i.type_desc, i.filter_definition, " +
        "ic.key_ordinal, ic.is_descending_key, ic.is_included_column, COL_NAME(ic.object_id, ic.column_id) AS column_name " +
        "FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id " +
        "WHERE i.object_id=@id AND i.index_id>0 AND i.is_hypothetical=0 " +
        "ORDER BY i.index_id, ic.is_included_column, ic.key_ordinal, ic.index_column_id";

    /// <summary>Outgoing FKs of one table, names by explicit joins (NULL when the referenced table is not visible). Mapped by column name.</summary>
    public const string DetailForeignKeys =
        "SELECT fk.name AS fk_name, fk.delete_referential_action_desc AS on_delete, fk.update_referential_action_desc AS on_update, " +
        "fkc.constraint_column_id AS ordinal, pc.name AS parent_column, rs.name AS ref_schema, ro.name AS ref_table, rc.name AS ref_column, " +
        "fk.is_disabled, fk.is_not_trusted " +
        "FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id " +
        "LEFT JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id " +
        "LEFT JOIN sys.objects ro ON ro.object_id=fk.referenced_object_id " +
        "LEFT JOIN sys.schemas rs ON rs.schema_id=ro.schema_id " +
        "LEFT JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id " +
        "WHERE fk.parent_object_id=@id ORDER BY fk.name, fkc.constraint_column_id";

    public const string DetailReferencedBy =
        "SELECT fk.name AS fk_name, ps.name AS parent_schema, po.name AS parent_table, pc.name AS parent_column " +
        "FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id " +
        "JOIN sys.objects po ON po.object_id=fk.parent_object_id JOIN sys.schemas ps ON ps.schema_id=po.schema_id " +
        "LEFT JOIN sys.columns pc ON pc.object_id=fkc.parent_object_id AND pc.column_id=fkc.parent_column_id " +
        "WHERE fk.referenced_object_id=@id ORDER BY ps.name, po.name, fk.name, fkc.constraint_column_id";

    public const string DetailCheckConstraints =
        "SELECT cc.name, cc.definition FROM sys.check_constraints cc WHERE cc.parent_object_id=@id ORDER BY cc.name";

    public const string DetailTriggers =
        "SELECT tr.name FROM sys.triggers tr WHERE tr.parent_id=@id ORDER BY tr.name";

    public const string DetailParameters =
        "SELECT p.parameter_id, p.name, t.name AS type_name, p.max_length, p.precision, p.scale, p.is_output, p.has_default_value " +
        "FROM sys.parameters p JOIN sys.types t ON t.user_type_id=p.user_type_id WHERE p.object_id=@id ORDER BY p.parameter_id";

    public const string DetailRowCount =
        "SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id=@id AND p.index_id IN (0,1)";

    public const string ModuleDefinition =
        "SELECT m.definition FROM sys.sql_modules m WHERE m.object_id=@id";

    public const string SynonymDefinition =
        "SELECT sn.base_object_name FROM sys.synonyms sn WHERE sn.object_id=@id";

    public const string SequenceDefinition =
        "SELECT t.name AS type_name, sq.precision, sq.scale, CAST(sq.start_value AS nvarchar(64)), CAST(sq.increment AS nvarchar(64)), " +
        "CAST(sq.minimum_value AS nvarchar(64)), CAST(sq.maximum_value AS nvarchar(64)), sq.is_cycling, sq.is_cached, sq.cache_size " +
        "FROM sys.sequences sq JOIN sys.types t ON t.user_type_id=sq.user_type_id WHERE sq.object_id=@id";

    public const string UserTypeByName =
        "SELECT t.user_type_id, bt.name AS base_type, t.max_length, t.precision, t.scale, t.is_nullable, t.is_table_type, tt.type_table_object_id, " +
        "t.is_assembly_type, t.collation_name, dob.name AS default_name, rob.name AS rule_name " +
        "FROM sys.types t LEFT JOIN sys.types bt ON bt.user_type_id=t.system_type_id " +
        "LEFT JOIN sys.table_types tt ON tt.user_type_id=t.user_type_id " +
        "LEFT JOIN sys.objects dob ON dob.object_id=t.default_object_id LEFT JOIN sys.objects rob ON rob.object_id=t.rule_object_id " +
        "WHERE t.is_user_defined=1 AND t.schema_id=SCHEMA_ID(@schema) AND t.name=@name";

    /// <summary>SQL Server 2005 (no table types). Same columns as <see cref="UserTypeByName"/>.</summary>
    public const string UserTypeByName2005 =
        "SELECT t.user_type_id, bt.name AS base_type, t.max_length, t.precision, t.scale, t.is_nullable, CAST(0 AS bit) AS is_table_type, CAST(NULL AS int) AS type_table_object_id, " +
        "t.is_assembly_type, t.collation_name, dob.name AS default_name, rob.name AS rule_name " +
        "FROM sys.types t LEFT JOIN sys.types bt ON bt.user_type_id=t.system_type_id " +
        "LEFT JOIN sys.objects dob ON dob.object_id=t.default_object_id LEFT JOIN sys.objects rob ON rob.object_id=t.rule_object_id " +
        "WHERE t.is_user_defined=1 AND t.schema_id=SCHEMA_ID(@schema) AND t.name=@name";

    /// <summary>The assembly and class of one CLR type.</summary>
    public const string ClrTypeByName =
        "SELECT a.name AS assembly_name, ast.assembly_class, ast.is_binary_ordered, ast.is_fixed_length " +
        "FROM sys.assembly_types ast JOIN sys.assemblies a ON a.assembly_id=ast.assembly_id " +
        "WHERE ast.is_user_defined=1 AND ast.schema_id=SCHEMA_ID(@schema) AND ast.name=@name";

    public const string XmlSchemaCollectionByName =
        "SELECT x.xml_collection_id, x.create_date, x.modify_date FROM sys.xml_schema_collections x " +
        "WHERE x.schema_id=SCHEMA_ID(@schema) AND x.name=@name";

    /// <summary>The schemas (one per target namespace) of an XML schema collection, reconstituted by XML_SCHEMA_NAMESPACE.</summary>
    public const string XmlSchemaNamespaces =
        "SELECT ns.name AS namespace_uri, CONVERT(nvarchar(max), XML_SCHEMA_NAMESPACE(SCHEMA_NAME(x.schema_id), x.name, ns.name)) AS definition " +
        "FROM sys.xml_schema_collections x JOIN sys.xml_schema_namespaces ns ON ns.xml_collection_id=x.xml_collection_id " +
        "WHERE x.xml_collection_id=@xid ORDER BY ns.xml_namespace_id";

    /// <summary>
    /// Columns and parameters declared with the type @tid (alias or table type), and objects whose body references it.
    /// The table-type object (type TT) of a column holder is mapped back to the type it belongs to. SQL Server 2008+.
    /// </summary>
    public const string TypeUsage =
        "SELECT s.name AS schema_name, o.name AS object_name, o.type AS object_type, tts.name AS owner_schema, ttt.name AS owner_name, " +
        "c.name AS member_name, CAST(NULL AS int) AS parameter_id " +
        "FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id " +
        "LEFT JOIN sys.table_types ttt ON ttt.type_table_object_id=o.object_id LEFT JOIN sys.schemas tts ON tts.schema_id=ttt.schema_id " +
        "WHERE c.user_type_id=@tid AND (o.is_ms_shipped=0 OR o.type='TT') " +
        "UNION ALL " +
        "SELECT s.name, o.name, o.type, NULL, NULL, p.name, p.parameter_id " +
        "FROM sys.parameters p JOIN sys.objects o ON o.object_id=p.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id " +
        "WHERE p.user_type_id=@tid AND o.is_ms_shipped=0 " +
        "UNION ALL " +
        "SELECT s.name, o.name, o.type, NULL, NULL, CAST(NULL AS sysname), CAST(NULL AS int) " +
        "FROM sys.sql_expression_dependencies d JOIN sys.objects o ON o.object_id=d.referencing_id JOIN sys.schemas s ON s.schema_id=o.schema_id " +
        "WHERE d.referenced_class=6 AND d.referenced_id=@tid AND d.referencing_class=1";

    /// <summary>SQL Server 2005: no table types.</summary>
    public const string TypeUsage2005 =
        "SELECT s.name AS schema_name, o.name AS object_name, o.type AS object_type, CAST(NULL AS sysname) AS owner_schema, CAST(NULL AS sysname) AS owner_name, " +
        "c.name AS member_name, CAST(NULL AS int) AS parameter_id " +
        "FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id " +
        "WHERE c.user_type_id=@tid AND (o.is_ms_shipped=0 OR o.type='TT') " +
        "UNION ALL " +
        "SELECT s.name, o.name, o.type, NULL, NULL, p.name, p.parameter_id " +
        "FROM sys.parameters p JOIN sys.objects o ON o.object_id=p.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id " +
        "WHERE p.user_type_id=@tid AND o.is_ms_shipped=0";

    /// <summary>Columns and parameters typed with an XML schema collection (@xid).</summary>
    public const string XmlSchemaUsage =
        "SELECT s.name AS schema_name, o.name AS object_name, o.type AS object_type, tts.name AS owner_schema, ttt.name AS owner_name, " +
        "c.name AS member_name, CAST(NULL AS int) AS parameter_id " +
        "FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id " +
        "LEFT JOIN sys.table_types ttt ON ttt.type_table_object_id=o.object_id LEFT JOIN sys.schemas tts ON tts.schema_id=ttt.schema_id " +
        "WHERE c.xml_collection_id=@xid AND (o.is_ms_shipped=0 OR o.type='TT') " +
        "UNION ALL " +
        "SELECT s.name, o.name, o.type, NULL, NULL, p.name, p.parameter_id " +
        "FROM sys.parameters p JOIN sys.objects o ON o.object_id=p.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id " +
        "WHERE p.xml_collection_id=@xid AND o.is_ms_shipped=0";

    /// <summary>All catalog queries, for the syntax unit test.</summary>
    public static IReadOnlyDictionary<string, string> All { get; } = new Dictionary<string, string>
    {
        [nameof(Databases)] = Databases, [nameof(CurrentDatabase)] = CurrentDatabase, [nameof(DefaultSchema)] = DefaultSchema,
        [nameof(ServerInfo)] = ServerInfo, [nameof(Schemas)] = Schemas, [nameof(SchemaId)] = SchemaId, [nameof(Objects)] = Objects,
        [nameof(Columns)] = Columns, [nameof(KeyConstraints)] = KeyConstraints, [nameof(ForeignKeys)] = ForeignKeys,
        [nameof(Parameters)] = Parameters, [nameof(Synonyms)] = Synonyms, [nameof(UserTypes)] = UserTypes, [nameof(UserTypes2005)] = UserTypes2005,
        [nameof(TableTypeColumns)] = TableTypeColumns, [nameof(ObjectIdByName)] = ObjectIdByName, [nameof(DetailColumns)] = DetailColumns,
        [nameof(DetailIndexes)] = DetailIndexes, [nameof(DetailForeignKeys)] = DetailForeignKeys, [nameof(DetailReferencedBy)] = DetailReferencedBy,
        [nameof(DetailCheckConstraints)] = DetailCheckConstraints, [nameof(DetailTriggers)] = DetailTriggers,
        [nameof(DetailParameters)] = DetailParameters, [nameof(DetailRowCount)] = DetailRowCount, [nameof(ModuleDefinition)] = ModuleDefinition,
        [nameof(SynonymDefinition)] = SynonymDefinition, [nameof(SequenceDefinition)] = SequenceDefinition, [nameof(UserTypeByName)] = UserTypeByName,
        [nameof(UserTypeByName2005)] = UserTypeByName2005, [nameof(ClrTypes)] = ClrTypes, [nameof(XmlSchemaCollections)] = XmlSchemaCollections,
        [nameof(SystemTypes)] = SystemTypes, [nameof(ClrTypeByName)] = ClrTypeByName, [nameof(XmlSchemaCollectionByName)] = XmlSchemaCollectionByName,
        [nameof(XmlSchemaNamespaces)] = XmlSchemaNamespaces, [nameof(TypeUsage)] = TypeUsage, [nameof(TypeUsage2005)] = TypeUsage2005,
        [nameof(XmlSchemaUsage)] = XmlSchemaUsage,
    };
}
