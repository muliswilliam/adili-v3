package ke.go.adili.keycloak.otp;

import java.util.Optional;
import org.keycloak.models.UserModel;

/**
 * Where a user's codes can go: the `phone` attribute (E.164) and the account email. The OTP page
 * shows them masked, with only enough for the user to recognise them.
 */
public record Contacts(Optional<String> phone, Optional<String> email) {

    static final String PHONE_ATTRIBUTE = "phone";

    public static Contacts of(UserModel user) {
        return new Contacts(
                Optional.ofNullable(user.getFirstAttribute(PHONE_ATTRIBUTE)).filter(s -> !s.isBlank()),
                Optional.ofNullable(user.getEmail()).filter(s -> !s.isBlank()));
    }

    public Optional<String> destination(Channel channel) {
        return channel == Channel.SMS ? phone : email;
    }

    public Optional<String> masked(Channel channel) {
        return channel == Channel.SMS ? phone.map(Contacts::maskPhone) : email.map(Contacts::maskEmail);
    }

    /** SMS when the user has a phone, else email. */
    public Channel preferred() {
        return phone.isPresent() ? Channel.SMS : Channel.EMAIL;
    }

    /** `+254712345678` becomes `07** *** 678`; other E.164 numbers keep their country code. */
    public static String maskPhone(String e164) {
        String digits = e164.replaceAll("\\D", "");
        String lastThree = digits.substring(Math.max(0, digits.length() - 3));
        if (digits.startsWith("254") && digits.length() == 12) {
            return "0" + digits.charAt(3) + "** *** " + lastThree;
        }
        int countryCodeLength = Math.min(2, Math.max(0, digits.length() - 3));
        return "+" + digits.substring(0, countryCodeLength) + "** *** " + lastThree;
    }

    /** `jane.wanjiru@gmail.com` becomes `j***@gmail.com`. */
    public static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at < 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
