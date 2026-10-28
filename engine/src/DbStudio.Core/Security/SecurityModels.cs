namespace DbStudio.Core.Security;

public static class SecurityKinds
{
    public const string User = "user";
    public const string Login = "login";
    public const string Role = "role";
    public static bool Valid(string? value) => value is User or Login or Role;
}

public static class SecurityActions
{
    public const string Create = "create";
    public const string Drop = "drop";
    public const string Password = "password";
    public const string Grant = "grant";
    public const string Revoke = "revoke";
    public const string Membership = "membership";
    public static bool Valid(string? value) => value is Create or Drop or Password or Grant or Revoke or Membership;
}

public sealed record SecurityPrincipal(string Name, string Kind, string? Host, bool CanLogin, bool Disabled, bool System, string? Detail = null);
public sealed record SecurityGrant(string Object, string Privilege, bool Grantable, string? Grantor, string? Scope = null, string? State = null);
public sealed record SecurityPrincipalDetail(SecurityPrincipal Principal, IReadOnlyDictionary<string, string?> Attributes,
    IReadOnlyList<string> Members, IReadOnlyList<string> MemberOf, IReadOnlyList<SecurityGrant> Grants, IReadOnlyList<string> CreateScript,
    IReadOnlyList<string> Notes);
public sealed record SecurityPrincipalsResult(string ProviderId, bool Writable, IReadOnlyList<SecurityPrincipal> Principals, IReadOnlyList<string> Notes);

/// <summary>Password is accepted only by script/apply endpoints and is never returned or logged.</summary>
public sealed record SecurityChangeRequest(
    string? Action,
    string? Kind,
    string? Name,
    string? Host = null,
    string? Password = null,
    string? Role = null,
    string? Database = null,
    string? Schema = null,
    string? Object = null,
    string? ObjectType = null,
    IReadOnlyList<string>? Privileges = null,
    bool Grantable = false,
    bool Remove = false,
    bool Deny = false);

public sealed record SecurityScriptResult(IReadOnlyList<string> Statements, IReadOnlyList<string> PreviewStatements, bool Transactional, IReadOnlyList<string> Warnings);
public sealed record SecurityApplyResult(bool Applied, int Statements, long ElapsedMs);
