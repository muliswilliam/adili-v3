package ke.go.adili.keycloak.demo;

import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.provider.ProviderConfigProperty;

/** Registers the `adili-demo` authenticator (see {@link AdiliDemoAuthenticator}). */
public final class AdiliDemoAuthenticatorFactory implements AuthenticatorFactory {

    public static final String PROVIDER_ID = "adili-demo";

    private static final AuthenticationExecutionModel.Requirement[] REQUIREMENTS = {
        AuthenticationExecutionModel.Requirement.ALTERNATIVE,
        AuthenticationExecutionModel.Requirement.DISABLED
    };

    private static final List<ProviderConfigProperty> PROPERTIES = List.of(
            secret(AdiliDemoAuthenticator.TICKET_SECRET, "Ticket secret",
                    "HMAC key shared with the apps that mint demo tickets. A vault expression.",
                    AdiliDemoAuthenticator.DEFAULT_TICKET_SECRET),
            new ProviderConfigProperty(AdiliDemoAuthenticator.MAX_LIFETIME_SECONDS, "Ticket lifetime (seconds)",
                    "Longest a ticket may be valid for.", ProviderConfigProperty.STRING_TYPE,
                    AdiliDemoAuthenticator.DEFAULT_MAX_LIFETIME_SECONDS));

    @Override
    public Authenticator create(KeycloakSession session) {
        return new AdiliDemoAuthenticator(System::getenv);
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getDisplayType() {
        return "Adili demo ticket (demo accounts only)";
    }

    @Override
    public String getReferenceCategory() {
        return "demo";
    }

    @Override
    public String getHelpText() {
        return "Signs a demo account in from a signed demo ticket. Inert unless ADILI_DEMO_MODE=true.";
    }

    @Override
    public boolean isConfigurable() {
        return true;
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return PROPERTIES;
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
    public void close() {}

    private static ProviderConfigProperty secret(String name, String label, String help, String defaultValue) {
        ProviderConfigProperty property = new ProviderConfigProperty(
                name, label, help, ProviderConfigProperty.PASSWORD, defaultValue);
        property.setSecret(true);
        return property;
    }
}
