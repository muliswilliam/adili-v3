package ke.go.adili.keycloak.otp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The client against a stand-in for Keycloak's token endpoint and the notifications API. */
class HttpNotificationsClientTest {

    private HttpServer server;
    private final List<String> messageBodies = new CopyOnWriteArrayList<>();
    private final List<String> authorizations = new CopyOnWriteArrayList<>();
    private final AtomicInteger tokensIssued = new AtomicInteger();
    private final AtomicInteger tokenRequests = new AtomicInteger();
    private volatile int messageStatus = 201;
    private volatile String messageOutcome = "sent";
    private volatile long messageDelayMs = 0;
    private volatile int rejectTokensUntil = 0;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/token", exchange -> {
            tokenRequests.incrementAndGet();
            String form = read(exchange);
            if (!form.contains("grant_type=client_credentials")
                    || !form.contains("client_id=keycloak-extension")
                    || !form.contains("client_secret=s3cret")) {
                respond(exchange, 401, "{\"error\":\"invalid_client\"}");
                return;
            }
            int n = tokensIssued.incrementAndGet();
            respond(exchange, 200, "{\"access_token\":\"token-" + n + "\",\"expires_in\":300,\"token_type\":\"Bearer\"}");
        });
        server.createContext("/internal/v1/messages", exchange -> {
            authorizations.add(exchange.getRequestHeaders().getFirst("Authorization"));
            messageBodies.add(read(exchange));
            if (tokensIssued.get() <= rejectTokensUntil) {
                respond(exchange, 401, "{\"status\":401}");
                return;
            }
            sleep(messageDelayMs);
            respond(exchange, messageStatus, "{\"id\":\"m1\",\"status\":\"" + messageOutcome + "\"}");
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private HttpNotificationsClient client(Duration timeout) {
        return client(timeout, "s3cret");
    }

    private HttpNotificationsClient client(Duration timeout, String secret) {
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        return new HttpNotificationsClient(
                URI.create(base),
                new ServiceTokens(URI.create(base + "/token"), "keycloak-extension", secret, timeout),
                timeout);
    }

    @Test
    void sendsTheTemplatedCodeWithAServiceToken() {
        boolean sent = client(Duration.ofSeconds(2)).send(Channel.SMS, "+254712345678", "482913", 10);

        assertTrue(sent);
        assertEquals(List.of("Bearer token-1"), authorizations);
        String body = messageBodies.get(0);
        assertTrue(body.contains("\"channel\":\"sms\""), body);
        assertTrue(body.contains("\"template\":\"login-otp-sms\""), body);
        assertTrue(body.contains("\"kind\":\"address\""), body);
        assertTrue(body.contains("\"to\":\"+254712345678\""), body);
        assertTrue(body.contains("\"code\":\"482913\""), body);
        assertTrue(body.contains("\"expiresInMinutes\":10"), body);
    }

    @Test
    void usesTheEmailTemplateOnTheEmailChannel() {
        client(Duration.ofSeconds(2)).send(Channel.EMAIL, "jane@example.go.ke", "482913", 10);

        assertTrue(messageBodies.get(0).contains("\"template\":\"login-otp-email\""));
        assertTrue(messageBodies.get(0).contains("\"channel\":\"email\""));
    }

    @Test
    void reusesTheTokenUntilItExpires() {
        HttpNotificationsClient client = client(Duration.ofSeconds(2));

        client.send(Channel.SMS, "+254712345678", "111111", 10);
        client.send(Channel.SMS, "+254712345678", "222222", 10);

        assertEquals(1, tokensIssued.get());
    }

    @Test
    void fetchesANewTokenOnceWhenTheOldOneIsRejected() {
        rejectTokensUntil = 1;

        boolean sent = client(Duration.ofSeconds(2)).send(Channel.SMS, "+254712345678", "111111", 10);

        assertTrue(sent);
        assertEquals(List.of("Bearer token-1", "Bearer token-2"), authorizations);
    }

    @Test
    void failsFastWithoutAskingForTokensAgainAfterARefusal() {
        HttpNotificationsClient client = client(Duration.ofSeconds(2), "wrong");

        assertFalse(client.send(Channel.SMS, "+254712345678", "111111", 10));
        assertFalse(client.send(Channel.SMS, "+254712345678", "222222", 10));

        assertEquals(1, tokenRequests.get());
        assertTrue(messageBodies.isEmpty());
    }

    @Test
    void reportsAProviderFailureAsNotSent() {
        messageOutcome = "failed";

        assertFalse(client(Duration.ofSeconds(2)).send(Channel.SMS, "+254712345678", "111111", 10));
    }

    @Test
    void reportsAnErrorStatusAsNotSent() {
        messageStatus = 503;

        assertFalse(client(Duration.ofSeconds(2)).send(Channel.SMS, "+254712345678", "111111", 10));
    }

    @Test
    void reportsATimeoutAsNotSent() {
        messageDelayMs = 1_000;

        assertFalse(client(Duration.ofMillis(200)).send(Channel.SMS, "+254712345678", "111111", 10));
    }

    @Test
    void reportsAnUnreachableServiceAsNotSent() {
        HttpNotificationsClient client = client(Duration.ofSeconds(1));
        server.stop(0);

        assertFalse(client.send(Channel.SMS, "+254712345678", "111111", 10));
    }

    private static String read(HttpExchange exchange) throws IOException {
        return new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
