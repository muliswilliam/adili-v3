package ke.go.adili.keycloak.otp;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ContactsTest {

    @Test
    void masksAKenyanMobileInLocalFormat() {
        assertEquals("07** *** 678", Contacts.maskPhone("+254712345678"));
        assertEquals("01** *** 004", Contacts.maskPhone("+254110000004"));
    }

    @Test
    void masksOtherNumbersKeepingTheCountryCodeAndLastThreeDigits() {
        assertEquals("+44** *** 789", Contacts.maskPhone("+447700900789"));
    }

    @Test
    void masksAnEmailKeepingTheFirstLetterAndDomain() {
        assertEquals("j***@gmail.com", Contacts.maskEmail("jane.wanjiru@gmail.com"));
        assertEquals("d***@demo.adili.go.ke", Contacts.maskEmail("declarant@demo.adili.go.ke"));
    }

    @Test
    void masksAnEmailWithoutAnAtSign() {
        assertEquals("***", Contacts.maskEmail("nonsense"));
    }
}
