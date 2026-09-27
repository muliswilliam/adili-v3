package ke.go.adili.keycloak.otp;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.jboss.logging.Logger;
import org.keycloak.Config;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.vault.VaultStringSecret;

/** Registers the `adili-otp` authenticator (see {@link AdiliOtpAuthenticator}). */
public final class AdiliOtpAuthenticatorFactory implements AuthenticatorFactory {

    public static final String PROVIDER_ID = "adili-otp";

    private static final Logger LOG = Logger.getLogger(AdiliOtpAuthenticatorFactory.class);

    private static final AuthenticationExecutionModel.Requirement[] REQUIREMENTS = {
        AuthenticationExecutionModel.Requirement.REQUIRED,
        AuthenticationExecutionModel.Requirement.ALTERNATIVE,
        AuthenticationExecutionModel.Requirement.DISABLED
    };

    /** One client per distinct configuration, so service tokens are reused across sign-ins. */
    private final Map<OtpSettings, NotificationsClient> clients = new ConcurrentHashMap<>();

    @Override
    public Authenticator create(KeycloakSession session) {
        return new AdiliOtpAuthenticator(this::setup);
    }

    private AdiliOtpAuthenticator.Setup setup(AuthenticationFlowContext context) {
        KeycloakSession session = context.getSession();
        OtpSettings settings = OtpSettings.from(
                context.getAuthenticatorConfig(),
                context.getRealm().getName(),
                System::getenv,
                raw -> {
                    try (VaultStringSecret secret = session.vault().getStringSecret(raw)) {
                        return secret.get().orElse(raw);
                    }
                });
        return new AdiliOtpAuthenticator.Setup(settings, clients.computeIfAbsent(settings, this::client));
    }

    private NotificationsClient client(OtpSettings settings) {
        if (settings.notificationsUrl().isBlank()) {
            LOG.errorf("adili-otp cannot send codes: set notificationsUrl or %s", OtpSettings.NOTIFICATIONS_URL_ENV);
            return (channel, to, code, expiresInMinutes) -> false;
        }
        return new HttpNotificationsClient(
                URI.create(settings.notificationsUrl()),
                new ServiceTokens(
                        URI.create(settings.tokenUrl()),
                        settings.clientId(),
                        settings.clientSecret(),
                        settings.requestTimeout()),
                settings.requestTimeout());
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getDisplayType() {
        return "Adili OTP (SMS or email)";
    }

    @Override
    public String getReferenceCategory() {
        return "otp";
    }

    @Override
    public String getHelpText() {
        return "Sends a 6-digit code by SMS, or email as fallback, through the Adili notifications service.";
    }

    @Override
    public boolean isConfigurable() {
        return true;
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return OtpSettings.PROPERTIES;
    }

    @Override
    public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
        return REQUIREMENTS;
    }

    @Override
    public boolean isUserSetupAllowed() {
        return false;
    }

    @Override
    public void init(Config.Scope config) {}

    @Override
    public void postInit(KeycloakSessionFactory factory) {}

    @Override
    public void close() {
        clients.clear();
    }
}
