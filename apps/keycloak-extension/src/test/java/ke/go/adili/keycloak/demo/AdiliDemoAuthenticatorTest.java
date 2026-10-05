package ke.go.adili.keycloak.demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.sessions.AuthenticationSessionModel;

class AdiliDemoAuthenticatorTest {

    private final List<String> calls = new ArrayList<>();

    /** A flow context that records the calls made on it; `ticket` is the authorize request's. */
    private AuthenticationFlowContext context(String ticket) {
        AuthenticationSessionModel authSession = (AuthenticationSessionModel) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {AuthenticationSessionModel.class}, (proxy, method, args) -> {
                    calls.add("authSession." + method.getName());
                    return method.getName().equals("getClientNote") ? ticket : null;
                });
        return (AuthenticationFlowContext) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {AuthenticationFlowContext.class}, (proxy, method, args) -> {
                    calls.add(method.getName());
                    return method.getName().equals("getAuthenticationSession") ? authSession : null;
                });
    }

    @Test
    void isInertWithoutDemoMode() {
        for (Map<String, String> env : List.of(Map.<String, String>of(), Map.of("ADILI_DEMO_MODE", "false"))) {
            calls.clear();
            new AdiliDemoAuthenticator(env::get).authenticate(context("v1.any.ticket"));

            // Never reads the ticket: straight on to the normal sign-in.
            assertEquals(List.of("attempted"), calls);
        }
    }

    @Test
    void goesOnToTheNormalSignInWithoutATicket() {
        new AdiliDemoAuthenticator(Map.of("ADILI_DEMO_MODE", "true")::get).authenticate(context(null));

        assertEquals(List.of("getAuthenticationSession", "authSession.getClientNote", "attempted"), calls);
    }
}
