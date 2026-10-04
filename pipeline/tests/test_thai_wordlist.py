"""Accuracy on a broader everyday word list (hand-written for Phi, Paiboon-style).

Two numbers matter:
- every entry must pass tone_check (no false failures on correct romanisation);
- the calculator's single best reading should match on nearly all of them.
"""

from __future__ import annotations

import pytest

import _thai_seed  # noqa: F401
from phi_pipeline.text.checks import tone_check
from phi_pipeline.thai import tones as T
from phi_pipeline.thai.roman import parse_roman

WORDS = """
ที่ thîi|การ gaan|เป็น bpen|ใน nai|ของ khǎwng|และ láe|มี mii|ได้ dâai|ไม่ mâi|ให้ hâi|ว่า wâa
จะ jà|มา maa|ไป bpai|คน khon|กับ gàp|แต่ dtàe|จาก jàak|นี้ níi|ก็ gâw|แล้ว láew|อยู่ yùu
หรือ rʉ̌ʉ|ทำ tham|เขา khǎo|ด้วย dûay|เรา rao|ถึง thʉ̌ng|ต้อง dtâwng|ยัง yang|อีก ìik|เมื่อ mʉ̂a
ตาม dtaam|ซึ่ง sʉ̂ng|เพราะ phráw|โดย dooi|ผู้ phûu|นั้น nán|บ้าน bâan|ใหญ่ yài|เล็ก lék|ดี dii
ร้อน ráwn|หนาว nǎao|เย็น yen|น้อง náwng|พี่ phîi|พ่อ phâw|แม่ mâe|ลูก lûuk|เด็ก dèk
ผู้หญิง phûu-yǐng|ผู้ชาย phûu-chaai|เพื่อน phʉ̂an|รัก rák|ชอบ châwp|อยาก yàak|รู้ rúu|เห็น hěn
ฟัง fang|พูด phûut|อ่าน àan|เขียน khǐan|เรียน rian|ทำงาน tham-ngaan|โรงเรียน roong-rian
โรงพยาบาล roong-phá-yaa-baan|ตำรวจ dtam-rùat|ทหาร thá-hǎan|นักเรียน nák-rian|ครู khruu|หมอ mǎw
รถ rót|รถไฟ rót-fai|เรือ rʉa|เครื่องบิน khrʉ̂ang-bin|ถนน thà-nǒn|ซอย sawy|ตลาด dtà-làat
สนามบิน sà-nǎam-bin|ห้าง hâang|ร้าน ráan|ซื้อ sʉ́ʉ|ขาย khǎai|ราคา raa-khaa|ถูก thùuk|แพง phaeng
เงิน ngoen|ทอง thawng|หนึ่ง nʉ̀ng|สอง sǎwng|ยี่สิบ yîi-sìp|ร้อย ráwy|พัน phan|หมื่น mʉ̀ʉn|แสน sǎen
ล้าน láan|วัน wan|เดือน dʉan|ปี bpii|ชั่วโมง chûa-moong|นาที naa-thii|เช้า cháo|กลางคืน glaang-khʉʉn
พรุ่งนี้ phrûng-níi|เมื่อวาน mʉ̂a-waan|วันนี้ wan-níi|อาหาร aa-hǎan|ข้าว khâao|ไข่ khài|ปลา bplaa
กุ้ง gûng|เนื้อ nʉ́a|ผัก phàk|ผลไม้ phǒn-lá-máai|น้ำตาล nám-dtaan|เกลือ glʉa|พริก phrík
เปรี้ยว bprîao|หวาน wǎan|เค็ม khem|ขม khǒm|สบาย sà-baai|สบายดี sà-baai-dii|เหนื่อย nʉ̀ay|หิว hǐu
ง่วง ngûang|ป่วย bpùay|เจ็บ jèp|ยา yaa|หัว hǔa|ตา dtaa|หู hǔu|จมูก jà-mùuk|ปาก bpàak|มือ mʉʉ
เท้า tháo|ขา khǎa|ใจ jai|สวย sǔay|หล่อ làw|น่ารัก nâa-rák|ใหม่ mài|เก่า gào|เร็ว reo|ช้า cháa
ไกล glai|ใกล้ glâi|ซ้าย sáai|ขวา khwǎa|หน้า nâa|หลัง lǎng|บน bon|ล่าง lâang|ข้างใน khâang-nai
ทำไม tham-mai|อะไร à-rai|ใคร khrai|ที่ไหน thîi-nǎi|เมื่อไหร่ mʉ̂a-rài|อย่างไร yàang-rai
ยังไง yang-ngai|เท่าไร thâo-rài|กี่ gìi|ประเทศ bprà-thêet|ประเทศไทย bprà-thêet-thai|ภาษา phaa-sǎa
ภาษาไทย phaa-sǎa-thai|คนไทย khon-thai|ฝรั่ง fà-ràng|อังกฤษ ang-grìt|ญี่ปุ่น yîi-bpùn|จีน jiin
มหาวิทยาลัย má-hǎa-wít-thá-yaa-lai|โทรศัพท์ thoo-rá-sàp|หนังสือ nǎng-sʉ̌ʉ|สมุด sà-mùt
ปากกา bpàak-gaa|โต๊ะ dtó|เก้าอี้ gâo-îi|ประตู bprà-dtuu|หน้าต่าง nâa-dtàang|ห้องนอน hâwng-nawn
เตียง dtiang|ตู้เย็น dtûu-yen|ไฟ fai|น้ำมัน nám-man|ขอบคุณมาก khàwp-khun-mâak|ยินดี yin-dii
เชิญ choen|คุณ khun|ผม phǒm|ดิฉัน dì-chǎn|เธอ thoe|มัน man|พวกเขา phûak-khǎo|ตัวเอง dtua-eeng
ชื่อ chʉ̂ʉ|อายุ aa-yú|เกิด gòet|นอน nawn|ตื่น dtʉ̀ʉn|อาบน้ำ àap-náam|กิน gin|ดื่ม dʉ̀ʉm|เดิน doen
วิ่ง wîng|นั่ง nâng|ยืน yʉʉn|เปิด bpòet|ปิด bpìt|ส่ง sòng|รับ ráp|จ่าย jàai|ใช้ chái|ลอง lawng
ช่วย chûay|เข้าใจ khâo-jai|คิด khít|ลืม lʉʉm|จำ jam|บอก bàwk|ถาม thǎam|ตอบ dtàwp|เล่น lên
ร้อง ráwng|เพลง phleeng|หนัง nǎng|ดู duu|สนุก sà-nùk|เบื่อ bʉ̀a|กลัว glua|โกรธ gròot|เศร้า sâo
ดีใจ dii-jai|เสียใจ sǐa-jai|แน่นอน nâe-nawn|อาจจะ àat-jà|คง khong|เคย khoei|เลย loei|มาก mâak
นิดหน่อย nít-nòi|ทั้งหมด tháng-mòt|ทุก thúk|บาง baang|บ้าง bâang|เท่านั้น thâo-nán|เกือบ gʉ̀ap
ค่อนข้าง khâwn-khâang|จริง jing|จริงๆ jing-jing|ช้าๆ cháa-cháa|เร็วๆ reo-reo|ชาติ châat|ญาติ yâat
เหตุ hèet|ศาสตร์ sàat|จันทร์ jan|สตางค์ sà-dtaang|เบียร์ bia|ทราบ sâap|สร้าง sâang|ศรี sǐi|ไทย thai
ทรง song|พระ phrá|ประโยชน์ bprà-yòot|บริษัท baw-rí-sàt|สามารถ sǎa-mâat|เพชร phét|กรุงเทพฯ grung-thêep
ขนม khà-nǒm|อร่อย à-ròi|สวัสดี sà-wàt-dii|ขอโทษ khǎw-thôot|ไม่เป็นไร mâi-bpen-rai|ฉลาด chà-làat
เสนอ sà-nə̌ə|แสดง sà-daeng|เฉพาะ chà-pháw|เมล็ด má-lét|เกษตร gà-sèet|แผนก phà-nàek|เสด็จ sà-dèt
ศาสนา sàat-sà-nǎa|สำคัญ sǎm-khan|อาจารย์ aa-jaan|ทุเรียน thú-rian|นาฬิกา naa-lí-gaa
ตุ๊กตา dtúk-gà-dtaa|วิทยุ wít-thá-yú|ราชการ râat-chá-gaan|คุณภาพ khun-ná-phâap|ธรรมชาติ tham-má-châat
แท็กซี่ tháek-sîi|โรงแรม roong-raem|ห้องน้ำ hâwng-náam|ร้านอาหาร ráan aa-hǎan|ลิฟต์ líp
เดี๋ยว dǐao|เปล่า bplàao|ไหว้ wâi|ห้าม hâam|ใส่ sài|ไหล่ lài|เหล้า lâo|หญ้า yâa|อย่า yàa|อย่าง yàang
""".strip()

ENTRIES = [tuple(e.strip().split(" ", 1)) for e in WORDS.replace("\n", "|").split("|") if e.strip()]


@pytest.mark.parametrize("thai,roman", ENTRIES, ids=[e[0] for e in ENTRIES])
def test_word_passes_tone_check(thai, roman):
    tones = parse_roman(roman).tones
    issues = [i for i in tone_check(thai, roman, tones) if i.severity == "fail"]
    assert not issues, [i.detail for i in issues]


def test_best_reading_accuracy():
    """The calculator's first guess (no romanisation to steer it)."""
    misses = [(t, r, T.tones_of(t)) for t, r in ENTRIES if T.tones_of(t) != parse_roman(r).tones]
    acc = 1 - len(misses) / len(ENTRIES)
    print(f"\nbest-reading accuracy {acc:.3f} on {len(ENTRIES)} words; misses: {misses}")
    assert acc >= 0.95, misses


def test_corrupted_tones_detected():
    """Change one syllable's tone; tone_check must fail it."""
    from phi_pipeline.thai.roman import mark_tone

    order = ["mid", "low", "falling", "high", "rising"]
    total = caught = 0
    missed = []
    for thai, roman in ENTRIES:
        p = parse_roman(roman)
        for idx in range(len(p.syllables)):
            for wrong in order:
                if wrong == p.syllables[idx].tone:
                    continue
                sylls = [s.base for s in p.syllables]
                tones = [s.tone for s in p.syllables]
                tones[idx] = wrong
                bad = "-".join(mark_tone(b, t) for b, t in zip(sylls, tones))
                total += 1
                if any(i.severity == "fail" for i in tone_check(thai, bad, tones)):
                    caught += 1
                else:
                    missed.append((thai, bad))
    rate = caught / total
    print(f"\ncorruption detection {rate:.3f} ({caught}/{total}); missed e.g. {missed[:15]}")
    assert rate >= 0.97, missed[:40]
