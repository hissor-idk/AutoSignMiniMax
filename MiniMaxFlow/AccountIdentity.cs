using System.Text.Json;
using System.Text.RegularExpressions;

namespace MiniMaxFlow;

/// <summary>
/// Reads a readable account name out of a saved Playwright storage state (the
/// user info MiniMax keeps in localStorage), so no account name has to be built
/// into the app. Mirrors scripts/account-identity.mjs: e-mail addresses and
/// phone numbers are masked, because the name ends up in public workflow logs.
/// </summary>
internal static class AccountIdentity
{
    private static readonly string[] NameKeys =
    [
        "nickname", "nick_name", "nickName", "display_name", "displayName",
        "user_name", "userName", "username", "real_name", "realName",
    ];
    private static readonly string[] EmailKeys = ["email", "user_email", "userEmail", "mail"];
    private static readonly string[] PhoneKeys = ["phone", "mobile", "phone_number", "phoneNumber", "mobile_number"];
    private static readonly string[] UserHintKeys =
        ["user_id", "userId", "uid", "email", "avatar", "avatar_url", "avatarUrl", "phone", "mobile"];
    private static readonly Regex UserStorageKey = new("user|account|profile|auth|login|session|member", RegexOptions.IgnoreCase);
    private const int MaxDepth = 6;
    private const int MaxLength = 40;

    public static string? FromStorageState(byte[] stateJson)
    {
        try
        {
            using var document = JsonDocument.Parse(stateJson);
            if (!document.RootElement.TryGetProperty("origins", out var origins) || origins.ValueKind != JsonValueKind.Array)
                return null;

            string? fallback = null;
            foreach (var origin in origins.EnumerateArray())
            {
                if (!origin.TryGetProperty("localStorage", out var entries) || entries.ValueKind != JsonValueKind.Array) continue;
                foreach (var entry in entries.EnumerateArray())
                {
                    var key = GetString(entry, "name");
                    var value = GetString(entry, "value");
                    if (key is null || value is null || !UserStorageKey.IsMatch(key)) continue;

                    var name = FromJsonText(value, 0);
                    if (name is null) continue;
                    if (!name.Contains('*')) return name; // a real nickname beats a masked contact
                    fallback ??= name;
                }
            }
            return fallback;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? FromJsonText(string text, int depth)
    {
        var trimmed = text.TrimStart();
        if (depth > MaxDepth || trimmed.Length == 0 || (trimmed[0] != '{' && trimmed[0] != '[')) return null;
        try
        {
            using var document = JsonDocument.Parse(text);
            (string Name, int Rank)? best = null;
            Visit(document.RootElement, depth, ref best);
            return best?.Name;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static void Visit(JsonElement element, int depth, ref (string Name, int Rank)? best)
    {
        if (depth > MaxDepth) return;
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                var found = Score(element);
                if (found is { } candidate && (best is null || candidate.Rank < best.Value.Rank)) best = candidate;
                foreach (var property in element.EnumerateObject()) VisitChild(property.Value, depth, ref best);
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray()) VisitChild(item, depth, ref best);
                break;
        }
    }

    private static void VisitChild(JsonElement child, int depth, ref (string Name, int Rank)? best)
    {
        if (child.ValueKind == JsonValueKind.String)
        {
            // Stores such as zustand/redux-persist keep their state as a JSON string.
            var nested = FromJsonText(child.GetString() ?? string.Empty, depth + 1);
            if (nested is not null)
            {
                var rank = nested.Contains('*') ? 2 : 0;
                if (best is null || rank < best.Value.Rank) best = (nested, rank);
            }
            return;
        }
        Visit(child, depth + 1, ref best);
    }

    private static (string Name, int Rank)? Score(JsonElement element)
    {
        if (Pick(element, NameKeys, Clean) is { } nickname) return (nickname, 0);
        if (UserHintKeys.Any(key => element.TryGetProperty(key, out _)) && Pick(element, ["name"], Clean) is { } name)
            return (name, 1);
        if (Pick(element, EmailKeys, MaskEmail) is { } email) return (email, 2);
        if (Pick(element, PhoneKeys, MaskPhone) is { } phone) return (phone, 3);
        return null;
    }

    private static string? Pick(JsonElement element, IEnumerable<string> keys, Func<string, string?> clean)
    {
        foreach (var key in keys)
        {
            if (!element.TryGetProperty(key, out var value)) continue;
            var text = value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.GetRawText(),
                _ => null,
            };
            if (text is not null && clean(text) is { } result) return result;
        }
        return null;
    }

    private static string? Clean(string value)
    {
        var text = Regex.Replace(value, @"\s+", " ").Trim();
        if (text.Length == 0) return null;
        if (text.Contains('@')) return MaskEmail(text);
        if (Regex.IsMatch(text, @"^\+?[\d\s-]{8,}$")) return MaskPhone(text);
        return text.Length > MaxLength ? text[..(MaxLength - 1)] + "…" : text;
    }

    private static string? MaskEmail(string value)
    {
        var text = value.Trim();
        if (!Regex.IsMatch(text, @"^[^@\s]+@[^@\s]+\.[^@\s]+$")) return null;
        var at = text.IndexOf('@');
        var local = text[..at];
        var visible = local.Length <= 2 ? local[..1] : local[..2];
        return $"{visible}***{text[at..]}";
    }

    private static string? MaskPhone(string value)
    {
        var digits = Regex.Replace(value, @"\D", string.Empty);
        return digits.Length < 6 ? null : $"{digits[..3]}****{digits[^4..]}";
    }

    private static string? GetString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
}
