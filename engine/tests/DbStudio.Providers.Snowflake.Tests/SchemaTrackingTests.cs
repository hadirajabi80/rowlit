namespace DbStudio.Providers.Snowflake.Tests;

/// <summary>Which batches make the Snowflake session read CURRENT_SCHEMA() again.</summary>
public sealed class SchemaTrackingTests
{
    [Theory]
    [InlineData("USE SCHEMA analytics", true)]
    [InlineData("use database prod", true)]
    [InlineData("CREATE OR REPLACE SCHEMA stage", true)]
    [InlineData("create transient database t", true)]
    [InlineData("CALL my_proc()", true)]
    [InlineData("SELECT * FROM customers", false)]
    [InlineData("INSERT INTO t VALUES (1)", false)]
    public void MayChangeSchema_OnlyForStatementsThatCan(string sql, bool expected) =>
        Assert.Equal(expected, SnowflakeSession.MayChangeSchema(sql));
}
