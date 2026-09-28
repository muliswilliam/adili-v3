package ke.go.adili.keycloak.otp;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
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
import org.keycloak.services.managers.AuthenticationManager;
import org.keycloak.util.JsonSerialization;
import org.keycloak.sessions.AuthenticationSessionModel;

/**
 * The second factor for declarants and applicants: a 6-digit code sent by SMS (email as fallback
 * or on request)
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

    /** Page attributes and their values beyond the plain state (see adili-otp.ts). */
    static final String ATTRIBUTE_OTP_ERROR = "otpError";
    static final String OTP_ERROR_INVALID = "invalid";
    static final String OTP_ERROR_EXPIRED = "expired";
    static final String ATTRIBUTE_SEND_FAILED = "sendFailed";
    static final String SEND_FAILED_BOTH = "both";

    static final String MESSAGE_TOO_MANY_ATTEMPTS = "adiliOtpTooManyAttempts";
    static final String MESSAGE_TOO_MANY_RESENDS = "adiliOtpTooManyResends";

    /** Channels whose last send failed since the last code went out. */
    private static final String FAILED_CHANNELS_NOTE = "adili-otp.failed-channels";

    /**
     * The auth note Keycloak's authentication processor reads the forwarded error from when it
     * renders the next form. A reset re-runs the flow in the same request, so the login page reads
     * it at once; `LoginActionsService.FORWARDED_ERROR_MESSAGE_NOTE` would only apply on the next
     * request. Not public API: the stack tests (S22) catch a change.
     */
    private static final String FORWARDED_ERROR_NOTE = "fwMessageError";

    /** Authenticators that ask for the password; see {@link #isStepUp}. */
    private static final Set<String> PASSWORD_AUTHENTICATORS = Set.of("auth-username-password-form", "auth-password-form");

    /** The execution's settings and a notifications client for them. */
    record Setup(OtpSettings settings, NotificationsClient notifications) {}

    private final Function<AuthenticationFlowContext, Setup> setup;

    /** `setup` resolves the execution's config per request, since one instance serves any execution. */
    AdiliOtpAuthenticator(Function<AuthenticationFlowContext, Setup> setup) {
        this.setup = setup;
    }

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        SignIn signIn = new SignIn(context, setup.apply(context));
        // Only the first visit sends: a reload or the back button shows the current state, and
        // every later code goes through the resend and switch rules.
        if (signIn.challenge.anySendAttempted()) {
            signIn.showCurrent();
        } else {
            signIn.send(signIn.contacts.preferred());
        }
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        SignIn signIn = new SignIn(context, setup.apply(context));
        MultivaluedMap<String, String> form = context.getHttpRequest().getDecodedFormParameters();
        switch (Optional.ofNullable(form.getFirst(FIELD_ACTION)).orElse(ACTION_VERIFY)) {
            case ACTION_RESEND -> signIn.sendAgain(signIn.current());
            case ACTION_SEND_SMS -> signIn.sendAgain(Channel.SMS);
            case ACTION_SEND_EMAIL -> signIn.sendAgain(Channel.EMAIL);
            default -> signIn.verify(form.getFirst(FIELD_CODE));
        }
    }

    /** One request's view of the sign-in: its settings, code state and the user's contacts. */
    private static final class SignIn {
        private final AuthenticationFlowContext context;
        private final Setup setup;
        private final AuthenticationSessionModel authSession;
        private final OtpChallenge challenge;
        private final Contacts contacts;

        SignIn(AuthenticationFlowContext context, Setup setup) {
            this.context = context;
            this.setup = setup;
            this.authSession = context.getAuthenticationSession();
            this.contacts = Contacts.of(context.getUser());
            // Keycloak's clock, so the server's time offset (used in tests) applies.
            this.challenge = new OtpChallenge(
                    new AuthNotes(authSession),
                    setup.settings().rules(),
                    () -> Instant.ofEpochMilli(Time.currentTimeMillis()));
        }

        /** The channel of the last code, else the one the first code goes to. */
        Channel current() {
            return challenge.channel().orElse(contacts.preferred());
        }

        void showCurrent() {
            Set<Channel> failed = failedChannels();
            if (!challenge.hasLiveCode() && !failed.isEmpty()) {
                Channel channel = failed.contains(current()) ? current() : failed.iterator().next();
                context.challenge(sendFailedPage(channel, failed));
            } else {
                context.challenge(codePage(current()));
            }
        }

        void verify(String code) {
            Channel current = current();
            switch (challenge.verify(code)) {
                case OtpChallenge.Verification.Valid valid -> {
                    context.getEvent().detail("otp_channel", current.wireName());
                    context.success();
                }
                case OtpChallenge.Verification.Invalid invalid -> {
                    context.getEvent().user(context.getUser()).error(Errors.INVALID_USER_CREDENTIALS);
                    // Counts towards the realm's brute-force protection like a wrong password.
                    context.failureChallenge(
                            AuthenticationFlowError.INVALID_CREDENTIALS,
                            page(current).setAttribute(ATTRIBUTE_OTP_ERROR, OTP_ERROR_INVALID).createForm(FORM));
                }
                case OtpChallenge.Verification.Expired expired -> {
                    // Not a guess: neither an attempt here nor a brute-force failure.
                    context.getEvent().user(context.getUser()).error(Errors.EXPIRED_CODE);
                    context.challenge(
                            page(current).setAttribute(ATTRIBUTE_OTP_ERROR, OTP_ERROR_EXPIRED).createForm(FORM));
                }
                case OtpChallenge.Verification.Locked locked -> {
                    context.getEvent().user(context.getUser()).error(Errors.INVALID_USER_CREDENTIALS);
                    // The last wrong code ends the sign-in instead of failing it, so count it here.
                    if (context.getRealm().isBruteForceProtected()) {
                        context.getProtector().failedLogin(
                                context.getRealm(), context.getUser(), context.getConnection(), context.getUriInfo(),
                                Set.of(AdiliOtpAuthenticatorFactory.REFERENCE_CATEGORY));
                    }
                    restart(MESSAGE_TOO_MANY_ATTEMPTS);
                }
                case OtpChallenge.Verification.NoCode none -> context.challenge(codePage(current));
            }
        }

        /**
         * A new code on `channel`: "Resend code", "Send it by email (or SMS) instead", or trying
         * again after a failed send. All wait out the same cooldown and use up a resend.
         */
        void sendAgain(Channel channel) {
            if (contacts.destination(channel).isEmpty()) {
                // A forged request: the page offers only channels the user has.
                context.challenge(codePage(current()));
                return;
            }
            switch (challenge.canSendAgain()) {
                case ALLOWED -> send(channel);
                // The page disables these during the cooldown; a stale page just shows it again.
                case COOLDOWN -> context.challenge(codePage(current()));
                case EXHAUSTED -> restart(MESSAGE_TOO_MANY_RESENDS);
            }
        }

        /**
         * Sends a new code on `channel` and shows the code page. A failed send uses up a resend
         * (the provider may have delivered it), keeps any older code working and shows which
         * channel failed, or `both` once each has.
         */
        void send(Channel channel) {
            Optional<String> to = contacts.destination(channel);
            String code = OtpChallenge.newCode();
            if (to.isPresent()
                    && setup.notifications().send(channel, to.get(), code, setup.settings().expiresInMinutes())) {
                challenge.issue(channel, code);
                authSession.removeAuthNote(FAILED_CHANNELS_NOTE);
                context.challenge(codePage(channel));
                return;
            }
            challenge.recordFailedSend();
            Set<Channel> failed = failedChannels();
            failed.add(channel);
            authSession.setAuthNote(
                    FAILED_CHANNELS_NOTE, String.join(",", failed.stream().map(Channel::name).toList()));
            context.challenge(sendFailedPage(channel, failed));
        }

        /**
         * Stops this sign-in and returns to the login page with `message` (a theme message key).
         * A step-up has no password step to fall back on: the reset would pass the session cookie
         * and start a fresh round of codes, so the session is ended first and the user signs in
         * again with their password.
         */
        void restart(String message) {
            if (isStepUp()) {
                KeycloakSession session = context.getSession();
                AuthenticationManager.AuthResult cookie =
                        AuthenticationManager.authenticateIdentityCookie(session, context.getRealm(), true);
                if (cookie != null) {
                    AuthenticationManager.backchannelLogout(session, cookie.session(), true);
                }
                AuthenticationManager.expireIdentityCookie(session);
            }
            context.resetFlow(() -> {
                try {
                    authSession.setAuthNote(
                            FORWARDED_ERROR_NOTE,
                            JsonSerialization.writeValueAsString(new FormMessage(null, message)));
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
        }

        private Response codePage(Channel channel) {
            return page(channel).createForm(FORM);
        }

        private Response sendFailedPage(Channel channel, Set<Channel> failed) {
            String sendFailed =
                    failed.containsAll(EnumSet.allOf(Channel.class)) ? SEND_FAILED_BOTH : channel.wireName();
            return page(channel).setAttribute(ATTRIBUTE_SEND_FAILED, sendFailed).createForm(FORM);
        }

        /** The code page for the current state; callers add error attributes before building. */
        private LoginFormsProvider page(Channel channel) {
            LoginFormsProvider form = context.form()
                    .setAttribute("channel", channel.wireName())
                    .setAttribute("maskedDestination", contacts.masked(channel).orElse(""))
                    .setAttribute("attemptsLeft", challenge.attemptsLeft())
                    .setAttribute("resendsLeft", challenge.resendsLeft())
                    .setAttribute("codeLifetimeMinutes", setup.settings().expiresInMinutes());
            contacts.masked(channel.other()).ifPresent(other -> form.setAttribute("alternativeDestination", other));
            challenge.resendAvailableAt().ifPresent(at -> form.setAttribute("resendAvailableAt", at.toString()));
            if (isStepUp()) {
                form.setAttribute("isStepUp", true);
            }
            return form;
        }

        /**
         * True when no password was asked in this sign-in: the user came back with a session
         * (cookie) and a higher level was requested, so only this step runs.
         */
        private boolean isStepUp() {
            RealmModel realm = context.getRealm();
            return authSession.getExecutionStatus().entrySet().stream()
                    .filter(entry -> entry.getValue() == AuthenticationSessionModel.ExecutionStatus.SUCCESS)
                    .map(entry -> realm.getAuthenticationExecutionById(entry.getKey()))
                    // Sub-flow executions have no authenticator.
                    .filter(execution -> execution != null && execution.getAuthenticator() != null)
                    .noneMatch(execution -> PASSWORD_AUTHENTICATORS.contains(execution.getAuthenticator()));
        }

        private Set<Channel> failedChannels() {
            Set<Channel> failed = EnumSet.noneOf(Channel.class);
            String note = authSession.getAuthNote(FAILED_CHANNELS_NOTE);
            if (note != null && !note.isBlank()) {
                for (String name : note.split(",")) {
                    failed.add(Channel.valueOf(name));
                }
            }
            return failed;
        }
    }

    /** The code state lives in the authentication session's notes (shared across nodes). */
    private record AuthNotes(AuthenticationSessionModel authSession) implements OtpChallenge.Notes {
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
