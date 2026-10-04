"""Line building for conversations (common.compose), on the faults found on the real run of 4 Oct 2026."""
import pytest

from phi_pipeline.text.common import compose


def it(thai, roman, forms=None):
    d = {"thai": thai, "roman": roman}
    if forms:
        d["forms"] = forms
    return d


ITEMS = {
    "i-male": it("ผม", "phǒm"), "i-female": it("ฉัน", "chǎn"),
    "mai-not": it("ไม่", "mâi"), "baht": it("บาท", "bàat"),
    "ao": it("เอา", "ao", {"m": {"thai": "ผมเอา", "roman": "phǒm ao"}, "f": {"thai": "ฉันเอา", "roman": "chǎn ao"}}),
    "like": it("ชอบ", "châawp", {"m": {"thai": "ผมชอบ", "roman": "phǒm châawp"}, "f": {"thai": "ฉันชอบ", "roman": "chǎn châawp"}}),
    "music": it("ดนตรี", "don-dtrii", {"m": {"thai": "ผมชอบดนตรี", "roman": "phǒm châawp don-dtrii"},
                                       "f": {"thai": "ฉันชอบดนตรี", "roman": "chǎn châawp don-dtrii"}}),
    "i-like-thailand": it("ผมชอบเมืองไทย", "phǒm châawp mʉang-thai",
                          {"m": {"thai": "ผมชอบเมืองไทย", "roman": "phǒm châawp mʉang-thai"},
                           "f": {"thai": "ฉันชอบเมืองไทย", "roman": "chǎn châawp mʉang-thai"}}),
    "excuse-me": it("ขอโทษนะครับ", "khǎw-thôot-ná-khráp", {"m": {"thai": "ขอโทษนะครับ", "roman": "khǎw-thôot-ná-khráp"},
                                                           "f": {"thai": "ขอโทษนะคะ", "roman": "khǎw-thôot-ná-khá"}}),
    "na": it("นะ", "ná"), "dii": it("ดี", "dii"),
    **{f"n{n}": it(t, r) for n, t, r in [(0, "ศูนย์", "sǔun"), (1, "หนึ่ง", "nʉ̀ng"), (2, "สอง", "sǎwng"), (3, "สาม", "sǎam"),
                                         (5, "ห้า", "hâa"), (8, "แปด", "bpàet"), (10, "สิบ", "sìp"), (11, "สิบเอ็ด", "sìp-èt"),
                                         (20, "ยี่สิบ", "yîi-sìp"), (100, "หนึ่งร้อย", "nʉ̀ng-ráawy")]},
}


@pytest.mark.parametrize("parts,who,end,want", [
    (["mai-not", "ao"], "m", "s", "ไม่เอาครับ"),          # not ไม่ผมเอา
    (["ao"], "f", "s", "ฉันเอาค่ะ"),                      # alone: the "I'll take" form
    (["I", "like", "music"], "m", "s", "ผมชอบดนตรีครับ"),  # not ผมผมชอบผมชอบดนตรี
    (["I", "i-like-thailand"], "f", "s", "ฉันชอบเมืองไทยค่ะ"),  # pronoun said once
    (["n3", "n100", "n5", "n10", "baht"], "m", "s", "สามร้อยห้าสิบบาทครับ"),
    (["n2", "n10"], "m", None, "ยี่สิบ"),
    (["n10", "n1"], "m", None, "สิบเอ็ด"),
    (["n0", "n8", "n1"], "m", None, "ศูนย์แปดหนึ่ง"),     # a phone number stays digit by digit
    (["excuse-me"], "f", "s", "ขอโทษนะคะ"),               # no second ending
    (["dii", "na"], "f", "s", "ดีนะคะ"),                  # นะคะ, never นะค่ะ
])
def test_compose(parts, who, end, want):
    got = compose(parts, who, end, ITEMS)
    assert got["thai"] == want
    assert len(got["tones"]) == len(got["roman"].replace("-", " ").split())
