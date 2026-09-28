package ke.go.adili.keycloak.otp;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import org.jboss.logging.Logger;
import org.keycloak.util.JsonSerialization;

/** {@link NotificationsClient} over HTTP with a service token (notifications.yaml `sendMessage`). */
public final class HttpNotificationsClient implements NotificationsClient {

    private static final Logger LOG = Logger.getLogger(HttpNotificationsClient.class);

    private final URI messagesUrl;
    private final ServiceTokens tokens;
    private final Duration timeout;
    private final HttpClient http;

    /** `baseUrl` is the notifications service origin, e.g. `http://notifications:4010`. */
    public HttpNotificationsClient(URI baseUrl, ServiceTokens tokens, Duration timeout) {
        this.messagesUrl = baseUrl.resolve("/internal/v1/messages");
        this.tokens = tokens;
        this.timeout = timeout;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).build();
    }

    @Override
    public boolean send(Channel channel, String to, String code, int expiresInMinutes) {
        try {
            String body = JsonSerialization.writeValueAsString(Map.of(
                    "channel", channel.wireName(),
                    "recipient", Map.of("kind", "address", "to", to),
                    "template", channel.template(),
                    "params", Map.of("code", code, "expiresInMinutes", expiresInMinutes)));
            Optional<HttpResponse<String>> response = post(body);
            if (response.isPresent() && response.get().statusCode() == 401) {
                // The token was refused (e.g. keys rotated), so the message was not processed and
                // posting it again cannot send it twice: fetch a new token and try once more.
                response = post(body);
            }
            if (response.isEmpty()) {
                LOG.warnf("Sign-in code not sent by %s: no service token for notifications", channel.wireName());
                return false;
            }
            int status = response.get().statusCode();
            if (status != 201) {
                LOG.warnf("Sign-in code not sent by %s: notifications answered %d", channel.wireName(), status);
                return false;
            }
            JsonNode message = JsonSerialization.readValue(response.get().body(), JsonNode.class);
            boolean sent = "sent".equals(message.path("status").asText());
            if (!sent) {
                // The recipient is never logged; the message id lets support find the reason.
                LOG.warnf("Sign-in code not sent by %s: provider failure (message %s)",
                        channel.wireName(), message.path("id").asText("?"));
            }
            return sent;
        } catch (IOException e) {
            LOG.warnf("Sign-in code not sent by %s: %s", channel.wireName(), e.getClass().getSimpleName());
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private Optional<HttpResponse<String>> post(String body) throws IOException, InterruptedException {
        Optional<String> token = tokens.current();
        if (token.isEmpty()) {
            return Optional.empty();
        }
        HttpRequest request = HttpRequest.newBuilder(messagesUrl)
                .timeout(timeout)
                .header("Authorization", "Bearer " + token.get())
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 401) {
            tokens.invalidate(token.get());
        }
        return Optional.of(response);
    }
}
