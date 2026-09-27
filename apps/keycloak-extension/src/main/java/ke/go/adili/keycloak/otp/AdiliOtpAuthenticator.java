package ke.go.adili.keycloak.otp;

import jakarta.ws.rs.core.MultivaluedMap;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.common.util.Time;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.FormMessage;
import org.keycloak.util.JsonSerialization;
import org.keycloak.sessions.AuthenticationSessionModel;

/**
 * The declarant's second factor: a 6-digit code sent by SMS (email as fallback or on request)
 * through the notifications service, entered on the theme's `login-adili-otp.ftl`.
 *
 * <p>The page contract (attributes set here, fields posted back) is documented in
 * apps/keycloak-theme/src/login/adili-otp.ts; change both together. The authenticator knows nothing
 * of levels of authentication: the realm puts it in a LoA 2 sub-flow, so a step-up request re-runs
 * only this step, and the page is told (`isStepUp`) that no password was asked.
 */
public final class AdiliOtpAuthenticator implements Authenticator {

    static final String FORM = "login-adili-otp.ftl";

    static final String FIELD_CODE = "otp";
    static final String FIELD_ACTION = "action";
    static final String ACTION_VERIFY = "verify";
    static final String ACTION_RESEND = "resend";
    static final String ACTION_SEND_SMS = "send-sms";
    static final String ACTION_SEND_EMAIL = "send-email";

    static final String MESSAGE_TOO_MANY_ATTEMPTS = "adiliOtpTooManyAttempts";
    static final String MESSAGE_TOO_MANY_RESENDS = "adiliOtpTooManyResends";

    /** Channels whose last send failed since the last code went out. */
    private static final String FAILED_CHANNELS_NOTE = "adili-otp.failed-channels";

    /** The execution's settings and a notifications client for them. */
    record Setup(OtpSettings settings, NotificationsClient notifications) {}

    private final Function<AuthenticationFlowContext, Setup> setup;

    /** `setup` resolves the execution's config per request, since one instance serves any execution. */
    AdiliOtpAuthenticator(Function<AuthenticationFlowContext, Setup> setup) {
        this.setup = setup;
    }

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        OtpChallenge challenge = challenge(context);
        // Coming back to the page (reload, back button) must not send another code.
        if (challenge.hasLiveCode()) {
            context.challenge(page(context, challenge, challenge.channel().orElseThrow()).createForm(FORM));
            return;
        }
        send(context, challenge, Contacts.of(context.getUser()).preferred());
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        OtpChallenge challenge = challenge(context);
        MultivaluedMap<String, String> form = context.getHttpRequest().getDecodedFormParameters();
        String action = Optional.ofNullable(form.getFirst(FIELD_ACTION)).orElse(ACTION_VERIFY);
        Channel current = challenge.channel().orElse(Contacts.of(context.getUser()).preferred());
        switch (action) {
            case ACTION_RESEND -> resend(context, challenge, current);
            case ACTION_SEND_SMS -> switchTo(context, challenge, Channel.SMS, current);
            case ACTION_SEND_EMAIL -> switchTo(context, challenge, Channel.EMAIL, current);
            default -> verify(context, challenge, form.getFirst(FIELD_CODE), current);
        }
    }

    private void verify(AuthenticationFlowContext context, OtpChallenge challenge, String code, Channel current) {
        OtpChallenge.Verification result = challenge.verify(code);
        if (result instanceof OtpChallenge.Verification.Valid) {
            context.getEvent().detail("otp_channel", current.wireName());
            context.success();
        } else if (result instanceof OtpChallenge.Verification.Invalid) {
            context.getEvent().user(context.getUser()).error(Errors.INVALID_USER_CREDENTIALS);
            // Counts towards the realm's brute-force protection like a wrong password.
            context.failureChallenge(
                    AuthenticationFlowError.INVALID_CREDENTIALS,
                    page(context, challenge, current).setAttribute("otpError", "invalid").createForm(FORM));
        } else if (result instanceof OtpChallenge.Verification.Expired) {
            context.getEvent().user(context.getUser()).error(Errors.EXPIRED_CODE);
            context.failureChallenge(
                    AuthenticationFlowError.EXPIRED_CODE,
                    page(context, challenge, current).setAttribute("otpError", "expired").createForm(FORM));
        } else if (result instanceof OtpChallenge.Verification.Locked) {
            context.getEvent().user(context.getUser()).error(Errors.INVALID_USER_CREDENTIALS);
            restart(context, MESSAGE_TOO_MANY_ATTEMPTS);
        } else {
            context.challenge(page(context, challenge, current).createForm(FORM));
        }
    }

    private void resend(AuthenticationFlowContext context, OtpChallenge challenge, Channel current) {
        switch (challenge.canResend()) {
            case ALLOWED -> send(context, challenge, current);
            // The page disables the button during the cooldown; a stale page just shows it again.
            case COOLDOWN -> context.challenge(page(context, challenge, current).createForm(FORM));
            case EXHAUSTED -> restart(context, MESSAGE_TOO_MANY_RESENDS);
        }
    }

    private void switchTo(AuthenticationFlowContext context, OtpChallenge challenge, Channel channel, Channel current) {
        if (Contacts.of(context.getUser()).destination(channel).isEmpty()) {
            // A forged request: the page offers only channels the user has.
            context.challenge(page(context, challenge, current).createForm(FORM));
            return;
        }
        switch (challenge.canSwitchChannel()) {
            case ALLOWED, COOLDOWN -> send(context, challenge, channel);
            case EXHAUSTED -> restart(context, MESSAGE_TOO_MANY_RESENDS);
        }
    }

    /**
     * Sends a new code on `channel` and shows the code page. When the send fails, the old code (if
     * any) keeps working and the page says which channel failed, or `both` once each has failed.
     */
    private void send(AuthenticationFlowContext context, OtpChallenge challenge, Channel channel) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        Optional<String> to = Contacts.of(context.getUser()).destination(channel);
        String code = OtpChallenge.newCode();
        Setup resolved = setup.apply(context);
        if (to.isPresent()
                && resolved.notifications().send(channel, to.get(), code, resolved.settings().expiresInMinutes())) {
            challenge.issue(channel, code);
            authSession.removeAuthNote(FAILED_CHANNELS_NOTE);
            context.challenge(page(context, challenge, channel).createForm(FORM));
            return;
        }
        Set<Channel> failed = failedChannels(authSession);
        failed.add(channel);
        authSession.setAuthNote(
                FAILED_CHANNELS_NOTE, String.join(",", failed.stream().map(Channel::name).toList()));
        String sendFailed = failed.containsAll(EnumSet.allOf(Channel.class)) ? "both" : channel.wireName();
        context.challenge(page(context, challenge, channel).setAttribute("sendFailed", sendFailed).createForm(FORM));
    }

    /**
     * The auth note Keycloak's authentication processor reads the forwarded error from when it
     * renders the next form. A reset re-runs the flow in the same request, so the login page reads
     * it at once; `LoginActionsService.FORWARDED_ERROR_MESSAGE_NOTE` would only apply on the next
     * request. Not public API: the stack tests (S22) catch a change.
     */
    private static final String FORWARDED_ERROR_NOTE = "fwMessageError";

    /** Stops this sign-in and returns to the login page with `message` (a theme message key). */
    private static void restart(AuthenticationFlowContext context, String message) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        context.resetFlow(() -> {
            try {
                authSession.setAuthNote(
                        FORWARDED_ERROR_NOTE, JsonSerialization.writeValueAsString(new FormMessage(null, message)));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        });
    }

    /** The code page for the current state; callers add error attributes before building. */
    private LoginFormsProvider page(AuthenticationFlowContext context, OtpChallenge challenge, Channel channel) {
        Contacts contacts = Contacts.of(context.getUser());
        LoginFormsProvider form = context.form()
                .setAttribute("channel", channel.wireName())
                .setAttribute("maskedDestination", contacts.masked(channel).orElse(""))
                .setAttribute("attemptsLeft", challenge.attemptsLeft())
                .setAttribute("resendsLeft", challenge.resendsLeft());
        contacts.masked(channel.other()).ifPresent(other -> form.setAttribute("alternativeDestination", other));
        challenge.resendAvailableAt().ifPresent(at -> form.setAttribute("resendAvailableAt", at.toString()));
        if (isStepUp(context)) {
            form.setAttribute("isStepUp", true);
        }
        return form;
    }

    /** Authenticators that ask for the password; see {@link #isStepUp}. */
    private static final Set<String> PASSWORD_AUTHENTICATORS = Set.of("auth-username-password-form", "auth-password-form");

    /**
     * True when no password was asked in this sign-in: the user came back with a session (cookie)
     * and a higher level was requested, so only this step runs.
     */
    private static boolean isStepUp(AuthenticationFlowContext context) {
        RealmModel realm = context.getRealm();
        return context.getAuthenticationSession().getExecutionStatus().entrySet().stream()
                .filter(entry -> entry.getValue() == AuthenticationSessionModel.ExecutionStatus.SUCCESS)
                .map(entry -> realm.getAuthenticationExecutionById(entry.getKey()))
                // Sub-flow executions have no authenticator.
                .filter(execution -> execution != null && execution.getAuthenticator() != null)
                .noneMatch(execution -> PASSWORD_AUTHENTICATORS.contains(execution.getAuthenticator()));
    }

    private OtpChallenge challenge(AuthenticationFlowContext context) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        OtpChallenge.Notes notes = new OtpChallenge.Notes() {
            @Override
            public String get(String key) {
                return authSession.getAuthNote(key);
            }

            @Override
            public void set(String key, String value) {
                authSession.setAuthNote(key, value);
            }

            @Override
            public void remove(String key) {
                authSession.removeAuthNote(key);
            }
        };
        // Keycloak's clock, so the server's time offset (used in tests) applies.
        return new OtpChallenge(
                notes, setup.apply(context).settings().rules(), () -> Instant.ofEpochMilli(Time.currentTimeMillis()));
    }

    private static Set<Channel> failedChannels(AuthenticationSessionModel authSession) {
        Set<Channel> failed = EnumSet.noneOf(Channel.class);
        String note = authSession.getAuthNote(FAILED_CHANNELS_NOTE);
        if (note != null && !note.isBlank()) {
            for (String name : note.split(",")) {
                failed.add(Channel.valueOf(name));
            }
        }
        return failed;
    }

    @Override
    public boolean requiresUser() {
        return true;
    }

    /** Anyone with a phone or an email can receive a code. */
    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        Contacts contacts = Contacts.of(user);
        return contacts.phone().isPresent() || contacts.email().isPresent();
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {}

    @Override
    public void close() {}
}
