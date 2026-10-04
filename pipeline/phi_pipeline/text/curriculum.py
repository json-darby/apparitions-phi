"""The master English curriculum: what Phi teaches, on which day.

Days 1 to 30 come from the plan's word list ("Words, phrases and sentence
patterns" in plan/Phi master build plan.md), parsed from its markdown tables
rather than retyped. Each entry is placed on a day by the hand-written spine
(app/src/path/pathway.ts SPINE): DAY_RULES names, for each theme, the day
whose focus or situation needs it; everything else falls on the theme's
default day. A balancing pass keeps each day near the 60-minute track's quota
(about 12 new items, fewer on checkpoint days), pushing non-survival items a
day or two later.

Days 31 to 60 follow SPINE_EXTENSION. Their English entries are written here
(EXTENSION), originally, one block per day.

Also here: the sentence patterns (plan table + extension), the letters (a hand
table of standard alphabet facts), the 60 culture-note topics (the spine's
culture column) and the Street task list (street tasks, chapter parts and the
extension tasks).

Nothing in this module calls a model. `curriculum()` is pure and stable.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path

from ..config import APP, PROJECT

PLAN = PROJECT / "plan" / "Phi master build plan.md"
PATHWAY_TS = APP / "src" / "path" / "pathway.ts"
SEED_TS = APP / "src" / "content" / "seed.ts"


# ---------------------------------------------------------------- shapes

@dataclass
class Entry:
    id: str
    en: str
    theme: str
    day: int
    survival: bool = False
    adult: bool = False
    note: str = ""  # extra guidance for the writer (sense, register)
    tags: list[str] = field(default_factory=list)
    seed: bool = False  # id kept from the Phase 1-3 seed set


@dataclass
class PatternSpec:
    id: str
    en: str
    group: str
    day: int


@dataclass
class LetterSpec:
    id: str
    char: str
    name: str
    keyword: str
    initial: str
    final: str | None
    cls: str  # mid | high | low | vowel | tonemark
    day: int
    lookalikes: list[str] = field(default_factory=list)
    nameThai: str = ""  # the letter's name in Thai script, what the audio stage voices


@dataclass
class CultureSpec:
    id: str
    day: int
    title: str
    legal: bool = False  # points to official sources, makes no claim it cannot support


@dataclass
class TaskSpec:
    id: str
    title: str
    place: str  # PlaceId
    person: str  # cast id
    day: int
    goal: str
    steps: list[str]
    reward: dict = field(default_factory=lambda: {"baht": 20, "rep": 2})
    chapter: str | None = None
    adult: bool = False


@dataclass
class Day:
    day: int
    script: str
    focus: str
    situation: str
    culture: str
    checkpoint: str | None = None


# ---------------------------------------------------------------- the spine

def _parse_spine_array(src: str, name: str) -> list[Day]:
    start = src.index(f"export const {name}")
    body = src[src.index("[", start): src.index("];", start)]
    days = []
    for m in re.finditer(r"\{ day: (\d+), (.*?) \},?\n", body):
        d = int(m.group(1))
        rest = m.group(2)

        def f(key: str) -> str:
            mm = re.search(key + r": (['\"])(.*?)\1(?:,|$)", rest)
            return mm.group(2) if mm else ""

        cp = re.search(r"checkpoint: '(\w+)'", rest)
        days.append(Day(d, f("script"), f("focus"), f("situation"), f("culture"), cp.group(1) if cp else None))
    return days


@lru_cache(maxsize=1)
def spine() -> list[Day]:
    """Days 1 to 60, read from pathway.ts so the pipeline never drifts from the app."""
    src = PATHWAY_TS.read_text(encoding="utf8")
    return _parse_spine_array(src, "SPINE") + _parse_spine_array(src, "SPINE_EXTENSION")


def day_info(day: int) -> Day:
    return spine()[day - 1]


# ---------------------------------------------------------------- the plan's word list

THEME_IDS = {
    "Greetings and politeness": "greetings",
    "Core verbs": "verbs",
    "Questions": "questions",
    "Numbers and money": "numbers",
    "Classifiers": "classifiers",
    "Food and drink": "food",
    "Ordering phrases": "ordering",
    "Shopping": "shopping",
    "Directions and transport": "directions",
    "Hotel": "hotel",
    "Time": "time",
    "People and small talk": "people",
    "Descriptions and feelings": "feelings",
    "Health and emergencies": "health",
    "Nightlife and social (18+)": "nightlife",
    "Cannabis shop": "cannabis",
    "Signs to read": "signs",
    "Linking and grammar words": "linking",
}

# Entries whose sense in one theme differs from the same English elsewhere
# (different Thai), so they must not merge. (theme, en) -> new en.
SENSES = {
    ("health", "help"): "help! (calling for help)",
    ("health", "phone"): "mobile phone",
    ("hotel", "night"): "night (counting nights of a stay)",
    ("shopping", "bag"): "bag (carrier bag)",
    ("shopping", "change"): "change (money back)",
    ("cannabis", "shop"): "cannabis shop",
    ("cannabis", "not allowed"): "not allowed (it is forbidden)",
    ("signs", "free"): "free (no charge, on a sign)",
    ("signs", "sale"): "sale (on a sign)",
    ("signs", "men"): "men (on a sign)",
    ("signs", "women"): "women (on a sign)",
    ("signs", "tickets"): "tickets (on a sign)",
    ("people", "work"): "work (job)",
    ("time", "day"): "day (24 hours)",
}

# Writer notes for entries that need a steer. Keyed by the final English.
NOTES = {
    "male polite ending": "ครับ only, said by male speakers. No other text.",
    "female polite ending for statements": "ค่ะ (falling) only, female speakers, statements.",
    "female polite ending for questions": "คะ (high) only, female speakers, questions.",
    "I (male)": "ผม. speaker m.",
    "I (female)": "ฉัน, the everyday female form. Not ดิฉัน (too formal for this course's settings).",
    "yes-no question ending": "ไหม (spoken mǎi).",
    "softening ending": "หน่อย, softens a request.",
    "or not": "the tag question ... หรือเปล่า.",
    "isn't it": "the tag ... ใช่ไหม.",
    "the pattern for 12 to 99": "a worked number such as 45 (tens + units, with เอ็ด for 1 in the units).",
    "the pattern for prices": "a worked price such as 250 baht.",
    "the pattern for phone numbers": "how digits are read one by one, with an example number of 0xx-xxx-xxxx form made of zeros and small digits.",
    "clock word for 1 to 5 a.m.": "ตี + number.",
    "clock word for morning hours": "number + โมงเช้า.",
    "clock word for afternoon hours": "บ่าย + number + โมง.",
    "clock word for evening hours": "number + ทุ่ม.",
    "cannabis": "neutral word used on shop signs. Talk only; no advice on obtaining it.",
    "is it legal here": "a question; the answer belongs to official sources.",
    "do I need a prescription": "a question; no claims about the law.",
    "where can I smoke": "a question asked to staff; neutral.",
    "how strong is it": "neutral question at a shop counter; no use advice.",
    "can I buy you a drink": "friendly, not pushy.",
    "no problem (accepting a no)": "said kindly after someone declines; consent-forward.",
    "I'm with someone": "a polite refusal.",
    "I'm not interested": "a polite, clear refusal.",
    "you have a nice smile": "a light, respectful compliment.",
    "is that okay": "checking consent, e.g. before sitting down.",
    "use the meter please": "to a taxi driver.",
    "where is the toilet": "the most-needed question; natural, everyday.",
}

# Survival items: needed in the first hours of the trip. Placed early, never pushed later.
SURVIVAL = {
    "hello", "thank you", "sorry or excuse me", "male polite ending", "female polite ending for statements",
    "female polite ending for questions", "yes", "no", "please", "I don't understand", "speak slowly please",
    "how much", "how much is this", "too expensive", "baht", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    "water", "spicy", "not spicy", "can I have", "the bill please", "toilet", "where is the toilet", "where is",
    "left", "right", "straight on", "stop here", "use the meter please", "hotel", "airport",
    "help! (calling for help)", "police", "hospital", "pharmacy", "medicine", "allergic to", "emergency",
    "doctor", "passport", "lost my way", "no thank you", "I'm not interested", "I'm with someone",
    "headache", "it hurts", "vegetarian", "without",
}

# Flirting and dating lines sit behind the 18+ setting. Refusals and consent
# phrases stay open to everyone: they are safety language.
ADULT = {
    "can I buy you a drink", "can I sit here", "would you like to", "are you free", "shall we go",
    "can I have your number", "you have a nice smile", "I like talking to you", "is that okay",
    "I had a good time",
}

# Day placement by spine focus and situation. theme -> {day: "entry; entry"}.
DAY_RULES: dict[str, dict[int, str]] = {
    "greetings": {
        1: "hello; goodbye; thank you; sorry or excuse me; male polite ending; female polite ending for statements; "
           "female polite ending for questions; I (male); I (female); you",
        2: "never mind; please; yes; no",
        3: "how are you; I'm fine",
        18: "nice to meet you; see you again",
    },
    "verbs": {
        1: "be", 2: "have or there is; eat; understand", 4: "want (a thing); want to (do); drink",
        5: "buy; pay; look", 6: "go; come; give; take; wait; help; use", 11: "stop; walk",
        12: "be at; look for; know", 13: "phone", 15: "sleep; open; close", 16: "do", 17: "like",
        18: "speak", 23: "sit",
    },
    "questions": {
        2: "what", 5: "how much", 6: "can; cannot; softening ending", 8: "yes-no question ending; or not; isn't it",
        10: "how many; which", 12: "where; how", 13: "when", 16: "yet", 18: "who", 22: "why",
    },
    "numbers": {
        3: "0; 1; 2; 3; 4; 5; 6; 7; 8; 9; 10; baht",
        5: "11; 20; 21; 30; 100; the pattern for 12 to 99; the pattern for prices",
        6: "1,000", 10: "half; first", 24: "10,000; 100,000; a million; the pattern for phone numbers",
    },
    "classifiers": {
        10: "thing; plate; glass; bottle", 13: "vehicle", 19: "person; animal; room", 20: "box; time (occasion)",
        25: "bag", 26: "set",
    },
    "food": {
        2: "rice; fried rice; noodles; pad thai; chicken; pork; egg",
        4: "water; ice; beer; coffee; tea; iced; hot; sugar; milk",
        5: "mango; banana; coconut; watermelon; orange",
        8: "spicy; not spicy; papaya salad; curry; soup",
        9: "a little spicy; very spicy; take away; eat here; without; vegetarian; beef; vegetables",
        10: "the bill; menu",
        17: "delicious; hungry; full; sweet; sour; salty; sticky rice; fish; shrimp",
    },
    "ordering": {
        2: "can I have", 4: "no sugar; no ice; I'll take this one", 8: "is this spicy",
        9: "less spicy; what do you recommend", 10: "one more; the bill please; how much altogether; keep the change",
        17: "it's delicious",
    },
    "shopping": {
        3: "market",
        5: "how much is this; expensive; cheap; can you reduce it; too expensive; I'll take it; last price",
        6: "I don't want it; just looking; bigger; smaller; another colour; try on",
        10: "cash; card; change; receipt; bag", 15: "shop; open; closed",
    },
    "directions": {
        6: "taxi; tuk-tuk; motorbike taxi; go to; use the meter please; airport; hotel",
        11: "left; right; straight on; turn; stop here; slow down; fast",
        12: "near; far; here; there; where is; street or soi; corner; traffic light; map",
        13: "how long; bus; skytrain; station; ticket; traffic jam", 27: "pier",
    },
    "hotel": {
        15: "room; booking; name; key; night; check in; check out; floor; luggage; breakfast; wifi password",
        26: "air conditioning; towel; hot water; broken; clean",
    },
    "time": {
        13: "today; tomorrow; yesterday; now; later; morning; afternoon; evening; night; day",
        15: "hour; minute; what time; clock word for 1 to 5 a.m.; clock word for morning hours; "
            "clock word for afternoon hours; clock word for evening hours; early; late",
        16: "already", 27: "week; month", 28: "always; sometimes",
    },
    "people": {
        2: "I don't understand", 3: "speak slowly please; say it again", 7: "what does it mean; how do you say",
        18: "what's your name; country; England; where are you from; come from; on holiday; work; friend; "
            "first time; I like Thailand; I speak a little Thai",
        21: "boyfriend or girlfriend; married; single; age; how old; family; been here before; fun; beautiful",
    },
    "feelings": {
        2: "good; okay", 4: "hot; cold", 6: "big; small", 9: "very; a little",
        22: "cute; tired; happy; sad; bored", 23: "drunk", 25: "too much; bad", 26: "more; less; same; different",
    },
    "health": {
        1: "toilet", 12: "where is the toilet", 19: "medicine; pharmacy; headache; it hurts; sick",
        20: "stomach ache; fever; allergic to; hospital; doctor; help; police; emergency; be careful",
        25: "lost something; lost my way; passport; phone",
    },
    "nightlife": {
        10: "bar; cheers; one more round", 18: "what are you drinking; music; club; dance",
        21: "can I sit here; you have a nice smile; I like talking to you; see you; I'm going now; can I buy you a drink",
        22: "no thank you; I'm not interested; I'm with someone; no problem (accepting a no); I had a good time",
        23: "would you like to; are you free; shall we go; can I have your number; is that okay; go home",
    },
    "cannabis": {24: "cannabis; shop; is it legal here; do I need a prescription; where can I smoke; not allowed; "
                     "how strong is it; I don't want any"},
    "signs": {
        1: "toilet", 6: "taxi; hotel; airport", 10: "bar", 11: "stop", 12: "exit; entrance; men; women; push; pull",
        15: "open; closed", 19: "restaurant; pharmacy",
        21: "no smoking; no entry; danger; cashier; tickets; sale; free; wet floor",
    },
    "linking": {
        2: "not", 4: "this; that", 9: "and; with", 12: "at; to; from",
        16: "will; in progress; already; just now; still", 17: "also; only; but; or", 22: "because",
        26: "more than; the most",
    },
}
DEFAULT_DAY = {"signs": 21, "nightlife": 21, "cannabis": 24}

# Pacing: after the theme rules, these entries move so each day stays near the
# quota while still arriving by the day its situation needs them. English -> day.
MOVES = {
    "egg": 7, "noodles": 7, "good": 7, "okay": 7, "what": 7, "have or there is": 3, "how are you": 8,
    "I'm fine": 8, "say it again": 7, "nice to meet you": 1,
    "near": 12, "far": 12, "horse": 7, "dog": 7, "tiger": 8, "shirt": 6, "white": 8, "new": 10, "wood": 12,
    "tea": 29, "milk": 29, "cold": 9, "I'll take this one": 9,
    "coconut": 17, "watermelon": 17, "orange": 17, "cheap": 6, "last price": 14, "21": 14, "30": 14,
    "give": 14, "take": 14, "wait": 14, "use": 25, "help": 19, "1,000": 24, "motorbike taxi": 11,
    "bigger": 16, "smaller": 16, "another colour": 16, "try on": 16, "big": 19, "small": 19,
    "beef": 19, "vegetables": 19, "which": 23, "half": 24, "first": 25, "menu": 19, "cash": 11, "card": 23,
    "change (money back)": 25, "receipt": 25, "bag (carrier bag)": 25,
    "men (on a sign)": 20, "women (on a sign)": 20, "push": 29, "pull": 29, "exit": 29, "entrance": 29,
    "know": 23, "at": 14, "to": 14, "from": 27, "also": 28, "only": 28, "but": 28, "or": 28,
    "bus": 27, "skytrain": 27, "station": 27, "ticket": 27, "how long": 27,
    "sleep": 20, "open": 23, "closed": 23, "shop": 25, "close": 25, "floor": 26, "luggage": 26,
    "wifi password": 16, "breakfast": 16, "early": 15, "late": 15,
    "club": 28, "dance": 28, "see you again": 28, "been here before": 18, "family": 28, "age": 28, "how old": 28,
    "no smoking": 22, "no entry": 22, "danger": 22, "wet floor": 22,
    "cashier": 27, "tickets (on a sign)": 27, "sale (on a sign)": 27, "free (no charge, on a sign)": 27,
    "bored": 28, "cute": 28, "corner": 14, "traffic light": 14,
    # 4 Oct 2026: ช่วย needs หน่อย (day 6) for a natural example ("please speak slowly")
    "please": 6,
}

# Phase 1-3 seed ids, kept so progress and app references survive the switch.
SEED_IDS = {
    "male polite ending": "khrap", "female polite ending for statements": "kha-statement",
    "female polite ending for questions": "kha-question", "sorry or excuse me": "sorry", "I (male)": "i-male",
    "I (female)": "i-female", "never mind": "never-mind", "I don't understand": "dont-understand",
    "can I have": "khaw", "want (a thing)": "ao", "eat": "gin", "go": "bpai", "not": "mai-not",
    "yes-no question ending": "mai-q", "can": "dai", "softening ending": "noi", "100": "n100",
    "how much": "how-much", "how much is this": "how-much-this", "can you reduce it": "reduce",
    "a little spicy": "little-spicy", "thing": "cl-thing", "plate": "cl-plate", "glass": "cl-glass",
    "bottle": "cl-bottle", "straight on": "straight", "where is": "where-is",
}

# Ids set by hand: the English keeps the Thai word ซอย (a numbered side street, which is what the
# item and the note teach), while the ids say it in plain English.
RENAMED_IDS = {"street or soi": "side-street"}
CULTURE_IDS = {"Addresses and sois": "c-addresses-and-side-streets"}

# Tone-pair items from the seed set (minimal pairs for the tone lab). They are
# not in the plan's list; they keep their seed ids and day.
TONEPAIRS = [
    ("near", "near", 4), ("far", "far", 4), ("horse", "horse", 4), ("dog", "dog", 4), ("white", "white", 4),
    ("tiger", "tiger", 4), ("shirt", "shirt", 4), ("mai-new", "new", 4), ("mai-wood", "wood", 4),
]

_CLOCK = ["clock word for 1 to 5 a.m.", "clock word for morning hours", "clock word for afternoon hours",
          "clock word for evening hours"]


def _plan_section() -> str:
    t = PLAN.read_text(encoding="utf8")
    return t[t.index("## Words, phrases and sentence patterns"): t.index("## Inventory")]


def _table_rows(text: str) -> list[list[str]]:
    rows = []
    for line in text.splitlines():
        if line.startswith("|") and not re.match(r"^\|\s*-", line):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    return rows


def plan_word_list() -> list[tuple[str, str]]:
    """(theme id, English) for every entry in the plan's table, in table order, expanded."""
    out: list[tuple[str, str]] = []
    sec = _plan_section()
    words_table = sec[: sec.index("**Sentence patterns")]
    for row in _table_rows(words_table):
        if len(row) != 3 or row[0] == "Theme":
            continue
        theme = THEME_IDS[row[0]]
        for raw in row[2].split(", "):
            e = raw.strip()
            if e == "0 to 10":
                out += [(theme, str(n)) for n in range(11)]
            elif e == "the four clock-time words":
                out += [(theme, c) for c in _CLOCK]
            elif e:
                out.append((theme, e))
    return out


def plan_patterns() -> list[tuple[str, str]]:
    sec = _plan_section()
    table = sec[sec.index("**Sentence patterns"):]
    table = table[: table.index("**Also generated")]
    out = []
    for row in _table_rows(table):
        if len(row) != 2 or row[0] == "Group":
            continue
        for p in row[1].split(" · "):
            out.append((row[0], p.strip()))
    return out


def kebab(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("'", "").replace(",", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def _entry_id(theme: str, en: str, used: set[str]) -> str:
    if en in SEED_IDS:
        return SEED_IDS[en]
    if en in RENAMED_IDS:
        return RENAMED_IDS[en]
    if re.fullmatch(r"[\d,]+", en):
        base = "n" + en.replace(",", "")
    elif theme == "classifiers":
        base = "cl-" + kebab(en.split(" (")[0])
    else:
        base = kebab(en)
    i, cand = 2, base
    while cand in used:
        cand = f"{base}-{theme}" if i == 2 else f"{base}-{i}"
        i += 1
    return cand


def _seed_ids() -> set[str]:
    if not SEED_TS.exists():
        return set()
    return set(re.findall(r"^\s*\['([a-z0-9-]+)', '", SEED_TS.read_text(encoding="utf8"), re.M))


# ---------------------------------------------------------------- days 31 to 60

# Original English entries for the 60-day course, following SPINE_EXTENSION.
# One line per entry: "english | theme" with optional flags "| s" (survival),
# "| a" (18+), and "| note: ..." for the writer.
EXTENSION: dict[int, str] = {
    31: """
I feel | feelings
excited | feelings
relaxed | feelings
nervous | feelings
stressed | feelings
I think so too | feelings
in my opinion | feelings
café | food
iced Thai tea | food
iced black coffee | food
less sweet | ordering
not too strong | ordering
""",
    32: """
have ever (done) | verbs | note: เคย, before a verb
never (have done) | linking
last night | time
this morning | time
ago | time | note: as in two days ago
last week | time
go out (for fun) | verbs
see | verbs
meet | verbs
swim | verbs
temple | directions
""",
    33: """
clothes | shopping
trousers | shopping
shoes | shopping
size | shopping
too big | shopping
too small | shopping
fits well | shopping
fitting room | shopping
less than | linking
equally (as ... as) | linking
long | feelings
short (length) | feelings
""",
    34: """
if | linking
so, then | linking
maybe | linking
probably | linking
rain | time
cancel | verbs
change plans | verbs
busy | feelings
it can't be helped | feelings
next time | time
instead | linking
""",
    35: """
and then | linking
after that | linking
before | linking
noisy | hotel
dirty | hotel
doesn't work | hotel
light (lamp) | hotel
shower | hotel
change rooms | hotel
fix | verbs
send someone up | hotel
blanket | hotel
""",
    36: """
he or she | people | note: เขา, everyday third person
they | people
tell | verbs
say that | verbs | note: reporting speech: he said that ...
hear | verbs
it seems | linking
true | feelings
not true | feelings
really (truly) | linking
secret | people
neighbour | people
""",
    37: """
northern food | food
north-eastern food | food
southern food | food
grilled chicken | food
""",
    38: """
worried | feelings
surprised | feelings
annoyed | feelings
angry | feelings
forget | verbs
leave behind | verbs
wallet | shopping | s
backpack | shopping
lost property office | directions
find | verbs
black | feelings
""",
    39: """
train | directions
platform | directions
upper berth | directions
lower berth | directions
one-way | directions
return ticket | directions
depart | directions
arrive | directions
seat | directions
timetable | directions
""",
    40: """
table for six | ordering
share dishes | ordering
one each | ordering
peanuts | food
seafood | food
not too salty | ordering
another plate of rice | ordering
split the bill | ordering
everyone | people
my treat | ordering
""",
    41: """
cough | health
sore throat | health
diarrhoea | health
dizzy | health
feel sick (nauseous) | health
since | linking
every day | time
twice a day | health
after meals | health
insurance | health
clinic | health
""",
    42: """
softening particle na | linking | note: นะ, softens or urges, very common
urging particle si | linking | note: สิ, as in go on, do it
emphasis particle loei | linking | note: เลย
particle for 'so' jang | linking | note: จัง, as in so cute
go ahead | greetings
of course | greetings
let's go | verbs
wait a moment | verbs
completely | linking
sure, why not | greetings
""",
    43: """
really? (checking) | questions | note: เหรอ, casual
or not yet? | questions | note: รึยัง, casual
hello (on the phone) | greetings
who's calling | questions
can you hear me | questions
call back | verbs
send a message | verbs
speak louder | people
my phone battery is dead | verbs
""",
    44: """
festival | time
new year | time
public holiday | time
lantern | time
""",
    45: """
bank | shopping
cash machine | shopping
exchange money | shopping
exchange rate | shopping
fee | shopping
pound (money) | numbers
dollar | numbers
withdraw | shopping
the machine kept my card | shopping
coin | numbers
banknote | numbers
""",
    46: """
opposite | directions
next to | directions
behind | directions
in front of | directions
between | directions
inside | directions
outside | directions
upstairs | directions
downstairs | directions
lift | directions
bridge | directions
""",
    47: """
I (formal, female) | greetings | note: ดิฉัน. Formal settings only, never in a bar. speaker f.
older person (phîi) | people
younger person (náwng) | people
uncle, older man (lung) | people
aunt, older woman (bpâa) | people
please (formal) | greetings
thank you very much | greetings
may I ask | questions
yeah (casual yes) | greetings
excuse me (to get attention) | greetings
""",
    48: """
invite | nightlife
are you coming | nightlife
I'd love to | nightlife
maybe next time | nightlife
what time shall we meet | nightlife
where shall we meet | nightlife
I'll be a bit late | nightlife
live music | nightlife
rooftop bar | nightlife
count me in | nightlife
""",
    49: """
tall | feelings
short (height) | feelings
kind | feelings
funny | feelings
quiet | feelings
crowded | feelings
home town | people
city | directions
countryside | directions
mountain | directions
river | directions
""",
    50: """
joke | people
just kidding | people
don't tease me | people
no way! | feelings
you're good at bargaining | shopping
lucky | feelings
laugh | verbs
smile | verbs
seriously? | questions
""",
    51: """
take off shoes | verbs
monk | people
pray | verbs
please be quiet | signs
""",
    52: """
flight | directions
delayed | directions
cancelled | directions
refund | shopping
boarding pass | directions
gate | directions
overweight (luggage) | directions
miss (a flight or train) | verbs
compensation | shopping
next flight | directions
""",
    53: """
agree | feelings
I don't think so | feelings
that's right | feelings
it depends | feelings
news | people
weather | time
prices are going up | shopping
I don't know much about that | people
let's change the subject | people
interesting | feelings
""",
    54: """
date (a romantic evening out) | nightlife | a
can I hold your hand | nightlife | a | note: asking first, consent-forward
I'd like to take it slowly | nightlife | a
I'm comfortable | nightlife | a
I'm not comfortable | nightlife | note: a clear boundary, open to everyone
not tonight | nightlife | note: a clear boundary, open to everyone
please stop | nightlife | s | note: a clear boundary, open to everyone
is this okay for you | nightlife | a | note: checking consent
can I walk you home | nightlife | a
message me when you get home | nightlife | a
respect | nightlife
""",
    55: """
island | directions
beach | directions
boat | directions
speedboat | directions
sea | directions
big waves | directions
life jacket | health | s
sunscreen | health
go snorkelling | verbs
when does the last boat leave | directions
""",
    56: """
accident | health | s
injured | health | s
bleeding | health | s
ambulance | health | s
call an ambulance | health | s
fire | health | s
thief | health
someone fainted | health
are you okay | health
don't move | health
I'll get help | health
""",
    57: """
first of all | linking
next (in a story) | linking
finally | linking
suddenly | linking
in the end | linking
remember | verbs
trip | people
photo | people
unforgettable | feelings
""",
    58: """
come back | verbs
miss (someone) | feelings
souvenir | shopping
""",
    59: """
practise | verbs
keep going | verbs
""",
    60: """
congratulations | greetings
well done | greetings
""",
}


def _extension_entries(used: set[str]) -> list[Entry]:
    out = []
    for day, block in EXTENSION.items():
        for line in block.strip().splitlines():
            parts = [p.strip() for p in line.split("|")]
            en, theme, flags = parts[0], parts[1], parts[2:]
            note = next((f[5:].strip() for f in flags if f.startswith("note:")), "")
            eid = _entry_id(theme, en, used)
            used.add(eid)
            out.append(Entry(eid, en, theme, day, survival="s" in flags, adult="a" in flags, note=note,
                             tags=["formal"] if "formal" in en else []))
    return out


# ---------------------------------------------------------------- balancing

def day_cap(day: int) -> int:
    """New items a day may carry (the 60-minute track; the app's load balancer may cut further)."""
    d = day_info(day)
    if d.checkpoint == "final":
        return 4
    if day in (29, 59):
        return 6
    if d.checkpoint == "week":
        return 8
    return 16 if day <= 30 else 12


def _balance(entries: list[Entry], last_day: int) -> None:
    """Push non-survival overflow to the next day with room (at most 8 days later, never past last_day)."""
    for day in range(1, last_day + 1):
        today = [e for e in entries if e.day == day]
        over = len(today) - day_cap(day)
        if over <= 0:
            continue
        movable = [e for e in reversed(today) if not e.survival][:over]
        for e in movable:
            for d2 in range(day + 1, min(day + 8, last_day) + 1):
                if sum(1 for x in entries if x.day == d2) < day_cap(d2):
                    e.day = d2
                    break


# ---------------------------------------------------------------- the whole list

@lru_cache(maxsize=1)
def entries() -> tuple[Entry, ...]:
    raw = plan_word_list()
    seed_ids = _seed_ids()
    rules: dict[tuple[str, str], int] = {}
    for theme, days in DAY_RULES.items():
        for d, names in days.items():
            for n in names.split("; "):
                rules[(theme, n.strip())] = d

    by_en: dict[str, Entry] = {}
    used: set[str] = set()
    out: list[Entry] = []

    for eid, en, day in TONEPAIRS:
        e = Entry(eid, en, "tonepairs", day, seed=eid in seed_ids, note="part of a tone or vowel minimal pair")
        out.append(e)
        by_en[en] = e
        used.add(eid)

    for theme, en0 in raw:
        day = rules.get((theme, en0), DEFAULT_DAY.get(theme))
        en = SENSES.get((theme, en0), en0)
        key = ("cl:" + en) if theme == "classifiers" else en
        if key in by_en:  # same word met again under another theme: keep the earliest, tag the other
            first = by_en[key]
            if theme not in first.tags and theme != first.theme:
                first.tags.append(theme)
            if day is not None:
                first.day = min(first.day, day)
            continue
        if day is None:
            raise ValueError(f"curriculum: no day rule for {theme}: {en0!r}")
        eid = _entry_id(theme, en, used)
        used.add(eid)
        e = Entry(eid, en, theme, day, survival=en in SURVIVAL, adult=en in ADULT or theme == "cannabis",
                  note=NOTES.get(en, ""), seed=eid in seed_ids)
        if theme == "signs":
            e.note = (e.note + " Written form as seen on a sign.").strip()
        by_en[key] = e
        out.append(e)

    for e in out:
        e.day = MOVES.get(e.en, e.day)
    _balance(out, 30)
    out += _extension_entries(used)
    out.sort(key=lambda e: (e.day, 0 if e.survival else 1))
    return tuple(out)


def entries_for(day: int) -> list[Entry]:
    return [e for e in entries() if e.day == day]


def unused_moves() -> list[str]:
    known = {e.en for e in entries()}
    return [m for m in MOVES if m not in known]


def unused_rules() -> list[tuple[str, str]]:
    """Rule names that match nothing in the plan's list (a typo guard; tests keep this empty)."""
    raw = set(plan_word_list())
    return [(t, n.strip()) for t, days in DAY_RULES.items() for names in days.values() for n in names.split("; ")
            if (t, n.strip()) not in raw]


# ---------------------------------------------------------------- patterns

# Plan pattern -> day (by spine focus). Seed pattern ids are kept. 4 Oct 2026: four moved to the first day
# their words are taught (X is Y: คน, หมอ; there is X: มี; don't X: อย่า; I think that X: คิดว่า).
PATTERN_DAYS = {
    "X is Y": 20, "X is at Y": 12, "there is X": 3, "I have X": 2, "X is (description)": 2,
    "X is very (description)": 9,
    "not + verb": 2, "not + description": 3, "X is not Y": 3, "there is no X": 4, "cannot + verb": 6,
    "I want X": 4, "I want to do X": 4, "I don't want X": 5, "I like X": 17, "I like to do X": 17,
    "is it X?": 8, "X or not?": 8, "what is X?": 7, "where is X?": 12, "how much is X?": 5, "how many X?": 10,
    "when?": 13, "who?": 18, "can I do X?": 6, "do you have X?": 9,
    "can I have X": 2, "please do X": 6, "please don't do X": 50, "can you do X for me": 15,
    "a little more X or less X": 9,
    "number + classifier": 10, "item + number + classifier": 10, "this one, that one": 5,
    "how many + classifier": 19,
    "did X already": 16, "am doing X": 16, "will do X": 16, "did X yesterday": 13, "haven't done X yet": 16,
    "at (time)": 15,
    "go to X": 6, "come from X": 18, "turn at X": 11, "X is near or far from Y": 12,
    "X more than Y": 26, "the most X": 26, "the same as X": 26,
    "shall we do X?": 27, "would you like X?": 23, "I think that X": 31, "because X": 22,
}
PATTERN_SEED_IDS = {"can I have X": "p-khaw", "is it X?": "p-mai-q", "not + verb": "p-mai-not",
                    "how much is X?": "p-how-much", "item + number + classifier": "p-count"}

EXTENSION_PATTERNS = [
    (31, "Feelings", "I feel X"), (32, "Experience", "have you ever done X?"),
    (33, "Comparing", "X is a bit more Y than Z"), (34, "Conditions", "if X, then Y"),
    (35, "Requests", "please do X, and then Y"), (36, "Reporting", "he said that X"),
    (38, "Problems", "I left X at Y"), (39, "Travel", "what time does X leave?"),
    (40, "Ordering", "X for N people"), (41, "Health", "I have had X since Y"),
    (42, "Particles", "X na (softened)"), (43, "Questions", "X, really? (checking)"),
    (43, "Questions", "done X yet?"), (45, "Money", "I want to change X into Y"),
    (46, "Place", "X is next to Y"), (47, "Register", "may I ask X"),
    (48, "Social", "would you like to come and X with me?"), (49, "Describing", "X is A and B"),
    (50, "Feelings", "so X! (jang)"), (52, "Travel", "X is delayed by N hours"),
    (53, "Opinions", "I don't think that X"), (54, "Boundaries", "is it okay if X?"),
    (55, "Travel", "how long does it take to get to X by Y?"), (56, "Emergencies", "quick, X!"),
    (57, "Storytelling", "first X, then Y, finally Z"), (58, "Plans", "next time I will X"),
]


@lru_cache(maxsize=1)
def patterns() -> tuple[PatternSpec, ...]:
    out, used = [], set()
    for group, p in plan_patterns():
        if p not in PATTERN_DAYS:
            raise ValueError(f"curriculum: no day for pattern {p!r}")
        pid = PATTERN_SEED_IDS.get(p) or "p-" + kebab(p)
        while pid in used:
            pid += "-2"
        used.add(pid)
        out.append(PatternSpec(pid, p, group, PATTERN_DAYS[p]))
    for day, group, p in EXTENSION_PATTERNS:
        pid = "p-" + kebab(p)
        while pid in used:
            pid += "-2"
        used.add(pid)
        out.append(PatternSpec(pid, p, group, day))
    out.sort(key=lambda p: p.day)
    return tuple(out)


# ---------------------------------------------------------------- letters

# The 44 consonants: standard alphabet facts (name word, keyword, sounds, class).
# Day follows the spine's script column. id, char, name, keyword, initial, final, class, day.
CONSONANTS = [
    ("l-gor", "ก", "gor gài", "chicken", "g", "k", "mid", 1),
    ("l-khor-khai", "ข", "khor khài", "egg", "kh", "k", "high", 8),
    ("l-khor-khuat", "ฃ", "khor khùat", "bottle (obsolete letter)", "kh", "k", "high", 20),
    ("l-khor-khwaai", "ค", "khor khwaai", "buffalo", "kh", "k", "low", 11),
    ("l-khor-khon", "ฅ", "khor khon", "person (obsolete letter)", "kh", "k", "low", 20),
    ("l-khor-rakhang", "ฆ", "khor rá-khang", "bell", "kh", "k", "low", 20),
    ("l-ngor", "ง", "ngor nguu", "snake", "ng", "ng", "low", 3),
    ("l-jor", "จ", "jor jaan", "plate", "j", "t", "mid", 1),
    ("l-chor-ching", "ฉ", "chor chìng", "small cymbals", "ch", None, "high", 8),
    ("l-chor-chang", "ช", "chor cháang", "elephant", "ch", "t", "low", 11),
    ("l-sor-so", "ซ", "sor sôo", "chain", "s", "t", "low", 11),
    ("l-chor-choe", "ฌ", "chor chəə", "tree", "ch", None, "low", 20),
    ("l-yor-ying", "ญ", "yor yǐng", "woman", "y", "n", "low", 15),
    ("l-dor-chada", "ฎ", "dor chá-daa", "headdress", "d", "t", "mid", 20),
    ("l-dtor-patak", "ฏ", "dtor bpà-dtàk", "goad", "dt", "t", "mid", 20),
    ("l-thor-than", "ฐ", "thor thǎan", "pedestal", "th", "t", "high", 20),
    ("l-thor-montho", "ฑ", "thor mon-thoo", "Montho, a character in a classic tale", "th", "t", "low", 20),
    ("l-thor-phuthao", "ฒ", "thor phûu-thâo", "old man", "th", "t", "low", 20),
    ("l-nor-nen", "ณ", "nor neen", "young monk", "n", "n", "low", 15),
    ("l-dor", "ด", "dor dèk", "child", "d", "t", "mid", 1),
    ("l-dtor", "ต", "dtor dtào", "turtle", "dt", "t", "mid", 1),
    ("l-thor-thung", "ถ", "thor thǔng", "sack", "th", "t", "high", 8),
    ("l-thor-thahan", "ท", "thor thá-hǎan", "soldier", "th", "t", "low", 11),
    ("l-thor-thong", "ธ", "thor thong", "flag", "th", "t", "low", 19),
    ("l-nor", "น", "nor nǔu", "mouse", "n", "n", "low", 3),
    ("l-bor", "บ", "bor bai-mái", "leaf", "b", "p", "mid", 1),
    ("l-bpor", "ป", "bpor bplaa", "fish", "bp", "p", "mid", 1),
    ("l-phor-phueng", "ผ", "phor phʉ̂ng", "bee", "ph", None, "high", 8),
    ("l-for-fa", "ฝ", "for fǎa", "lid", "f", None, "high", 8),
    ("l-phor-phan", "พ", "phor phaan", "tray on a stand", "ph", "p", "low", 11),
    ("l-for-fan", "ฟ", "for fan", "teeth", "f", "p", "low", 11),
    ("l-phor-samphao", "ภ", "phor sǎm-phao", "sailing junk", "ph", "p", "low", 19),
    ("l-mor", "ม", "mor máa", "horse", "m", "m", "low", 3),
    ("l-yor-yak", "ย", "yor yák", "giant", "y", "i", "low", 3),
    ("l-ror", "ร", "ror rʉa", "boat", "r", "n", "low", 3),
    ("l-lor-ling", "ล", "lor ling", "monkey", "l", "n", "low", 3),
    ("l-wor", "ว", "wor wǎen", "ring", "w", "w", "low", 3),
    ("l-sor-sala", "ศ", "sor sǎa-laa", "pavilion", "s", "t", "high", 19),
    ("l-sor-rusi", "ษ", "sor rʉʉ-sǐi", "hermit", "s", "t", "high", 19),
    ("l-sor-suea", "ส", "sor sʉ̌a", "tiger", "s", "t", "high", 8),
    ("l-hor-hip", "ห", "hor hìip", "chest (box)", "h", None, "high", 8),
    ("l-lor-chula", "ฬ", "lor jù-laa", "kite", "l", "n", "low", 20),
    ("l-or", "อ", "or àang", "basin", "(silent)", None, "mid", 1),
    ("l-hor-nokhuk", "ฮ", "hor nók-hûuk", "owl", "h", None, "low", 11),
]

# Vowel forms (written around a consonant; '-' marks where it goes). id, form, name, sound, day.
VOWELS = [
    ("v-aa", "-า", "sà-rà aa", "aa", 1), ("v-ii", "-ี", "sà-rà ii", "ii", 2), ("v-uu", "-ู", "sà-rà uu", "uu", 2),
    ("v-e", "เ-", "sà-rà ee", "ee", 4), ("v-ae", "แ-", "sà-rà ae", "ae", 4), ("v-o", "โ-", "sà-rà oo", "oo", 4),
    ("v-am", "-ำ", "sà-rà am", "am", 5), ("v-ai-maimuan", "ใ-", "sà-rà ai mái-múan", "ai", 5),
    ("v-ai-maimalai", "ไ-", "sà-rà ai mái-má-lai", "ai", 5),
    ("v-a", "-ะ", "sà-rà à", "a (short)", 13), ("v-i", "-ิ", "sà-rà ì", "i (short)", 13),
    ("v-u", "-ุ", "sà-rà ù", "u (short)", 13), ("v-ue-short", "-ึ", "sà-rà ʉ̀", "ʉ (short)", 13),
    ("v-ue-long", "-ื", "sà-rà ʉʉ", "ʉʉ", 13),
    ("v-ao", "เ-า", "sà-rà ao", "ao", 18), ("v-or", "-อ", "sà-rà aw", "aw", 18), ("v-oe", "เ-อ", "sà-rà əə", "əə", 18),
    ("v-maihanakat", "-ั-", "mái hǎn-aa-gàat", "a (short, inside a syllable)", 18),
    ("v-maitaikhu", "-็", "mái dtài-khúu", "shortens the vowel", 18),
    ("v-e-short", "เ-ะ", "sà-rà è", "e (short)", 31), ("v-ae-short", "แ-ะ", "sà-rà àe", "ae (short)", 31),
    ("v-o-short", "โ-ะ", "sà-rà ò", "o (short)", 31), ("v-or-short", "เ-าะ", "sà-rà àw", "aw (short)", 31),
    ("v-oe-short", "เ-อะ", "sà-rà ə̀", "ə (short)", 31), ("v-rue", "ฤ", "rʉ́", "rʉ (in borrowed words)", 39),
    ("v-ia", "เ-ีย", "sà-rà iia", "ia", 32), ("v-uea", "เ-ือ", "sà-rà ʉʉa", "ʉa", 32),
    ("v-ua", "-ัว", "sà-rà uua", "ua", 32),
]

TONEMARKS = [
    ("t-mai-ek", "-่", "mái èek", "first tone mark", 10), ("t-mai-tho", "-้", "mái thoo", "second tone mark", 12),
    ("t-mai-tri", "-๊", "mái dtrii", "third tone mark", 16), ("t-mai-jattawa", "-๋", "mái jàt-dtà-waa", "fourth tone mark", 16),
]

LOOKALIKES = [
    ["l-gor", "l-thor-thung", "l-phor-samphao"], ["l-bor", "l-bpor", "l-sor-rusi"], ["l-dor", "l-dtor", "l-khor-khwaai"],
    ["l-khor-khai", "l-chor-chang", "l-sor-so"], ["l-phor-phueng", "l-for-fa", "l-phor-phan", "l-for-fan"],
    ["l-nor", "l-mor", "l-hor-hip"], ["l-ror", "l-wor"], ["l-lor-ling", "l-sor-suea"],
    ["l-thor-thahan", "l-thor-montho"], ["l-dor-chada", "l-dtor-patak"], ["l-sor-sala", "l-sor-suea"],
    ["l-yor-yak", "l-khor-rakhang"], ["l-nor-nen", "l-lor-chula"], ["l-chor-ching", "l-sor-sala"],
    ["l-thor-thong", "l-khor-khai"], ["l-thor-than", "l-yor-ying"],
    ["v-ai-maimuan", "v-ai-maimalai"], ["v-i", "v-ii"], ["v-ue-short", "v-ue-long"], ["v-a", "v-aa"],
    ["t-mai-ek", "t-mai-tho"], ["t-mai-tri", "t-mai-jattawa"],
]


# Thai-script names, spoken by the audio stage (standard names, by id).
NAME_THAI = {
    "l-gor": "กอ ไก่", "l-khor-khai": "ขอ ไข่", "l-khor-khuat": "ฃอ ขวด", "l-khor-khwaai": "คอ ควาย",
    "l-khor-khon": "ฅอ คน", "l-khor-rakhang": "ฆอ ระฆัง", "l-ngor": "งอ งู", "l-jor": "จอ จาน", "l-chor-ching": "ฉอ ฉิ่ง",
    "l-chor-chang": "ชอ ช้าง", "l-sor-so": "ซอ โซ่", "l-chor-choe": "ฌอ เฌอ", "l-yor-ying": "ญอ หญิง",
    "l-dor-chada": "ฎอ ชฎา", "l-dtor-patak": "ฏอ ปฏัก", "l-thor-than": "ฐอ ฐาน", "l-thor-montho": "ฑอ มณโฑ",
    "l-thor-phuthao": "ฒอ ผู้เฒ่า", "l-nor-nen": "ณอ เณร", "l-dor": "ดอ เด็ก", "l-dtor": "ตอ เต่า", "l-thor-thung": "ถอ ถุง",
    "l-thor-thahan": "ทอ ทหาร", "l-thor-thong": "ธอ ธง", "l-nor": "นอ หนู", "l-bor": "บอ ใบไม้", "l-bpor": "ปอ ปลา",
    "l-phor-phueng": "ผอ ผึ้ง", "l-for-fa": "ฝอ ฝา", "l-phor-phan": "พอ พาน", "l-for-fan": "ฟอ ฟัน",
    "l-phor-samphao": "ภอ สำเภา", "l-mor": "มอ ม้า", "l-yor-yak": "ยอ ยักษ์", "l-ror": "รอ เรือ", "l-lor-ling": "ลอ ลิง",
    "l-wor": "วอ แหวน", "l-sor-sala": "ศอ ศาลา", "l-sor-rusi": "ษอ ฤๅษี", "l-sor-suea": "สอ เสือ", "l-hor-hip": "หอ หีบ",
    "l-lor-chula": "ฬอ จุฬา", "l-or": "ออ อ่าง", "l-hor-nokhuk": "ฮอ นกฮูก",
    "v-aa": "สระ อา", "v-ii": "สระ อี", "v-uu": "สระ อู", "v-e": "สระ เอ", "v-ae": "สระ แอ", "v-o": "สระ โอ",
    "v-am": "สระ อำ", "v-ai-maimuan": "สระ ใอ ไม้ม้วน", "v-ai-maimalai": "สระ ไอ ไม้มลาย", "v-a": "สระ อะ",
    "v-i": "สระ อิ", "v-u": "สระ อุ", "v-ue-short": "สระ อึ", "v-ue-long": "สระ อือ", "v-ao": "สระ เอา",
    "v-or": "สระ ออ", "v-oe": "สระ เออ", "v-maihanakat": "ไม้หันอากาศ", "v-maitaikhu": "ไม้ไต่คู้",
    "v-e-short": "สระ เอะ", "v-ae-short": "สระ แอะ", "v-o-short": "สระ โอะ", "v-or-short": "สระ เอาะ",
    "v-oe-short": "สระ เออะ", "v-rue": "ฤ", "v-ia": "สระ เอีย", "v-uea": "สระ เอือ", "v-ua": "สระ อัว",
    "t-mai-ek": "ไม้เอก", "t-mai-tho": "ไม้โท", "t-mai-tri": "ไม้ตรี", "t-mai-jattawa": "ไม้จัตวา",
}


@lru_cache(maxsize=1)
def letters() -> tuple[LetterSpec, ...]:
    look: dict[str, set[str]] = {}
    for group in LOOKALIKES:
        for a in group:
            look.setdefault(a, set()).update(x for x in group if x != a)
    out = [LetterSpec(i, c, n, k, ini, fin, cls, d, sorted(look.get(i, ()))) for i, c, n, k, ini, fin, cls, d in CONSONANTS]
    out += [LetterSpec(i, f, n, f"vowel: {s}", s, None, "vowel", d, sorted(look.get(i, ()))) for i, f, n, s, d in VOWELS]
    out += [LetterSpec(i, f, n, k, "", None, "tonemark", d, sorted(look.get(i, ()))) for i, f, n, k, d in TONEMARKS]
    for l in out:
        l.nameThai = NAME_THAI[l.id]
    out.sort(key=lambda l: l.day)
    return tuple(out)


# ---------------------------------------------------------------- culture notes

LEGAL_TOPICS = ("cannabis", "monarchy", "alcohol", "emergency", "insurance", "police", "scams", "card scams")


@lru_cache(maxsize=1)
def culture_topics() -> tuple[CultureSpec, ...]:
    out = []
    for d in spine():
        title = d.culture
        if not title:
            title = "Halfway, or the end of the road" if d.day == 30 else "After the course"
        cid = CULTURE_IDS.get(title) or "c-" + kebab(title)[:40].strip("-")
        out.append(CultureSpec(cid, d.day, title, legal=any(k in title.lower() for k in LEGAL_TOPICS)))
    # seed ids kept for the first five
    seed = {1: "c-wai", 2: "c-street-food", 3: "c-baht", 4: "c-ice", 5: "c-haggling"}
    for c in out:
        c.id = seed.get(c.day, c.id)
    return tuple(out)


# ---------------------------------------------------------------- Street tasks

def _t(id, title, place, person, day, goal, steps, chapter=None, adult=False, reward=None):
    return TaskSpec(id, title, place, person, day, goal, steps, reward or {"baht": 20, "rep": 2}, chapter, adult)


STREET_TASKS = [
    _t("hotel-hello", "Say hello at the hotel desk", "hotel", "ploy", 1, "Greet Ploy and thank her for the key card.", ["Greet", "Thank"]),
    _t("food-water", "Order a coffee, no ice", "food", "nok", 4, "Order a coffee without ice and pay.", ["Order", "Ice", "Pay"]),
    _t("market-mango", "Haggle for a mango", "market", "lek", 5, "Ask the price of a mango, haggle a little, buy.", ["Price", "Haggle", "Buy"]),
    _t("market-shirt", "Haggle a shirt under 300 baht", "market", "lek", 6, "Bring the price of a shirt under 300 baht, or walk away.", ["Price", "Haggle", "Decide"]),
    _t("taxi-meter", "Airport, on the meter", "taxi", "ton", 6, "Get a taxi to the airport and ask for the meter.", ["Where to", "Meter", "Pay"]),
    _t("food-fried-rice", "Order not-spicy fried rice", "food", "nok", 9, "Order fried rice, not spicy, and say whether to eat here.", ["Dish", "Spice", "Here or away"]),
    _t("food-take-away", "Two plates to take away", "food", "nok", 9, "Order two dishes to take away, one a little spicy.", ["Dish", "Count", "Take away"]),
    _t("bar-beer", "Order two bottles of beer", "bar", "bank", 10, "Order two bottles of beer by classifier and say cheers.", ["Order", "Count", "Cheers"]),
    _t("market-count", "Three mangoes and a coconut", "market", "lek", 10, "Buy fruit by number and classifier, pay with cash.", ["Fruit", "Count", "Pay"]),
    _t("taxi-stop-here", "Get the taxi to stop at your soi", "taxi", "ton", 11, "Steer with left, right and straight on, then stop.", ["Turn", "Straight", "Stop"]),
    _t("hotel-toilet", "Ask where the toilet is", "hotel", "ploy", 12, "Ask where the toilet is and understand near or far.", ["Ask", "Understand"]),
    _t("taxi-tomorrow", "Book Ton for tomorrow morning", "taxi", "ton", 13, "Book the taxi for tomorrow morning and agree a time.", ["Day", "Time", "Confirm"]),
    _t("hotel-checkin", "Check in and book a wake-up call", "hotel", "ploy", 15, "Check in with your booking and ask for a wake-up call at a clock time.", ["Booking", "Room", "Wake-up"]),
    _t("hotel-wifi", "Breakfast time and the wifi", "hotel", "ploy", 16, "Ask when breakfast is and for the wifi password.", ["Breakfast", "Wifi"]),
    _t("food-papaya", "Papaya salad, a little spicy", "food", "nok", 17, "Order papaya salad a little spicy and say it is delicious.", ["Order", "Spice", "Taste"]),
    _t("market-sweet", "Which fruit is sweet?", "market", "lek", 17, "Ask which fruit is sweet, describe what you like.", ["Ask", "Taste", "Buy"]),
    _t("bar-small-talk", "Name, country, job", "bar", "bank", 18, "Small talk: names, where you are from, what you do.", ["Names", "Country", "Work"]),
    _t("pharmacy-headache", "Buy something for a headache", "pharmacy", "mai", 19, "Describe a headache and buy medicine.", ["Problem", "Medicine", "Pay"]),
    _t("pharmacy-allergy", "Say you are allergic", "pharmacy", "mai", 20, "Say what you are allergic to and ask how many times a day to take it.", ["Problem", "Allergy", "Dose"]),
    _t("bar-closing-time", "When does the bar close?", "bar", "bank", 23, "Ask when the bar closes and order one more round.", ["Ask", "Order"]),
    _t("shop-talk", "Ask what's allowed, talk only", "market", "lek", 24, "At a cannabis shop counter: ask whether it is legal here and where smoking is not allowed. Talk only, no purchase coaching.", ["Ask", "Rules"], adult=True),
    _t("hotel-lost-passport", "Report a lost passport", "hotel", "ploy", 25, "Tell Ploy you lost your passport and ask for help finding the police.", ["Problem", "Help"]),
    _t("hotel-complaint", "The air conditioning is broken", "hotel", "ploy", 26, "Complain politely that the air conditioning is broken and ask for another room.", ["Problem", "Ask", "Thank"]),
    _t("taxi-day-trip", "Plan a day trip to the pier", "taxi", "ton", 27, "Plan a trip to the pier: when, how long, how much.", ["Where", "When", "Price"]),
    _t("food-my-day", "Tell Nok about your day", "food", "nok", 28, "Tell Nok what you did today, in the past.", ["Morning", "Afternoon", "Evening"]),
]

CHAPTER_TASKS = [
    _t("meters-running-1", "Meter's Running, part 1", "taxi", "ton", 11, "An honest driver: greet, give directions by left, right and straight.", ["Greet"], "meters-running", reward={"baht": 0, "rep": 2}),
    _t("meters-running-2", "Meter's Running, part 2", "taxi", "ton", 14, "A flat fare: refuse it and ask for the meter, politely.", ["Fare", "Meter"], "meters-running", reward={"baht": 0, "rep": 2}),
    _t("after-hours-1", "After Hours, part 1", "bar", "fah", 21, "Small talk with Fah, a light compliment, ask if you may sit, and accept her no gracefully.", ["Small talk", "Compliment", "Ask to sit", "Goodbye"], "after-hours", adult=True, reward={"baht": 0, "rep": 3}),
    _t("after-hours-2", "After Hours, part 2", "bar", "bank", 22, "Bank offers you a drink; you say no politely, read the room, and leave on good terms.", ["Offer", "Your no", "Read the room", "Goodbye"], "after-hours", adult=True, reward={"baht": 0, "rep": 3}),
    _t("d2d-hotel", "Hotel check-in", "hotel", "ploy", 25, "Late check-in: greet, booking name, key.", ["Greet", "Key"], "door-to-door", reward={"baht": 0, "rep": 1}),
    _t("d2d-taxi", "Taxi", "taxi", "ton", 25, "Direct the driver and stop at the right place.", ["Turn", "Stop"], "door-to-door", reward={"baht": 0, "rep": 1}),
    _t("d2d-food", "Street food", "food", "nok", 25, "Order a dish at your spice level and pay.", ["Order", "Pay"], "door-to-door", reward={"baht": 0, "rep": 1}),
    _t("d2d-market", "Market", "market", "lek", 25, "Price, haggle and buy.", ["Price", "Buy"], "door-to-door", reward={"baht": 0, "rep": 1}),
    _t("d2d-pharmacy", "Pharmacy", "pharmacy", "mai", 25, "Describe the problem and understand the dose.", ["Problem", "Dose"], "door-to-door", reward={"baht": 0, "rep": 1}),
    _t("d2d-bar", "Night out", "bar", "bank", 25, "Order a round and leave on good terms.", ["Order", "Leave"], "door-to-door", reward={"baht": 0, "rep": 1}),
]

EXTENSION_TASKS = [
    _t("cafe-chat", "Café conversation", "food", "nok", 31, "Order iced Thai tea less sweet and say how you feel today.", ["Order", "Feelings"]),
    _t("clothes-shop", "Shopping for clothes", "market", "lek", 33, "Find trousers that fit: size, too big, too small, compare prices.", ["Size", "Try on", "Compare"]),
    _t("hotel-problems", "Hotel problems", "hotel", "ploy", 35, "The shower doesn't work and the room is noisy: chain two requests politely.", ["Problem", "Requests", "Thank"]),
    _t("station-lost-property", "Lost property at the station", "taxi", "ton", 38, "You left your backpack in Ton's taxi: describe it and arrange to get it.", ["Problem", "Describe", "Arrange"]),
    _t("book-train", "Book a train", "hotel", "ploy", 39, "Book an overnight train: one-way, lower berth, departure time.", ["Ticket", "Berth", "Time"]),
    _t("dinner-for-six", "Dinner for six", "food", "nok", 40, "Order for a group: a table for six, shared dishes, one allergy, split the bill.", ["Table", "Order", "Bill"]),
    _t("clinic-visit", "Clinic visit", "pharmacy", "mai", 41, "Describe symptoms since yesterday and understand a twice-a-day dose.", ["Symptoms", "Since", "Dose"]),
    _t("change-money", "Change money", "market", "lek", 45, "Ask the exchange rate and the fee, change pounds into baht.", ["Rate", "Fee", "Change"]),
    _t("night-out-plan", "Plan a night out", "bar", "bank", 48, "Invite Bank to live music: when and where to meet.", ["Invite", "Time", "Place"]),
    _t("airline-desk", "Airline desk", "hotel", "ploy", 52, "Your flight is delayed: ask about the next flight and a refund.", ["Problem", "Next flight", "Refund"]),
    _t("second-meeting", "A second meeting", "bar", "fah", 54, "A second evening with Fah: plans, asking before holding hands, respecting her pace. Non-explicit, consent-forward.", ["Plans", "Ask first", "Goodnight"], adult=True),
    _t("book-a-boat", "Book a boat", "taxi", "ton", 55, "Book a boat to an island: when the last boat leaves, life jackets.", ["Where", "Time", "Safety"]),
    _t("help-someone", "Help someone in trouble", "pharmacy", "mai", 56, "Someone fainted outside: ask if they are okay and call an ambulance.", ["Ask", "Call", "Stay"]),
]


def tasks() -> list[TaskSpec]:
    return STREET_TASKS + CHAPTER_TASKS + EXTENSION_TASKS


# ---------------------------------------------------------------- summaries

def counts(course_days: int = 60) -> dict:
    es = [e for e in entries() if e.day <= course_days]
    return {
        "items": len(es),
        "items_adult": sum(e.adult for e in es),
        "items_survival": sum(e.survival for e in es),
        "patterns": sum(p.day <= course_days for p in patterns()),
        "letters": sum(l.day <= course_days for l in letters()),
        "culture": sum(c.day <= course_days for c in culture_topics()),
        "tasks": sum(t.day <= course_days for t in tasks()),
        "per_day": {d: sum(1 for e in es if e.day == d) for d in range(1, course_days + 1)},
    }


def snapshot() -> dict:
    """Everything above as plain JSON (written to work/text/curriculum.json for reference)."""
    return {
        "spine": [asdict(d) for d in spine()],
        "entries": [asdict(e) for e in entries()],
        "patterns": [asdict(p) for p in patterns()],
        "letters": [asdict(l) for l in letters()],
        "culture": [asdict(c) for c in culture_topics()],
        "tasks": [asdict(t) for t in tasks()],
    }
