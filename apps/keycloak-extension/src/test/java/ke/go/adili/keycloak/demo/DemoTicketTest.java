package ke.go.adili.keycloak.demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class DemoTicketTest {

    private static final String SECRET = "test-demo-ticket-secret";
    private static final String NONCE = "n0nce-n0nce-n0nce-1";
    private static final Duration LIFETIME = Duration.ofSeconds(120);
    private final Instant now = Instant.parse("2026-10-09T08:00:00Z");

    private DemoTicket.Verification verify(String ticket) {
        return DemoTicket.verify(ticket, SECRET, now, LIFETIME);
    }

    @Test
    void acceptsAFreshTicketAndNamesItsKey() {
        String ticket = DemoTicket.mint("reviewer", NONCE, now.plusSeconds(60), SECRET);

        assertEquals(new DemoTicket.Verification.Valid("reviewer", NONCE, now.plusSeconds(60)), verify(ticket));
    }

    @Test
    void acceptsATicketTheAppsMint() {
        // mintDemoTicket in packages/demo-auth, with the same secret, nonce and time.
        String ticket = "v1.eyJrIjoid2FuamlrdSIsImV4cCI6MTc5MTUzMjg2MCwibiI6Im4wbmNlLW4wbmNlLW4wbmNlLTEifQ"
                + ".uMA4wIl0eEfNO42lwlEfNFmB0X94chvhyhtTtAVIgRI";

        assertEquals(new DemoTicket.Verification.Valid("wanjiku", NONCE, now.plusSeconds(60)), verify(ticket));
    }

    @Test
    void refusesAnotherSecretsSignature() {
        String ticket = DemoTicket.mint("reviewer", NONCE, now.plusSeconds(60), "another-secret");

        assertInstanceOf(DemoTicket.Verification.BadSignature.class, verify(ticket));
    }

    @Test
    void refusesAnEditedPayload() {
        String ticket = DemoTicket.mint("reviewer", NONCE, now.plusSeconds(60), SECRET);
        String[] parts = ticket.split("\\.");
        String other = DemoTicket.mint("platform-admin", NONCE, now.plusSeconds(60), SECRET).split("\\.")[1];

        assertInstanceOf(DemoTicket.Verification.BadSignature.class, verify(parts[0] + "." + other + "." + parts[2]));
    }

    @Test
    void refusesAnExpiredTicket() {
        assertInstanceOf(DemoTicket.Verification.Expired.class,
                verify(DemoTicket.mint("reviewer", NONCE, now, SECRET)));
    }

    @Test
    void refusesATicketValidForLongerThanTheLifetime() {
        assertInstanceOf(DemoTicket.Verification.TooLongLived.class,
                verify(DemoTicket.mint("reviewer", NONCE, now.plus(Duration.ofHours(1)), SECRET)));
    }

    @Test
    void refusesMalformedTickets() {
        for (String ticket : new String[] {
            null, "", "v1.abc", "v2.e30.e30", "v1.!!!.???", DemoTicket.mint("Reviewer!", NONCE, now.plusSeconds(60), SECRET),
            DemoTicket.mint("reviewer", "short", now.plusSeconds(60), SECRET)
        }) {
            assertInstanceOf(DemoTicket.Verification.Malformed.class, verify(ticket), String.valueOf(ticket));
        }
    }

    @Test
    void refusesEveryTicketWithoutASecret() {
        String ticket = DemoTicket.mint("reviewer", NONCE, now.plusSeconds(60), SECRET);

        assertInstanceOf(DemoTicket.Verification.Malformed.class, DemoTicket.verify(ticket, null, now, LIFETIME));
        assertInstanceOf(DemoTicket.Verification.Malformed.class, DemoTicket.verify(ticket, " ", now, LIFETIME));
    }
}
