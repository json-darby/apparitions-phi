"""What the recogniser writes for numbers, clock times, loanwords and letter names is read every
way it could have been spoken (false failures seen on the real run, 4 Oct 2026)."""

import pytest

from phi_pipeline.audio.stt_check import compare, heard_forms


@pytest.mark.parametrize("intended,heard,kind", [
    ("ตู้เอทีเอ็ม", "ตู้ ATM", "item"),
    ("มีตู้เอทีเอ็มไหม", "มี ตู้ ATM ไหม?", "example"),
    ("รหัสไวไฟ", "รหัส Wi-Fi", "item"),
    ("ขอรหัสไวไฟหน่อย", "ขอ รหัส Wi-Fi หน่อย", "example"),
    ("ศูนย์แปดหนึ่งสองสามสี่", "081234", "item"),
    ("ศูนย์แปดหนึ่งสองสามสี่", "081-234", "example"),
    ("บ่ายสองโมง", "14:00 น.", "example"),
    ("ตอนนี้ตีสอง", "ตอน นี้ 2:00 น.", "example"),
    ("สองโมงเช้า", "2:00 น.", "example"),
    ("ตอนนี้หนึ่งทุ่ม", "ตอน นี้ 19:00.", "example"),
    ("ภอ สำเภา", "พ. สัมเภา", "letter"),
    ("ฃอ ขวด", "ค ขวด", "letter"),
    ("ฐอ ฐาน", "ถ ถาน", "letter"),
    ("คลับ", "ครับ", "item"),
    ("สองร้อยห้าสิบบาท", "250 บาท", "example"),
])
def test_other_readings_pass(intended, heard, kind):
    assert compare(intended, heard, kind)["stt"] == "pass"


@pytest.mark.parametrize("intended,heard,kind", [
    ("บ่ายสองโมง", "15:00 น.", "example"),  # another hour
    ("ตอนนี้ตีสอง", "พรุ่งนี้ 2:00 น.", "example"),  # the rest of the sentence must still match
    ("ศูนย์แปดหนึ่งสองสามสี่", "081235", "item"),
    ("กินกุ้งไหม", "กลิ่น กุ้ง ไหม", "example"),
    ("ตู้เอทีเอ็ม", "ตู้ ABC", "item"),
    ("ฐอ ฐาน", "ส สี", "letter"),
    ("คลับ", "ขาด", "item"),
])
def test_real_differences_still_fail(intended, heard, kind):
    assert compare(intended, heard, kind)["stt"] == "fail"


def test_plain_reading_comes_first_and_numbers_keep_working():
    assert heard_forms("120 บาท")[0] == "หนึ่งร้อยยี่สิบบาท"
    assert compare("หนึ่งร้อยยี่สิบบาท", "120 บาท", "example")["verdict"] == "exact"
    assert compare("ไป", "", "item")["stt"] == "n/a"
