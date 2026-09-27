"""Pull a 6-digit demo OTP out of an SMS body."""

import re

from sms.models import Message

OTP_PATTERN = re.compile(r"\b(\d{6})\b")


def otp_from_message(message: Message) -> str | None:
    match = OTP_PATTERN.search(message.message)
    return match.group(1) if match else None
