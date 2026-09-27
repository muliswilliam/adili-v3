package ke.go.adili.keycloak.otp;

import java.time.Duration;

/**
 * The limits on one sign-in's codes (spec 03 BE-8): how long a code works, how many wrong codes
 * end the sign-in, how long before "Resend code" works, and how many new codes may follow the first.
 */
public record OtpRules(Duration codeLifetime, int maxAttempts, Duration resendCooldown, int maxResends) {

    public static final OtpRules DEFAULTS = new OtpRules(Duration.ofMinutes(10), 5, Duration.ofSeconds(60), 3);

    public OtpRules {
        if (codeLifetime.isNegative() || codeLifetime.isZero()) {
            throw new IllegalArgumentException("codeLifetime must be positive");
        }
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be at least 1");
        }
        if (resendCooldown.isNegative()) {
            throw new IllegalArgumentException("resendCooldown must not be negative");
        }
        if (maxResends < 0) {
            throw new IllegalArgumentException("maxResends must not be negative");
        }
    }
}
