using System.Security.Cryptography;
using System.Text;

namespace DbStudio.Core.Services.Portability;

/// <summary>How a <see cref="PassphraseBox"/> was sealed: stored in the clear next to the ciphertext (none of it is secret).</summary>
public sealed record EncryptionInfo(string Kdf, int Iterations, string Salt, string Cipher, string Nonce);

/// <summary>
/// WP-5: passphrase encryption of the secrets in a connections file. PBKDF2-HMAC-SHA256 (600,000 iterations, the OWASP
/// 2023 figure; .NET has no Argon2) derives a 256-bit key from the NFC-normalised passphrase and a random 16-byte salt;
/// AES-256-GCM seals the payload under a random 96-bit nonce, authenticating the format header too. A wrong passphrase
/// and a modified file both fail the tag check, so they are reported together.
/// </summary>
public static class PassphraseBox
{
    public const string KdfName = "pbkdf2-sha256", CipherName = "aes-256-gcm";
    public const int Iterations = 600_000, SaltBytes = 16, NonceBytes = 12, TagBytes = 16, KeyBytes = 32;
    public const int MinPassphraseLength = 8;
    /// <summary>Bounds accepted from a file, so a hostile file cannot make the engine spin on a huge iteration count.</summary>
    public const int MaxIterations = 5_000_000, MinIterations = 100_000;

    /// <summary>The AAD bound to the ciphertext: changing the KDF settings or the header makes the tag check fail.</summary>
    private static byte[] Aad(string format, int version, EncryptionInfo info) =>
        Encoding.UTF8.GetBytes($"{format}|v{version}|{info.Kdf}|{info.Iterations}|{info.Cipher}");

    /// <returns>The sealing parameters and the ciphertext (the 16-byte tag is appended to it).</returns>
    public static (EncryptionInfo Info, byte[] Sealed) Seal(byte[] plain, string passphrase, string format, int version)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var info = new EncryptionInfo(KdfName, Iterations, Convert.ToBase64String(salt), CipherName, Convert.ToBase64String(nonce));
        var key = DeriveKey(passphrase, salt, Iterations);
        try
        {
            var cipher = new byte[plain.Length];
            var tag = new byte[TagBytes];
            using var gcm = new AesGcm(key, TagBytes);
            gcm.Encrypt(nonce, plain, cipher, tag, Aad(format, version, info));
            return (info, [.. cipher, .. tag]);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    /// <exception cref="EngineException">400 VALIDATION (field "passphrase") when the passphrase is wrong or the file was changed.</exception>
    public static byte[] Open(byte[] sealedBytes, EncryptionInfo info, string passphrase, string format, int version)
    {
        if (!string.Equals(info.Kdf, KdfName, StringComparison.Ordinal) || !string.Equals(info.Cipher, CipherName, StringComparison.Ordinal))
            throw EngineException.Validation($"This file uses an encryption ('{info.Kdf}' / '{info.Cipher}') this Rowlit does not support.", new { field = "content" });
        if (info.Iterations is < MinIterations or > MaxIterations)
            throw EngineException.Validation("The encryption settings of this file are out of range.", new { field = "content" });
        byte[] salt, nonce;
        try
        {
            salt = Convert.FromBase64String(info.Salt);
            nonce = Convert.FromBase64String(info.Nonce);
        }
        catch (FormatException)
        {
            throw EngineException.Validation("The encryption header of this file is damaged.", new { field = "content" });
        }
        if (salt.Length < 8 || nonce.Length != NonceBytes || sealedBytes.Length < TagBytes)
            throw EngineException.Validation("The encrypted passwords of this file are damaged.", new { field = "content" });
        var key = DeriveKey(passphrase, salt, info.Iterations);
        try
        {
            var cipher = sealedBytes.AsSpan(0, sealedBytes.Length - TagBytes);
            var tag = sealedBytes.AsSpan(sealedBytes.Length - TagBytes);
            var plain = new byte[cipher.Length];
            using var gcm = new AesGcm(key, TagBytes);
            gcm.Decrypt(nonce, cipher, tag, plain, Aad(format, version, info));
            return plain;
        }
        catch (CryptographicException)
        {
            throw EngineException.Validation("Wrong passphrase, or the file was modified.", new { field = "passphrase" });
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    private static byte[] DeriveKey(string passphrase, byte[] salt, int iterations) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(passphrase.Normalize(NormalizationForm.FormC)), salt, iterations, HashAlgorithmName.SHA256, KeyBytes);
}
