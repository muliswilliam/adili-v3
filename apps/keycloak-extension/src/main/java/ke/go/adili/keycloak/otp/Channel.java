package ke.go.adili.keycloak.otp;

import java.util.Locale;

/** Where a sign-in code goes. Names match the theme's `OtpChannel` (`sms`, `email`). */
public enum Channel {
    SMS("login-otp-sms"),
    EMAIL("login-otp-email");

    private final String template;

    Channel(String template) {
        this.template = template;
    }

    /** The notifications template that carries the code on this channel. */
    public String template() {
        return template;
    }

    /** The value the theme and the notifications API use: `sms` or `email`. */
    public String wireName() {
        return name().toLowerCase(Locale.ROOT);
    }

    public Channel other() {
        return this == SMS ? EMAIL : SMS;
    }
}
