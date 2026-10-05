package ke.go.adili.keycloak.demo;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.keycloak.util.JsonSerialization;

/**
 * A demo sign-in ticket: `v1.<payload>.<signature>`, where the payload is base64url JSON
 * `{"k": demo key, "exp": epoch seconds, "n": nonce}` and the signature is base64url
 * HMAC-SHA256 over `v1.<payload>` with the shared demo ticket secret.
 *
 * <p>The format is shared with `@adili/demo-auth` (packages/demo-auth/src/ticket.ts), which mints
 * tickets for the apps' role switcher and the demo seed; change both together. A ticket names an
 * account by its `demo_key` attribute, never by username, so only accounts marked as demo accounts
 * can be signed in with one.
 */
public final class DemoTicket {

    static final String VERSION = "v1";
    private static final String HMAC = "HmacSHA256";
    private static final Pattern DEMO_KEY = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");
    private static final Pattern NONCE = Pattern.compile("[A-Za-z0-9_-]{16,128}");
    /** Allowance for clock drift between the minting app and Keycloak. */
    private static final Duration SKEW = Duration.ofSeconds(30);

    /** Why a ticket was refused, or what it names. */
    public sealed interface Verification {
        record Valid(String demoKey, String nonce, Instant expiresAt) implements Verification {}

        record Malformed() implements Verification {}

        record BadSignature() implements Verification {}

        record Expired() implements Verification {}

        /** Expires further ahead than the configured lifetime allows. */
        record TooLongLived() implements Verification {}
    }

    private DemoTicket() {}

    /** Checks `raw` against `secret` at `now`; `maxLifetime` caps how far ahead `exp` may be. */
    public static Verification verify(String raw, String secret, Instant now, Duration maxLifetime) {
        if (raw == null || secret == null || secret.isBlank()) {
            return new Verification.Malformed();
        }
        String[] parts = raw.split("\\.", -1);
        if (parts.length != 3 || !VERSION.equals(parts[0])) {
            return new Verification.Malformed();
        }
        byte[] signature;
        Map<?, ?> payload;
        try {
            signature = Base64.getUrlDecoder().decode(parts[2]);
            payload = JsonSerialization.readValue(Base64.getUrlDecoder().decode(parts[1]), Map.class);
        } catch (Exception e) {
            return new Verification.Malformed();
        }
        if (!MessageDigest.isEqual(sign(parts[0] + "." + parts[1], secret), signature)) {
            return new Verification.BadSignature();
        }
        if (!(payload.get("k") instanceof String demoKey) || !DEMO_KEY.matcher(demoKey).matches()
                || !(payload.get("n") instanceof String nonce) || !NONCE.matcher(nonce).matches()
                || !(payload.get("exp") instanceof Number exp)) {
            return new Verification.Malformed();
        }
        Instant expiresAt = Instant.ofEpochSecond(exp.longValue());
        if (!expiresAt.isAfter(now)) {
            return new Verification.Expired();
        }
        if (expiresAt.isAfter(now.plus(maxLifetime).plus(SKEW))) {
            return new Verification.TooLongLived();
        }
        return new Verification.Valid(demoKey, nonce, expiresAt);
    }

    /** Mints a ticket; Keycloak never does, the tests and other tools do. */
    static String mint(String demoKey, String nonce, Instant expiresAt, String secret) {
        try {
            String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(JsonSerialization.writeValueAsBytes(
                    Map.of("k", demoKey, "n", nonce, "exp", expiresAt.getEpochSecond())));
            String signed = VERSION + "." + payload;
            return signed + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(sign(signed, secret));
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] sign(String value, String secret) {
        try {
            Mac mac = Mac.getInstance(HMAC);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC));
            return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException(e);
        }
    }
}
