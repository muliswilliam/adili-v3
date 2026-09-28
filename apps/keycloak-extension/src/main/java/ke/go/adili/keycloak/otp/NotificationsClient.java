package ke.go.adili.keycloak.otp;

/** Sends sign-in codes through the notifications service (`POST /internal/v1/messages`). */
public interface NotificationsClient {

    /**
     * Sends `code` to `to` with the channel's login template. Returns whether the provider took
     * the message. Never throws for delivery problems: an outage is `false`, and the page offers
     * the other channel.
     */
    boolean send(Channel channel, String to, String code, int expiresInMinutes);
}
