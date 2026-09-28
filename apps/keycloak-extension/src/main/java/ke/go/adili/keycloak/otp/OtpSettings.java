package ke.go.adili.keycloak.otp;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.keycloak.models.AuthenticatorConfigModel;
import org.keycloak.provider.ProviderConfigProperty;

/**
 * The authenticator's configuration (the execution's authenticator config in the realm). Blank
 * URLs fall back to Keycloak's environment, so the realm file stays the same across deployments;
 * the client secret is normally a vault expression such as `${vault.keycloak-extension-secret}`.
 */
public record OtpSettings(
        OtpRules rules,
        String notificationsUrl,
        String tokenUrl,
        String clientId,
        String clientSecret,
        Duration requestTimeout) {

    static final String CODE_LIFETIME_SECONDS = "codeLifetimeSeconds";
    static final String MAX_ATTEMPTS = "maxAttempts";
    static final String RESEND_COOLDOWN_SECONDS = "resendCooldownSeconds";
    static final String MAX_RESENDS = "maxResends";
    static final String NOTIFICATIONS_URL = "notificationsUrl";
    static final String TOKEN_URL = "tokenUrl";
    static final String CLIENT_ID = "clientId";
    static final String CLIENT_SECRET = "clientSecret";
    static final String REQUEST_TIMEOUT_MS = "requestTimeoutMs";

    static final String NOTIFICATIONS_URL_ENV = "ADILI_NOTIFICATIONS_URL";
    static final String TOKEN_URL_ENV = "ADILI_OTP_TOKEN_URL";

    static final List<ProviderConfigProperty> PROPERTIES = List.of(
            property(CODE_LIFETIME_SECONDS, "Code lifetime (seconds)", "How long a code works.", "600"),
            property(MAX_ATTEMPTS, "Wrong codes allowed", "Wrong codes that stop the sign-in.", "5"),
            property(RESEND_COOLDOWN_SECONDS, "Resend cooldown (seconds)", "Wait before Resend code works.", "60"),
            property(MAX_RESENDS, "New codes allowed", "New codes after the first; one more stops the sign-in.", "3"),
            property(NOTIFICATIONS_URL, "Notifications URL",
                    "Notifications service origin. Blank: the " + NOTIFICATIONS_URL_ENV + " environment variable.", ""),
            property(TOKEN_URL, "Token URL",
                    "Token endpoint for the client below. Blank: " + TOKEN_URL_ENV
                            + ", else this realm's endpoint on http://localhost:8080.", ""),
            property(CLIENT_ID, "Client ID", "Confidential client with the messages scope.", "keycloak-extension"),
            secret(CLIENT_SECRET, "Client secret", "Normally a vault expression.", "${vault.keycloak-extension-secret}"),
            property(REQUEST_TIMEOUT_MS, "Request timeout (ms)", "Longest wait for notifications or a token.", "6000"));

    /**
     * Reads the config. `env` and `vault` are passed in so tests and Keycloak supply their own;
     * `realm` names the realm for the default token URL.
     */
    static OtpSettings from(
            AuthenticatorConfigModel model, String realm, Function<String, String> env, Function<String, String> vault) {
        Map<String, String> config = model == null || model.getConfig() == null ? Map.of() : model.getConfig();
        Function<String, String> value = key -> {
            String raw = config.get(key);
            if (raw != null && !raw.isBlank()) {
                return raw.trim();
            }
            return PROPERTIES.stream()
                    .filter(p -> p.getName().equals(key))
                    .map(p -> (String) p.getDefaultValue())
                    .findFirst()
                    .orElse("");
        };
        // Blank when neither is set: codes cannot be sent, and users see the send-failed page.
        String notificationsUrl = orElse(orElse(value.apply(NOTIFICATIONS_URL), env.apply(NOTIFICATIONS_URL_ENV)), "");
        String tokenUrl = orElse(
                orElse(value.apply(TOKEN_URL), env.apply(TOKEN_URL_ENV)),
                "http://localhost:8080/realms/" + realm + "/protocol/openid-connect/token");
        return new OtpSettings(
                new OtpRules(
                        Duration.ofSeconds(Long.parseLong(value.apply(CODE_LIFETIME_SECONDS))),
                        Integer.parseInt(value.apply(MAX_ATTEMPTS)),
                        Duration.ofSeconds(Long.parseLong(value.apply(RESEND_COOLDOWN_SECONDS))),
                        Integer.parseInt(value.apply(MAX_RESENDS))),
                notificationsUrl,
                tokenUrl,
                value.apply(CLIENT_ID),
                vault.apply(value.apply(CLIENT_SECRET)),
                Duration.ofMillis(Long.parseLong(value.apply(REQUEST_TIMEOUT_MS))));
    }

    /** Minutes the notifications templates quote, rounded up. */
    int expiresInMinutes() {
        return (int) Math.max(1, (rules.codeLifetime().toSeconds() + 59) / 60);
    }

    private static String orElse(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private static ProviderConfigProperty property(String name, String label, String help, String defaultValue) {
        ProviderConfigProperty property = new ProviderConfigProperty(
                name, label, help, ProviderConfigProperty.STRING_TYPE, defaultValue);
        return property;
    }

    private static ProviderConfigProperty secret(String name, String label, String help, String defaultValue) {
        ProviderConfigProperty property = new ProviderConfigProperty(
                name, label, help, ProviderConfigProperty.PASSWORD, defaultValue);
        property.setSecret(true);
        return property;
    }
}
