from phi_pipeline.audio.stt_check import compare


def test_empty_transcript_of_a_short_word_is_unverified_not_failed():
    r = compare("ไป", "", "item")
    assert r["stt"] == "n/a" and r["verdict"] == "empty"


def test_wrong_word_still_fails():
    assert compare("ไป", "ป๋าย", "item")["stt"] == "fail"


def test_empty_transcript_of_a_sentence_still_fails():
    assert compare("วันนี้อากาศร้อนมาก", "", "line")["stt"] == "fail"
