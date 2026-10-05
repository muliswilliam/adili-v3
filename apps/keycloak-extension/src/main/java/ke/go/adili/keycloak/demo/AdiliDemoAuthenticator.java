package ke.go.adili.keycloak.demo;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.authenticators.util.AcrStore;
import org.keycloak.common.util.Time;
import org.keycloak.models.AuthenticatorConfigModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.sessions.AuthenticationSessionModel;
import org.keycloak.util.JsonSerialization;
import org.keycloak.vault.VaultStringSecret;

/**
 * Signs a demo account in from a demo ticket, with no password or code (#616): the hackathon demo
 * switches roles in one click. Inert unless Keycloak runs with `ADILI_DEMO_MODE=true`, and only for
 * accounts that carry a `demo_key` attribute; anything else (no ticket, a bad, expired or reused
 * one, an unknown key) is `attempted`, so the flow goes on to the normal sign-in.
 *
 * <p>The realm places it as an alternative in the top-level browser flow, after the SSO cookie. It
 * records every level of authentication the realm maps (LoA 1 and 2), so the session satisfies
 * `acr=step-up` exactly as password plus code would, and a later step-up with a fresh ticket
 * passes the same way.
 */
public final class AdiliDemoAuthenticator implements Authenticator {

    static final String DEMO_MODE_ENV = "ADILI_DEMO_MODE";
    /** The authorize request's `demo_ticket` parameter, as Keycloak keeps it. */
    static final String TICKET_NOTE = "client_request_param_demo_ticket";
    public static final String DEMO_KEY_ATTRIBUTE = "demo_key";
    /** Marks the user session, and the login event, as a demo sign-in. */
    static final String SESSION_NOTE = "adili_demo";

    static final String TICKET_SECRET = "ticketSecret";
    static final String MAX_LIFETIME_SECONDS = "maxLifetimeSeconds";
    static final String DEFAULT_TICKET_SECRET = "${vault.demo-ticket-secret}";
    static final String DEFAULT_MAX_LIFETIME_SECONDS = "120";

    private static final Logger LOG = Logger.getLogger(AdiliDemoAuthenticator.class);

    private final Function<String, String> env;

    AdiliDemoAuthenticator(Function<String, String> env) {
        this.env = env;
    }

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        if (!"true".equalsIgnoreCase(env.apply(DEMO_MODE_ENV))) {
            context.attempted();
            return;
        }
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        String raw = authSession.getClientNote(TICKET_NOTE);
        if (raw == null || raw.isBlank()) {
            context.attempted();
            return;
        }
        // One ticket, one sign-in: a reload of the same authorize request must not reuse it.
        authSession.removeClientNote(TICKET_NOTE);

        KeycloakSession session = context.getSession();
        Map<String, String> config = config(context.getAuthenticatorConfig());
        Instant now = Instant.ofEpochMilli(Time.currentTimeMillis());
        DemoTicket.Verification verification = DemoTicket.verify(
                raw,
                secret(session, config.getOrDefault(TICKET_SECRET, DEFAULT_TICKET_SECRET)),
                now,
                Duration.ofSeconds(Long.parseLong(config.getOrDefault(MAX_LIFETIME_SECONDS, DEFAULT_MAX_LIFETIME_SECONDS))));
        if (!(verification instanceof DemoTicket.Verification.Valid valid)) {
            LOG.warnf("demo ticket refused: %s", verification.getClass().getSimpleName());
            context.attempted();
            return;
        }
        long ttl = Math.max(1, valid.expiresAt().getEpochSecond() - now.getEpochSecond() + 60);
        if (!session.singleUseObjects().putIfAbsent("adili-demo-ticket." + valid.nonce(), ttl)) {
            LOG.warnf("demo ticket refused: reused (key %s)", valid.demoKey());
            context.attempted();
            return;
        }
        UserModel user = demoUser(session, context.getRealm(), valid.demoKey());
        if (user == null) {
            LOG.warnf("demo ticket refused: no enabled account with demo key %s", valid.demoKey());
            context.attempted();
            return;
        }
        // A step-up keeps the signed-in user; a ticket for someone else never replaces them.
        if (context.getUser() != null && !context.getUser().getId().equals(user.getId())) {
            LOG.warnf("demo ticket refused: names %s, but %s is signed in", valid.demoKey(), context.getUser().getUsername());
            context.attempted();
            return;
        }
        context.setUser(user);
        AcrStore acr = new AcrStore(session, authSession);
        acrLevels(context.getRealm()).forEach(acr::setLevelAuthenticated);
        authSession.setUserSessionNote(SESSION_NOTE, valid.demoKey());
        context.getEvent().detail(SESSION_NOTE, valid.demoKey());
        context.success();
    }

    /** The one enabled user whose `demo_key` is `demoKey`, else null. */
    private static UserModel demoUser(KeycloakSession session, RealmModel realm, String demoKey) {
        List<UserModel> users = session.users()
                .searchForUserByUserAttributeStream(realm, DEMO_KEY_ATTRIBUTE, demoKey)
                .limit(2)
                .toList();
        if (users.size() != 1 || !users.get(0).isEnabled()) {
            return null;
        }
        return users.get(0);
    }

    /** The levels in the realm's `acr.loa.map`, lowest first, so the highest is current. */
    private static List<Integer> acrLevels(RealmModel realm) {
        String raw = realm.getAttribute("acr.loa.map");
        if (raw == null || raw.isBlank()) {
            return List.of(1);
        }
        try {
            Map<?, ?> map = JsonSerialization.readValue(raw, Map.class);
            List<Integer> levels = new ArrayList<>(List.of(1));
            for (Object level : map.values()) {
                int value = Integer.parseInt(String.valueOf(level));
                if (!levels.contains(value)) {
                    levels.add(value);
                }
            }
            levels.sort(Integer::compare);
            return levels;
        } catch (Exception e) {
            LOG.warnf("unreadable acr.loa.map %s; demo sign-in records LoA 1 only", raw);
            return List.of(1);
        }
    }

    private static Map<String, String> config(AuthenticatorConfigModel model) {
        if (model == null || model.getConfig() == null) {
            return Map.of();
        }
        return model.getConfig().entrySet().stream()
                .filter(e -> e.getValue() != null && !e.getValue().isBlank())
                .collect(Collectors.toMap(Map.Entry::getKey, e -> e.getValue().trim()));
    }

    private static String secret(KeycloakSession session, String raw) {
        try (VaultStringSecret secret = session.vault().getStringSecret(raw)) {
            // Empty when the vault lacks the entry: every ticket is then refused.
            return secret.get().orElse(null);
        }
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        context.attempted();
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {}

    @Override
    public void close() {}
}
