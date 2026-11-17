"""Deterministic audio generated in memory; no private recordings or external tools."""
import io
import wave


def wav_bytes(value=0):
    result = io.BytesIO()
    with wave.open(result, 'wb') as audio:
        audio.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
        audio.writeframes(bytes([value, 0]) * 800)
    return result.getvalue()


def mp3_bytes():
    # Three complete MPEG1 Layer III frames at 128 kbit/s, 44.1 kHz.
    return (b'\xff\xfb\x90\x00' + bytes(413)) * 3
