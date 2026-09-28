package ke.go.adili.keycloak.otp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;

class OtpChallengeTest {

    private static final OtpRules RULES = new OtpRules(Duration.ofMinutes(10), 5, Duration.ofSeconds(60), 3);

    private final Map<String, String> store = new HashMap<>();
    private Instant now = Instant.parse("2026-10-01T08:00:00Z");

    private OtpChallenge challenge() {
        return new OtpChallenge(new MapNotes(store), RULES, () -> now);
    }

    @Test
    void issuesSixDigitCodesThatVerifyOnce() {
        String code = challenge().issue(Channel.SMS, OtpChallenge.newCode());

        assertTrue(code.matches("\\d{6}"), code);
        assertEquals(Channel.SMS, challenge().channel().orElseThrow());
        assertEquals(new OtpChallenge.Verification.Valid(), challenge().verify(code));
        assertEquals(new OtpChallenge.Verification.NoCode(), challenge().verify(code));
    }

    @Test
    void keepsOnlyAKeyedHashOfTheCode() {
        String code = challenge().issue(Channel.SMS, OtpChallenge.newCode());

        assertFalse(store.values().stream().anyMatch(value -> value.contains(code)), store.toString());
    }

    @Test
    void countsWrongCodesAndLocksOnTheFifth() {
        String code = challenge().issue(Channel.SMS, OtpChallenge.newCode());
        String wrong = code.equals("000000") ? "111111" : "000000";

        for (int left = 4; left >= 1; left--) {
            assertEquals(new OtpChallenge.Verification.Invalid(left), challenge().verify(wrong));
        }
        assertEquals(new OtpChallenge.Verification.Locked(), challenge().verify(wrong));
        assertEquals(new OtpChallenge.Verification.Locked(), challenge().verify(code));
    }

    @Test
    void rejectsACodePastItsLifetimeWithoutCountingAnAttempt() {
        String code = challenge().issue(Channel.EMAIL, OtpChallenge.newCode());
        now = now.plus(Duration.ofMinutes(10));

        assertEquals(new OtpChallenge.Verification.Expired(), challenge().verify(code));
        assertEquals(5, challenge().attemptsLeft());
    }

    @Test
    void acceptsACodeJustBeforeItExpires() {
        String code = challenge().issue(Channel.SMS, OtpChallenge.newCode());
        now = now.plus(Duration.ofMinutes(10)).minusMillis(1);

        assertEquals(new OtpChallenge.Verification.Valid(), challenge().verify(code));
    }

    @Test
    void rejectsMalformedInputAsAWrongCode() {
        challenge().issue(Channel.SMS, OtpChallenge.newCode());

        assertEquals(new OtpChallenge.Verification.Invalid(4), challenge().verify("12a"));
        assertEquals(new OtpChallenge.Verification.Invalid(3), challenge().verify(null));
    }

    @Test
    void firstSendNeedsNoCooldownThenResendWaitsSixtySeconds() {
        assertEquals(OtpChallenge.SendDecision.ALLOWED, challenge().canResend());
        challenge().issue(Channel.SMS, OtpChallenge.newCode());

        assertEquals(OtpChallenge.SendDecision.COOLDOWN, challenge().canResend());
        assertEquals(Optional.of(now.plusSeconds(60)), challenge().resendAvailableAt());

        now = now.plusSeconds(60);
        assertEquals(OtpChallenge.SendDecision.ALLOWED, challenge().canResend());
        assertEquals(Optional.empty(), challenge().resendAvailableAt());
    }

    @Test
    void aNewCodeReplacesTheOldOne() {
        String first = challenge().issue(Channel.SMS, OtpChallenge.newCode());
        now = now.plusSeconds(60);
        String second = challenge().issue(Channel.SMS, OtpChallenge.newCode());

        if (!first.equals(second)) {
            assertEquals(new OtpChallenge.Verification.Invalid(4), challenge().verify(first));
        }
        assertEquals(new OtpChallenge.Verification.Valid(), challenge().verify(second));
    }

    @Test
    void allowsThreeResendsThenEndsTheSignIn() {
        challenge().issue(Channel.SMS, OtpChallenge.newCode());
        assertEquals(3, challenge().resendsLeft());
        for (int left = 2; left >= 0; left--) {
            now = now.plusSeconds(60);
            assertEquals(OtpChallenge.SendDecision.ALLOWED, challenge().canResend());
            challenge().issue(Channel.SMS, OtpChallenge.newCode());
            assertEquals(left, challenge().resendsLeft());
        }

        now = now.plusSeconds(60);
        assertEquals(OtpChallenge.SendDecision.EXHAUSTED, challenge().canResend());
        assertEquals(OtpChallenge.SendDecision.EXHAUSTED, challenge().canSwitchChannel());
    }

    @Test
    void switchingChannelSkipsTheCooldownButCountsAsAResend() {
        challenge().issue(Channel.SMS, OtpChallenge.newCode());

        assertEquals(OtpChallenge.SendDecision.ALLOWED, challenge().canSwitchChannel());
        challenge().issue(Channel.EMAIL, OtpChallenge.newCode());

        assertEquals(Channel.EMAIL, challenge().channel().orElseThrow());
        assertEquals(2, challenge().resendsLeft());
    }

    @Test
    void wrongCodesCountAcrossResends() {
        String code = challenge().issue(Channel.SMS, OtpChallenge.newCode());
        String wrong = code.equals("000000") ? "111111" : "000000";
        challenge().verify(wrong);
        now = now.plusSeconds(60);
        String next = challenge().issue(Channel.SMS, OtpChallenge.newCode());

        assertEquals(4, challenge().attemptsLeft());
        assertNotEquals(null, next);
    }

    @Test
    void startsWithFullAllowances() {
        OtpChallenge fresh = challenge();

        assertEquals(5, fresh.attemptsLeft());
        assertEquals(3, fresh.resendsLeft());
        assertTrue(fresh.channel().isEmpty());
        assertFalse(fresh.hasLiveCode());
        assertNull(store.get("anything"));
    }

    @Test
    void knowsWhetherALiveCodeIsOutstanding() {
        challenge().issue(Channel.SMS, OtpChallenge.newCode());
        assertTrue(challenge().hasLiveCode());

        now = now.plus(Duration.ofMinutes(10));
        assertFalse(challenge().hasLiveCode());
    }

    @Test
    void failedSendsUseUpResendsSoRetriesAreBounded() {
        challenge().recordFailedSend();
        assertTrue(challenge().anySendAttempted());
        assertEquals(3, challenge().resendsLeft());

        for (int i = 0; i < 3; i++) {
            assertEquals(OtpChallenge.SendDecision.ALLOWED, challenge().canSwitchChannel());
            challenge().recordFailedSend();
        }

        assertEquals(0, challenge().resendsLeft());
        assertEquals(OtpChallenge.SendDecision.EXHAUSTED, challenge().canResend());
        assertEquals(OtpChallenge.SendDecision.EXHAUSTED, challenge().canSwitchChannel());
    }

    @Test
    void aFailedSendStartsNoCooldown() {
        challenge().recordFailedSend();

        assertEquals(Optional.empty(), challenge().resendAvailableAt());
        assertEquals(OtpChallenge.SendDecision.ALLOWED, challenge().canResend());
    }

    @Test
    void rulesRejectLifetimesTheTemplatesCannotQuote() {
        assertThrows(IllegalArgumentException.class,
                () -> new OtpRules(Duration.ofMinutes(61), 5, Duration.ofSeconds(60), 3));
        new OtpRules(Duration.ofMinutes(60), 5, Duration.ofSeconds(60), 3);
    }

    private record MapNotes(Map<String, String> map) implements OtpChallenge.Notes {
        @Override
        public String get(String key) {
            return map.get(key);
        }

        @Override
        public void set(String key, String value) {
            map.put(key, value);
        }

        @Override
        public void remove(String key) {
            map.remove(key);
        }
    }
}
