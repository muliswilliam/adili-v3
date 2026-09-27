package ke.go.adili.keycloak.otp;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.function.Supplier;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * One sign-in's codes and what is left of its allowances, kept in the authentication session's
 * notes so it survives across requests and nodes. The code itself is never stored: only an HMAC
 * under a random key held with it, which is compared in constant time.
 *
 * <p>Wrong codes count across resends, so asking for a new code does not buy more guesses.
 */
public final class OtpChallenge {

    /** Where the state lives; in Keycloak, the authentication session's auth notes. */
    public interface Notes {
        String get(String key);

        void set(String key, String value);

        void remove(String key);
    }

    /** The outcome of checking a posted code. */
    public sealed interface Verification {
        record Valid() implements Verification {}

        /** Wrong code; `attemptsLeft` more before the sign-in stops. */
        record Invalid(int attemptsLeft) implements Verification {}

        /** The code was right or wrong, but past its lifetime; not counted as an attempt. */
        record Expired() implements Verification {}

        /** Too many wrong codes: the sign-in must stop. */
        record Locked() implements Verification {}

        /** No code is outstanding (none sent yet, or already used). */
        record NoCode() implements Verification {}
    }

    public enum SendDecision {
        ALLOWED,
        /** Too soon after the last code (resend on the same channel only). */
        COOLDOWN,
        /** Every new code this sign-in allows has been sent: the sign-in must stop. */
        EXHAUSTED
    }

    private static final String PREFIX = "adili-otp.";
    private static final String KEY = PREFIX + "key";
    private static final String HMAC = PREFIX + "hmac";
    private static final String EXPIRES_AT = PREFIX + "expires-at";
    private static final String CHANNEL = PREFIX + "channel";
    private static final String LAST_SENT_AT = PREFIX + "last-sent-at";
    private static final String SENDS = PREFIX + "sends";
    private static final String ATTEMPTS = PREFIX + "attempts";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final Notes notes;
    private final OtpRules rules;
    private final Supplier<Instant> clock;

    public OtpChallenge(Notes notes, OtpRules rules, Supplier<Instant> clock) {
        this.notes = notes;
        this.rules = rules;
        this.clock = clock;
    }

    /**
     * Records `code` (see {@link #newCode()}) as sent on `channel` and returns it. Call only after
     * the code went out, so a failed send neither replaces a working code nor uses up a resend.
     */
    public String issue(Channel channel, String code) {
        Instant now = clock.get();
        byte[] key = new byte[32];
        RANDOM.nextBytes(key);
        notes.set(KEY, Base64.getEncoder().encodeToString(key));
        notes.set(HMAC, hmac(key, code));
        notes.set(EXPIRES_AT, Long.toString(now.plus(rules.codeLifetime()).toEpochMilli()));
        notes.set(CHANNEL, channel.name());
        notes.set(LAST_SENT_AT, Long.toString(now.toEpochMilli()));
        notes.set(SENDS, Integer.toString(sends() + 1));
        return code;
    }

    /** A fresh 6-digit code, uniformly distributed. */
    public static String newCode() {
        return String.format("%06d", RANDOM.nextInt(1_000_000));
    }

    public Verification verify(String code) {
        if (attempts() >= rules.maxAttempts()) {
            return new Verification.Locked();
        }
        String expected = notes.get(HMAC);
        if (expected == null) {
            return new Verification.NoCode();
        }
        if (!clock.get().isBefore(Instant.ofEpochMilli(Long.parseLong(notes.get(EXPIRES_AT))))) {
            return new Verification.Expired();
        }
        byte[] key = Base64.getDecoder().decode(notes.get(KEY));
        String actual = hmac(key, code == null ? "" : code);
        if (MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.US_ASCII), actual.getBytes(StandardCharsets.US_ASCII))) {
            clearCode();
            return new Verification.Valid();
        }
        int attempts = attempts() + 1;
        notes.set(ATTEMPTS, Integer.toString(attempts));
        int left = rules.maxAttempts() - attempts;
        return left <= 0 ? new Verification.Locked() : new Verification.Invalid(left);
    }

    /** "Resend code": a new code on the same channel, after the cooldown. */
    public SendDecision canResend() {
        if (sends() == 0) {
            return SendDecision.ALLOWED;
        }
        if (resendsLeft() <= 0) {
            return SendDecision.EXHAUSTED;
        }
        return resendAvailableAt().isPresent() ? SendDecision.COOLDOWN : SendDecision.ALLOWED;
    }

    /**
     * "Send it by email (or SMS) instead", or trying a channel again after its send failed. No
     * cooldown, since the user did not get the last code, but it uses up a resend.
     */
    public SendDecision canSwitchChannel() {
        return sends() > 0 && resendsLeft() <= 0 ? SendDecision.EXHAUSTED : SendDecision.ALLOWED;
    }

    /** When "Resend code" starts working; empty when it works now. */
    public Optional<Instant> resendAvailableAt() {
        String last = notes.get(LAST_SENT_AT);
        if (last == null) {
            return Optional.empty();
        }
        Instant available = Instant.ofEpochMilli(Long.parseLong(last)).plus(rules.resendCooldown());
        return clock.get().isBefore(available) ? Optional.of(available) : Optional.empty();
    }

    /** The channel of the last code sent. */
    public Optional<Channel> channel() {
        return Optional.ofNullable(notes.get(CHANNEL)).map(Channel::valueOf);
    }

    public boolean hasLiveCode() {
        String expiresAt = notes.get(EXPIRES_AT);
        return notes.get(HMAC) != null
                && expiresAt != null
                && clock.get().isBefore(Instant.ofEpochMilli(Long.parseLong(expiresAt)));
    }

    public int attemptsLeft() {
        return Math.max(0, rules.maxAttempts() - attempts());
    }

    public int resendsLeft() {
        return Math.max(0, rules.maxResends() - Math.max(0, sends() - 1));
    }

    private void clearCode() {
        notes.remove(KEY);
        notes.remove(HMAC);
        notes.remove(EXPIRES_AT);
    }

    private int sends() {
        return intNote(SENDS);
    }

    private int attempts() {
        return intNote(ATTEMPTS);
    }

    private int intNote(String key) {
        String value = notes.get(key);
        return value == null ? 0 : Integer.parseInt(value);
    }

    private static String hmac(byte[] key, String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(code.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }
}
