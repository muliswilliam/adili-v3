package ke.go.adili.keycloak.otp;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.keycloak.util.JsonSerialization;

/**
 * Access tokens for the extension's own client (client credentials), reused until shortly before
 * they expire. Thread-safe; one instance serves every sign-in on the node.
 */
public final class ServiceTokens {

    /** Refresh this long before expiry so a token never expires in flight. */
    private static final Duration EARLY = Duration.ofSeconds(30);

    /**
     * After a failed fetch (wrong secret, unreachable endpoint), wait this long before trying
     * again, so a broken setup fails sends at once instead of queueing each behind a timeout.
     */
    private static final Duration RETRY_AFTER_FAILURE = Duration.ofSeconds(30);

    private final URI tokenUrl;
    private final String clientId;
    private final String clientSecret;
    private final Duration timeout;
    private final HttpClient http;

    private String token;
    private Instant expiresAt = Instant.MIN;
    private Instant nextAttemptAt = Instant.MIN;

    public ServiceTokens(URI tokenUrl, String clientId, String clientSecret, Duration timeout) {
        this.tokenUrl = tokenUrl;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.timeout = timeout;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
    }

    /**
     * A token valid for at least the next 30 seconds, or empty when none could be had. One fetch
     * at a time: callers arriving meanwhile wait for it and reuse its token.
     */
    public synchronized Optional<String> current() throws IOException, InterruptedException {
        Instant now = Instant.now();
        if ((token == null || !now.isBefore(expiresAt)) && !now.isBefore(nextAttemptAt)) {
            nextAttemptAt = now.plus(RETRY_AFTER_FAILURE);
            fetch();
            if (token != null) {
                nextAttemptAt = Instant.MIN;
            }
        }
        return token != null && Instant.now().isBefore(expiresAt) ? Optional.of(token) : Optional.empty();
    }

    /** Drops the cached token after the service rejected it (e.g. the signing key rotated). */
    public synchronized void invalidate(String rejected) {
        if (rejected.equals(token)) {
            token = null;
        }
    }

    private void fetch() throws IOException, InterruptedException {
        token = null;
        String form = "grant_type=client_credentials&client_id=" + encode(clientId) + "&client_secret=" + encode(clientSecret);
        HttpRequest request = HttpRequest.newBuilder(tokenUrl)
                .timeout(timeout)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            return;
        }
        JsonNode body = JsonSerialization.readValue(response.body(), JsonNode.class);
        String accessToken = body.path("access_token").asText(null);
        if (accessToken == null) {
            return;
        }
        token = accessToken;
        expiresAt = Instant.now().plusSeconds(body.path("expires_in").asLong(60)).minus(EARLY);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
