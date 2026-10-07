# School of the Night, sections 3 to 18: the lines, as recipes of course item ids.
# Line: (id, English, recipe, ending, [replies]); reply: (English, recipe, ending, answer line id).
# '_' is a space between phrases, 'I' the speaker's pronoun. Ids without a dot get the section prefix.


def W(id, thai, roman, tones, en):
    return {"id": "sw." + id, "thai": thai, "roman": roman, "tones": tones.split(), "en": en}


WORDS = [
    W("language", "ภาษา", "phaa-sǎa", "mid rising", "language"),
    W("thai", "ไทย", "thai", "mid", "Thai"),
    W("thailand", "เมืองไทย", "mʉang-thai", "mid mid", "Thailand"),
    W("learn", "เรียน", "rian", "mid", "learn, study"),
    W("write", "เขียน", "khǐan", "rising", "write"),
    W("means", "แปลว่า", "bplaae-wâa", "mid falling", "it means"),
    W("oh", "อ๋อ", "ǒo", "rising", "oh, I see"),
    W("sure", "แน่ใจ", "nâae-jai", "falling mid", "sure"),
    W("correct", "ถูก", "thùuk", "low", "correct, right"),
    W("hundred", "ร้อย", "ráawy", "high", "hundred"),
    W("not-really", "ไม่ค่อย", "mâi-khâwi", "falling falling", "not really, not much"),
    W("baang", "บ้าง", "bâang", "falling", "some (in a question: what all)"),
    W("run-out", "หมด", "mòt", "low", "run out, sold out"),
    W("around-here", "แถวนี้", "thǎeo-níi", "rising high", "around here"),
    W("this-one", "นี้", "níi", "high", "this (after a noun)"),
    W("that-one", "นั้น", "nán", "high", "that (after a noun)"),
    W("tonight", "คืนนี้", "khʉʉn-níi", "mid high", "tonight"),
    W("here-is", "นี่", "nîi", "falling", "here (handing something over)"),
    W("leave-with", "ฝาก", "fàak", "low", "leave with someone, deposit"),
    W("in-a-moment", "เดี๋ยว", "dǐao", "rising", "in a moment"),
    W("check-out", "เช็คเอาท์", "chék-ao", "high mid", "check out"),
    W("noon", "เที่ยง", "thîang", "falling", "noon"),
    W("call", "เรียก", "rîak", "falling", "call (for a taxi)"),
    W("make-yourself-comfortable", "ตามสบาย", "dtaam-sà-baai", "mid low mid", "take your time, as you like"),
    W("free", "ว่าง", "wâang", "falling", "free (not busy)"),
    W("all-day", "ทั้งวัน", "tháng-wan", "high mid", "all day"),
    W("line-app", "ไลน์", "lai", "mid", "LINE (the messaging app)"),
    W("relieve", "แก้", "gâae", "falling", "for (medicine that treats)"),
    W("lady-drink", "เลดี้ดริ๊งค์", "lee-dîi-dríng", "mid falling high", "lady drink"),
    W("treat", "เลี้ยง", "líang", "high", "buy (a drink) for someone, treat"),
    W("bar-fine", "บาร์ไฟน์", "baa-fai", "mid mid", "bar fine"),
    W("price", "ราคา", "raa-khaa", "mid mid", "price"),
    W("just", "แค่", "khâae", "falling", "just, only"),
    W("rest", "พักผ่อน", "phák-phàawn", "high low", "rest"),
    W("take-care", "ดูแลตัวเอง", "duu-laae-dtua-eeng", "mid mid mid mid", "take care of yourself"),
    W("mild", "อ่อนๆ", "àawn-àawn", "low low", "mild"),
    W("strong", "แรง", "raaeng", "mid", "strong"),
    W("medium", "กลางๆ", "glaang-glaang", "mid mid", "medium, in between"),
    W("style", "แบบ", "bàaep", "low", "kind, type"),
    W("flower", "ดอก", "dàawk", "low", "flower (bud)"),
    W("forbid", "ห้าม", "hâam", "falling", "not allowed to"),
    W("smoke", "สูบ", "sùup", "low", "smoke"),
    W("in", "ใน", "nai", "mid", "in"),
    W("public", "ที่สาธารณะ", "thîi-sǎa-thaa-rá-ná", "falling rising mid high high", "a public place"),
    W("fine", "ค่าปรับ", "khâa-bpràp", "falling low", "a fine"),
    W("must", "ต้อง", "dtâwng", "falling", "must, need to"),
    W("gram", "กรัม", "gram", "mid", "gram"),
    W("per", "ละ", "lá", "high", "per, each"),
    W("strain", "สายพันธุ์", "sǎai-phan", "rising mid", "strain"),
    W("indica", "อินดิก้า", "in-dì-gâa", "mid low falling", "indica"),
    W("sativa", "ซาติว่า", "saa-dtì-wâa", "mid low falling", "sativa"),
    W("lighter", "ไฟแช็ก", "fai-cháek", "mid high", "lighter"),
    W("go-back", "กลับ", "glàp", "low", "go back, return"),
    W("myself", "เอง", "eeng", "mid", "myself, on my own"),
    W("right-here", "ตรงนี้", "dtrong-níi", "mid high", "right here"),
    W("sweet-dreams", "ฝันดี", "fǎn-dii", "rising mid", "sweet dreams, good night"),
    W("together", "ด้วยกัน", "dûai-gan", "falling mid", "together"),
    W("again", "อีก", "ìik", "low", "again, more"),
    W("last", "สุดท้าย", "sùt-tháai", "low high", "last"),
    W("walking-street", "ถนนคนเดิน", "thà-nǒn-khon-dəən", "low rising mid mid", "Walking Street"),
]

FRAMES = {
    # new frames (the core ones are already in the file)
    "i-like": ("I like ___", "like X", "s"),
    "very": ("It's very ___", "X very", "s"),
    "doesnt-work": ("The ___ doesn't work", "X doesnt-work", "s"),
    "went-to": ("I went to ___", "bpai X come", "s"),
    "meet-at": ("See you at ___", "see-you at X softening-particle-na", "s"),
    "see-you-when": ("See you ___", "see-you X softening-particle-na", "s"),
    "would-you-like": ("Would you like to ___?", "want-to-do X mai-q", "q"),
}

S, Q = "s", "q"

SECTIONS = {
    3: {
        "prefix": "nu", "door": "what-mean",
        "lines": [
            ("what-mean", "What does it mean?", "what-does-it-mean", Q, [
                ("It means \"delicious\".", "sw.means delicious", S, "ah-got-it"),
                ("I don't know either.", "mai-not know same", S, "no-worries"),
            ]),
            ("what-is-this", "What's this?", "this what", Q, [
                ("Papaya salad.", "papaya-salad", S, "ah-got-it"),
                ("Sticky rice.", "sticky-rice", S, "ah-got-it"),
            ]),
            ("how-say", "How do you say this in Thai?", "this sw.language sw.thai how-do-you-say", Q, [
                ("Mango.", "mango", S, "ah-got-it"),
                ("Coconut.", "coconut", S, "ah-got-it"),
            ]),
            ("ah-got-it", "Ah, I get it now.", "sw.oh _ understand already", S),
            ("what-was-that", "Sorry, what was that?", "what softening-particle-na", Q),
            ("english", "Do you speak English?", "speak sw.language england dai mai-q", Q, [
                ("A little.", "dai a-little", S, "mk.thank-you"),
                ("No, I can't.", "speak cannot", S, "am.a-little-thai"),
            ]),
            ("learning", "I'm learning Thai.", "I in-progress sw.learn sw.language sw.thai", S, [
                ("Well done!", "well-done", S, "mk.thank-you"),
                ("Your Thai is very good.", "speak sw.thai well-done", S, "mk.thank-you"),
            ]),
            ("write", "Could you write it down for me?", "sw.write give noi dai mai-q", Q, [
                ("Sure.", "dai", S, "mk.thank-you"),
            ]),
            ("did-i-say-right", "Did I say it right?", "speak sw.correct mai-q", Q, [
                ("That's right.", "thats-right", S, "mk.thank-you"),
                ("Very good!", "well-done", S, "mk.thank-you"),
            ]),
            ("do-you-understand", "Do you understand?", "understand mai-q", Q, [
                ("Yes, I understand.", "understand", S, "mk.thank-you"),
                ("I don't understand.", "dont-understand", S, "wait"),
            ]),
            ("wait", "Wait a moment.", "wait-a-moment", S),
            ("dont-know", "I don't know.", "mai-not know", S),
            ("louder", "Could you speak louder?", "speak-louder", S),
            ("no-worries", "No worries.", "never-mind", S),
        ],
        "frames": [
            ("not", [
                ("understand", "understand", "understand"),
                ("know", "know", "know"),
                ("sure", "sure", "sw.sure"),
                ("hear", "hear (I didn't catch it)", "hear"),
            ]),
            ("already", [
                ("understand", "understand", "understand"),
                ("know", "know", "know"),
                ("remember", "remember", "remember"),
            ]),
        ],
    },
    4: {
        "prefix": "nm", "door": "what-time",
        "lines": [
            ("how-much-all", "How much altogether?", "how-much-altogether", Q, [
                ("Two hundred and fifty baht.", "the-pattern-for-prices", S, "card"),
                ("A hundred baht.", "n100 baht", S, "cash"),
            ]),
            ("card", "Can I pay by card?", "pay card dai mai-q", Q, [
                ("Yes, you can.", "dai", S, "mk.thank-you"),
                ("Cash only.", "cash only", S, "atm"),
            ]),
            ("cash", "I'll pay cash.", "pay cash", S),
            ("atm", "Where's a cash machine?", "cash-machine where-is", Q, [
                ("Opposite the hotel.", "be-at opposite hotel", S, "mk.got-it"),
                ("Next to the bank.", "be-at next-to bank", S, "mk.got-it"),
            ]),
            ("change", "Do you have change?", "have-or-there-is change-money-back mai-q", Q, [
                ("Yes.", "have-or-there-is", S, "mk.thank-you"),
                ("Sorry, I don't have change.", "sorry _ mai-not have-or-there-is change-money-back", S, "card"),
            ]),
            ("keep-change", "Keep the change.", "keep-the-change", S, [
                ("Thank you very much.", "thank-you-very-much", S, "nu.no-worries"),
            ]),
            ("receipt", "Can I have a receipt?", "khaw receipt noi", S),
            ("exchange", "Where can I change money?", "exchange-money where dai", Q, [
                ("At the bank.", "at bank", S, "mk.thank-you"),
                ("Over there.", "there", S, "mk.thank-you"),
            ]),
            ("what-time", "What time is it?", "what-time already", Q, [
                ("Two in the afternoon.", "clock-word-for-afternoon-hours n2", S, "mk.thank-you"),
                ("Eight in the evening.", "n2 clock-word-for-evening-hours", S, "mk.thank-you"),
            ]),
            ("close-time", "What time do you close?", "close what-time", Q, [
                ("Eleven at night.", "n5 clock-word-for-evening-hours", S, "mk.got-it"),
                ("Two in the morning.", "clock-word-for-1-to-5-a-m n2", S, "mk.got-it"),
            ]),
            ("how-long", "How long does it take?", "how-long", Q, [
                ("Twenty minutes.", "n20 minute", S, "can-wait"),
                ("One hour.", "n1 hour", S, "can-wait"),
            ]),
            ("can-wait", "Okay, I can wait.", "okay _ wait dai", S),
        ],
        "frames": [
            ("how-much", [
                ("one-night", "one night", "n1 night-counting-nights-of-a-stay"),
                ("ticket", "a ticket", "ticket"),
                ("one-hour", "one hour", "n1 hour"),
                ("two", "two of them", "n2 cl-thing"),
            ]),
            ("can-i-have", [
                ("receipt", "a receipt", "receipt"),
                ("change", "my change", "change-money-back"),
                ("bag", "a bag", "bag-carrier-bag"),
            ]),
        ],
    },
    5: {
        "prefix": "lk", "door": "do-you-like",
        "lines": [
            ("do-you-like", "Do you like it?", "like mai-q", Q, [
                ("I like it a lot.", "like very", S, "me-too"),
                ("Not really.", "sw.not-really like", S, "why"),
            ]),
            ("love-it", "I love it.", "like very", S),
            ("me-too", "I like it too.", "I also like same", S),
            ("not-really", "I don't really like it.", "sw.not-really like", S, [
                ("Why?", "why", Q, "too-spicy"),
                ("Really?", "really-checking", Q, "too-spicy"),
            ]),
            ("why", "Why?", "why", Q),
            ("too-spicy", "It's too spicy.", "spicy too-much", S),
            ("what-food", "What food do you like?", "like gin what", Q, [
                ("I like papaya salad.", "like papaya-salad", S, "me-too"),
                ("I can eat anything.", "gin dai completely", S, "great"),
            ]),
            ("favourite", "Which one do you like best?", "like cl-thing which the-most", Q, [
                ("This one.", "this", S, "me-too"),
            ]),
            ("great", "That's great!", "good particle-for-so-jang emphasis-particle-loei", S),
            ("beautiful-here", "It's really beautiful here.", "here beautiful very", S, [
                ("Do you like Thailand?", "like sw.thailand mai-q", Q, "love-it"),
                ("Have you been to the islands?", "have-ever-done bpai island mai-q", Q, "pl.tomorrow-island"),
            ]),
            ("i-think-good", "I think it's good.", "I in-my-opinion good", S),
            ("think-so-too", "I think so too.", "i-think-so-too", S),
            ("dont-think-so", "I don't think so.", "i-dont-think-so", S),
            ("it-depends", "It depends.", "it-depends", S),
        ],
        "frames": [
            ("i-like", [
                ("isaan-food", "Isaan food", "north-eastern-food"),
                ("spicy", "it spicy", "spicy"),
                ("music", "music", "music"),
                ("sea", "the sea", "sea"),
            ]),
            ("very", [
                ("beautiful", "beautiful", "beautiful"),
                ("delicious", "delicious", "delicious"),
                ("fun", "fun", "fun"),
                ("funny", "funny", "funny"),
            ]),
        ],
    },
    6: {
        "prefix": "fd", "door": "pad-thai",
        "lines": [
            ("two-people", "Two people.", "n2 cl-person", S),
            ("recommend", "What do you recommend?", "what-do-you-recommend good", Q, [
                ("The pad thai is good.", "pad-thai delicious", S, "ill-have-that"),
                ("Grilled chicken with sticky rice.", "grilled-chicken with sticky-rice", S, "ill-have-that"),
            ]),
            ("ill-have-that", "Okay, I'll have this one.", "okay _ ill-take-it", S),
            ("pad-thai", "I'd like pad thai.", "ao pad-thai", S, [
                ("Spicy?", "spicy mai-q", Q, "not-spicy"),
                ("Sorry, it's sold out.", "sw.run-out already", S, "what-have"),
                ("Eat here or take away?", "eat-here or take-away", Q, "eat-here"),
            ]),
            ("not-spicy", "Not spicy.", "not-spicy", S),
            ("little-spicy", "Just a little spicy.", "little-spicy", S),
            ("what-have", "What do you have?", "have-or-there-is what sw.baang", Q, [
                ("Fried rice and noodles.", "fried-rice _ noodles", S, "ill-have-that"),
            ]),
            ("eat-here", "To eat here.", "eat-here", S),
            ("take-away", "Take away, please.", "take-away", S),
            ("iced-coffee", "Iced coffee, not too sweet.", "coffee iced _ less-sweet", S),
            ("delicious", "It's delicious!", "delicious very", S),
            ("full", "I'm full.", "full already", S),
            ("bill", "The bill, please.", "the-bill-please", S, [
                ("Two hundred and fifty baht.", "the-pattern-for-prices", S, "nm.card"),
            ]),
            ("allergic", "I'm allergic to peanuts.", "I allergic-to peanuts", S, [
                ("Okay, no peanuts.", "dai _ without peanuts", S, "mk.thank-you"),
            ]),
        ],
        "frames": [
            ("id-like", [
                ("fried-rice", "fried rice", "fried-rice"),
                ("som-tam", "papaya salad", "papaya-salad"),
                ("sticky-rice", "sticky rice", "sticky-rice"),
                ("thai-tea", "an iced Thai tea", "iced-thai-tea"),
            ]),
            ("can-i-have", [
                ("ice", "some ice", "ice"),
                ("more-rice", "another plate of rice", "another-plate-of-rice"),
                ("bill", "the bill", "the-bill"),
            ]),
            ("do-you-have", [
                ("beer", "beer", "beer"),
                ("vegetarian", "vegetarian food", "vegetarian"),
                ("seafood", "seafood", "seafood"),
            ]),
        ],
    },
    7: {
        "prefix": "ga", "door": "airport",
        "lines": [
            ("airport", "To the airport, please.", "go-to airport", S, [
                ("Five hundred baht.", "n5 sw.hundred baht", S, "meter"),
                ("The traffic's bad, you know.", "traffic-jam softening-particle-na", S, "nu.no-worries"),
            ]),
            ("meter", "Use the meter, please.", "use-the-meter-please", S, [
                ("Okay.", "okay", S, "mk.thank-you"),
            ]),
            ("how-much-hotel", "How much to the hotel?", "go-to hotel how-much", Q, [
                ("Two hundred baht.", "n2 sw.hundred baht", S, "ok-go"),
                ("Five hundred baht.", "n5 sw.hundred baht", S, "hg.too-expensive"),
            ]),
            ("ok-go", "Okay, let's go.", "okay _ bpai emphasis-particle-loei", S),
            ("stop-here", "Stop here, please.", "stop-here", S),
            ("turn-left", "Turn left.", "turn left", S),
            ("slow-down", "Slow down a bit, please.", "slow-down noi", S),
            ("is-it-far", "Is it far?", "far mai-q", Q, [
                ("Not far, you can walk.", "mai-not far _ walk bpai dai", S, "mk.got-it"),
                ("Very far.", "far very", S, "take-taxi"),
            ]),
            ("take-taxi", "Then I'll take a taxi.", "so-then sit taxi bpai", S),
            ("bar-near", "Is there a bar around here?", "sw.around-here have-or-there-is bar mai-q", Q, [
                ("Yes, a rooftop bar.", "have-or-there-is _ rooftop-bar", S, "how-get"),
                ("Yes, down that soi.", "have-or-there-is _ be-at side-street sw.that-one", S, "mk.got-it"),
            ]),
            ("how-get", "How do I get there?", "bpai how", Q),
            ("which-club", "Which club is good?", "club which good", Q, [
                ("This one's fun.", "shop sw.this-one fun", S, "lets-go"),
                ("It's crowded tonight.", "sw.tonight crowded", S, "nu.no-worries"),
            ]),
            ("lets-go", "Let's go!", "lets-go", S),
            ("lost", "I'm lost.", "I lost-my-way", S, [
                ("Where are you going?", "will bpai which", Q, "gh.this-hotel"),
            ]),
        ],
        "frames": [
            ("going-to", [
                ("beach", "the beach", "beach"),
                ("club", "a club", "club"),
                ("temple", "the temple", "temple"),
                ("walking-street", "Walking Street", "sw.walking-street"),
            ]),
            ("where-is", [
                ("skytrain", "the skytrain station", "station skytrain"),
                ("pier", "the pier", "pier"),
                ("motorbike-taxi", "the motorbike taxis", "motorbike-taxi"),
            ]),
            ("how-much", [
                ("to-airport", "it to the airport", "go-to airport"),
                ("to-beach", "it to the beach", "go-to beach"),
            ]),
        ],
    },
    8: {
        "prefix": "ht", "door": "check-in",
        "lines": [
            ("check-in", "I'd like to check in, please.", "khaw check-in noi", S, [
                ("Have you booked?", "booking already yet", Q, "booked"),
                ("Can I see your passport?", "khaw passport noi", S, "here-you-are"),
                ("Check-in is at two.", "check-in clock-word-for-afternoon-hours n2", S, "leave-bags"),
            ]),
            ("booked", "Yes, I've booked.", "booking already", S),
            ("here-you-are", "Here you are.", "sw.here-is", S),
            ("leave-bags", "Can I leave my bags here?", "sw.leave-with luggage dai mai-q", Q, [
                ("Yes, you can.", "dai", S, "mk.thank-you"),
            ]),
            ("breakfast", "What time is breakfast?", "breakfast what-time", Q, [
                ("From seven in the morning.", "n7 clock-word-for-morning-hours", S, "mk.thank-you"),
            ]),
            ("checkout-time", "What time is check-out?", "sw.check-out what-time", Q, [
                ("At noon.", "sw.noon", S, "late-checkout"),
            ]),
            ("late-checkout", "Can I check out a bit late?", "khaw sw.check-out late noi dai mai-q", Q, [
                ("Yes, until two.", "dai to clock-word-for-afternoon-hours n2", S, "mk.thank-you"),
                ("Sorry, we can't.", "sorry _ cannot", S, "nu.no-worries"),
            ]),
            ("ac-broken", "The air-con is broken.", "air-conditioning broken", S, [
                ("Which room?", "room which", Q, "room-305"),
                ("Sorry, we'll fix it.", "sorry _ sw.in-a-moment fix give", S, "mk.thank-you"),
            ]),
            ("room-305", "Room 305.", "room n3 n0 n5", S),
            ("no-hot-water", "There's no hot water.", "mai-not have-or-there-is hot-water", S, [
                ("Which room?", "room which", Q, "room-305"),
            ]),
            ("change-room", "Can I change rooms?", "khaw change-rooms dai mai-q", Q, [
                ("Why?", "why", Q, "noisy"),
                ("Yes, wait a moment.", "dai _ wait-a-moment", S, "mk.thank-you"),
            ]),
            ("noisy", "It's very noisy.", "noisy very", S),
            ("lost-key", "I've lost my key.", "key lost-something", S, [
                ("Which room?", "room which", Q, "room-305"),
            ]),
            ("call-taxi", "Could you call me a taxi?", "please sw.call taxi give noi", S),
        ],
        "frames": [
            ("can-i-have", [
                ("towel", "a towel", "towel"),
                ("blanket", "a blanket", "blanket"),
                ("wifi", "the wifi password", "wifi-password"),
            ]),
            ("do-you-have", [
                ("room", "a room", "room"),
                ("breakfast", "breakfast", "breakfast"),
            ]),
            ("doesnt-work", [
                ("light", "light", "light-lamp"),
                ("shower", "shower", "shower"),
                ("aircon", "air-con", "air-conditioning"),
            ]),
        ],
    },
    9: {
        "prefix": "hg", "door": "too-expensive",
        "lines": [
            ("how-much-two", "How much for two?", "n2 cl-thing how-much", Q, [
                ("Three hundred baht.", "n3 sw.hundred baht", S, "too-expensive"),
                ("Two hundred and fifty baht.", "the-pattern-for-prices", S, "offer"),
            ]),
            ("too-expensive", "Too expensive.", "too-expensive", S, [
                ("How much will you give?", "give how-much", Q, "offer"),
                ("It's already cheap.", "cheap already", S, "reduce"),
            ]),
            ("reduce", "Can you lower the price?", "reduce", Q, [
                ("Okay, two hundred and fifty.", "dai _ the-pattern-for-prices", S, "mk.ill-take-it"),
                ("No, that's the last price.", "cannot _ last-price already", S, "come-back"),
            ]),
            ("last-price", "What's your last price?", "last-price how-much", Q, [
                ("Two hundred baht.", "n2 sw.hundred baht", S, "mk.ill-take-it"),
                ("Three hundred baht.", "n3 sw.hundred baht", S, "offer"),
            ]),
            ("offer", "Two hundred, okay?", "n2 sw.hundred dai mai-q", Q, [
                ("You're good at bargaining!", "youre-good-at-bargaining softening-particle-na", S, "mk.ill-take-it"),
                ("Okay, fine.", "okay _ dai", S, "mk.ill-take-it"),
            ]),
            ("buy-two", "If I buy two, can you lower it?", "if buy n2 cl-thing _ reduce", Q, [
                ("Okay, two for four hundred.", "dai _ n2 cl-thing n4 sw.hundred", S, "mk.ill-take-it"),
            ]),
            ("cash-discount", "If I pay cash, can you lower it?", "pay cash _ reduce", Q),
            ("just-looking", "Just looking.", "just-looking", S, [
                ("Take your time.", "sw.make-yourself-comfortable", S, "mk.thank-you"),
            ]),
            ("come-back", "I'll come back later.", "sw.in-a-moment come-back", S),
            ("try-on", "Can I try it on?", "try-on dai mai-q", Q, [
                ("Yes, the fitting room is there.", "dai _ fitting-room be-at there", S, "mk.thank-you"),
                ("Sorry, you can't try it on.", "try-on cannot", S, "nu.no-worries"),
            ]),
            ("too-big", "It's too big.", "too-big", S, [
                ("We have a smaller one.", "have-or-there-is smaller sw.this-one", S, "try-on"),
            ]),
            ("fits", "It fits perfectly.", "fits-well emphasis-particle-loei", S),
        ],
        "frames": [
            ("how-much", [
                ("shoes", "the shoes", "shoes"),
                ("trousers", "the trousers", "trousers"),
                ("backpack", "the backpack", "backpack"),
            ]),
            ("do-you-have", [
                ("colour", "another colour", "another-colour"),
                ("smaller", "a smaller one", "smaller sw.this-one"),
                ("bigger", "a bigger one", "bigger sw.this-one"),
            ]),
            ("can-i-have", [
                ("bag", "a bag", "bag-carrier-bag"),
                ("receipt", "a receipt", "receipt"),
            ]),
        ],
    },
    10: {
        "prefix": "pl", "door": "what-today",
        "lines": [
            ("what-today", "What are you doing today?", "today do what", Q, [
                ("I'm going to the beach today.", "today bpai sea", S, "count-me-in"),
                ("I'm free.", "sw.free", S, "want-beach"),
            ]),
            ("count-me-in", "I'll come too!", "count-me-in", S),
            ("want-beach", "Do you want to go to the beach?", "want-to-do bpai sea mai-q", Q, [
                ("Sure.", "dai emphasis-particle-loei", S, "ga.lets-go"),
                ("Maybe next time.", "maybe-next-time softening-particle-na", S, "nu.no-worries"),
            ]),
            ("tomorrow-island", "Tomorrow I'm going to an island.", "tomorrow will bpai island", S, [
                ("Which island?", "island which", Q, "not-sure-yet"),
                ("How are you getting there?", "bpai how", Q, "speedboat"),
            ]),
            ("not-sure-yet", "I'm not sure yet.", "still mai-not sw.sure", S),
            ("speedboat", "By speedboat.", "sit speedboat bpai", S),
            ("where-go", "Where's good to go around here?", "sw.around-here _ go-out-for-fun where good", Q, [
                ("The islands are good.", "bpai island good", S, "good-idea"),
                ("The sea is beautiful.", "sea beautiful", S, "good-idea"),
            ]),
            ("good-idea", "Sounds good.", "good emphasis-particle-loei", S),
            ("snorkel", "I want to go snorkelling.", "want-to-do bpai go-snorkelling", S, [
                ("Have you snorkelled before?", "have-ever-done go-snorkelling mai-q", Q, "never"),
            ]),
            ("never", "Never.", "never-have-done", S),
            ("last-boat", "When does the last boat leave?", "when-does-the-last-boat-leave", Q, [
                ("Four in the afternoon.", "clock-word-for-afternoon-hours n4", S, "mk.got-it"),
            ]),
            ("if-rain", "If it rains, I won't go.", "if rain also mai-not bpai", S),
            ("changed-mind", "I've changed my mind.", "change-plans already", S),
            ("next-time", "Maybe next time.", "maybe-next-time softening-particle-na", S),
        ],
        "frames": [
            ("want-to", [
                ("beach", "go to the beach", "bpai sea"),
                ("snorkel", "go snorkelling", "bpai go-snorkelling"),
                ("temple", "go to a temple", "bpai temple"),
                ("swim", "go swimming", "bpai swim"),
            ]),
            ("going-to", [
                ("island", "an island", "island"),
                ("market", "the market", "market"),
                ("beach", "the beach", "beach"),
            ]),
        ],
    },
    11: {
        "prefix": "md", "door": "went-beach",
        "lines": [
            ("went-beach", "Today I went to the beach.", "today bpai sea come", S, [
                ("Was it fun?", "fun mai-q", Q, "am.great-fun"),
                ("Did you get to swim?", "dai swim mai-q", Q, "swam"),
            ]),
            ("swam", "I swam all day.", "swim sw.all-day emphasis-particle-loei", S),
            ("temple", "This morning I went to a temple.", "this-morning bpai temple come", S, [
                ("Was it beautiful?", "beautiful mai-q", Q, "lk.beautiful-here"),
            ]),
            ("ate-somtam", "I had papaya salad.", "gin papaya-salad come", S, [
                ("Was it spicy?", "spicy mai-q", Q, "very-spicy"),
                ("Was it good?", "delicious mai-q", Q, "fd.delicious"),
            ]),
            ("very-spicy", "Very spicy!", "spicy very", S),
            ("tired", "I'm really tired.", "tired very", S, [
                ("Why?", "why", Q, "walked-all-day"),
            ]),
            ("walked-all-day", "I walked all day.", "walk sw.all-day emphasis-particle-loei", S),
            ("last-night", "Last night I went out with friends.", "last-night bpai go-out-for-fun with friend", S, [
                ("Where did you go?", "bpai which come", Q, "rooftop"),
                ("Were you drunk?", "drunk mai-q", Q, "a-little"),
            ]),
            ("rooftop", "I went to a rooftop bar.", "bpai rooftop-bar come", S),
            ("a-little", "A little.", "a-little", S),
            ("met-friend", "I met a Thai friend.", "meet friend cl-person sw.thai", S),
            ("and-then", "And then we went to eat.", "and-then bpai gin rice", S),
            ("unforgettable", "It was unforgettable.", "unforgettable emphasis-particle-loei", S),
        ],
        "frames": [
            ("went-to", [
                ("beach", "the beach", "sea"),
                ("market", "the market", "market"),
                ("temple", "a temple", "temple"),
                ("island", "an island", "island"),
            ]),
            ("already", [
                ("eaten", "ate", "gin rice"),
                ("bought", "bought it", "buy"),
                ("arrived", "arrived", "arrive"),
            ]),
        ],
    },
    12: {
        "prefix": "mt", "door": "free-tomorrow",
        "lines": [
            ("free-tomorrow", "Are you free tomorrow?", "tomorrow are-you-free", Q, [
                ("Yes, I'm free.", "sw.free", S, "what-time"),
                ("No, I'm busy.", "mai-not sw.free", S, "pl.next-time"),
            ]),
            ("what-time", "What time shall we meet?", "what-time-shall-we-meet", Q, [
                ("Seven in the evening.", "n1 clock-word-for-evening-hours", S, "ok-see-you"),
                ("Up to you.", "it-depends you", S, "how-about-eight"),
            ]),
            ("how-about-eight", "How about eight?", "n2 clock-word-for-evening-hours good mai-q", Q, [
                ("Sure.", "dai emphasis-particle-loei", S, "ok-see-you"),
            ]),
            ("where", "Where shall we meet?", "where-shall-we-meet", Q, [
                ("In front of the hotel.", "in-front-of hotel", S, "ok-see-you"),
                ("At the café.", "at cafe", S, "ok-see-you"),
            ]),
            ("ok-see-you", "Okay, see you then.", "okay _ see-you", S),
            ("late", "I'll be a bit late.", "ill-be-a-bit-late softening-particle-na", S, [
                ("No problem.", "never-mind", S, "mk.thank-you"),
                ("How long?", "how-long", Q, "ten-min"),
            ]),
            ("ten-min", "Ten minutes.", "n10 minute", S),
            ("arrived", "I'm here.", "arrive already", S, [
                ("Where are you?", "be-at which", Q, "in-front"),
            ]),
            ("in-front", "I'm in front of the hotel.", "be-at in-front-of hotel", S),
            ("where-are-you", "Where are you?", "be-at which", Q),
            ("number", "Can I have your number?", "can-i-have-your-number", Q, [
                ("Do you have LINE?", "have-or-there-is sw.line-app mai-q", Q, "yes-have"),
                ("Sure.", "dai", S, "call-me"),
            ]),
            ("yes-have", "Yes, I do.", "have-or-there-is", S),
            ("call-me", "Give me a call.", "phone come softening-particle-na", S),
            ("cant-today", "Sorry, I can't make it today.", "sorry _ today bpai cannot", S, [
                ("No problem, next time.", "never-mind _ maybe-next-time", S, "mk.thank-you"),
            ]),
        ],
        "frames": [
            ("meet-at", [
                ("hotel", "the hotel", "hotel"),
                ("cafe", "the café", "cafe"),
                ("station", "the station", "station"),
                ("beach", "the beach", "beach"),
            ]),
            ("see-you-when", [
                ("tomorrow", "tomorrow", "tomorrow"),
                ("evening", "this evening", "evening"),
                ("seven", "at seven tonight", "n1 clock-word-for-evening-hours"),
            ]),
        ],
    },
    13: {
        "prefix": "ph", "door": "headache",
        "lines": [
            ("pharmacy-near", "Is there a pharmacy around here?", "sw.around-here have-or-there-is pharmacy mai-q", Q, [
                ("Yes, over there.", "have-or-there-is _ be-at there", S, "mk.thank-you"),
                ("No, there isn't.", "mai-not have-or-there-is", S, "nu.no-worries"),
            ]),
            ("headache", "I have a headache.", "headache", S, [
                ("Since when?", "be since when", Q, "since-yesterday"),
                ("Are you allergic to any medicine?", "allergic-to medicine mai-q", Q, "no-allergy"),
            ]),
            ("diarrhoea", "I have diarrhoea.", "diarrhoea", S, [
                ("Since when?", "be since when", Q, "since-yesterday"),
            ]),
            ("since-yesterday", "Since yesterday.", "since yesterday", S),
            ("no-allergy", "I'm not allergic.", "mai-not allergic-to", S),
            ("how-take", "How do I take it?", "gin how", Q, [
                ("Twice a day, after meals.", "twice-a-day _ after-meals", S, "mk.got-it"),
            ]),
            ("doctor", "I'd like to see a doctor.", "want-to-do bpai look-for doctor", S, [
                ("There's a clinic over there.", "have-or-there-is clinic be-at there", S, "ga.how-get"),
            ]),
            ("lost-wallet", "I've lost my wallet.", "wallet lost-something", S, [
                ("Where did you lose it?", "lost-something where", Q, "nu.dont-know"),
                ("You need to go to the police.", "sw.must bpai look-for police", S, "police-station"),
            ]),
            ("police-station", "Where's the police station?", "station police where-is", Q),
            ("help", "Help!", "help", S),
            ("ambulance", "Please call an ambulance.", "please call-an-ambulance noi", S, [
                ("Are you okay?", "are-you-okay", Q, "fainted"),
            ]),
            ("fainted", "My friend has fainted.", "friend someone-fainted", S),
            ("insurance", "I have insurance.", "I have-or-there-is insurance", S),
        ],
        "frames": [
            ("do-you-have", [
                ("headache-medicine", "medicine for a headache", "medicine sw.relieve headache"),
                ("diarrhoea-medicine", "medicine for diarrhoea", "medicine sw.relieve diarrhoea"),
                ("throat-medicine", "medicine for a sore throat", "medicine sw.relieve sore-throat"),
                ("sunscreen", "sunscreen", "sunscreen"),
            ]),
            ("where-is", [
                ("hospital", "the hospital", "hospital"),
                ("clinic", "the clinic", "clinic"),
                ("pharmacy", "the pharmacy", "pharmacy"),
            ]),
        ],
    },
    14: {
        "prefix": "br", "door": "cheers",
        "lines": [
            ("beer", "A beer, please.", "ao beer", S, [
                ("Big bottle or small?", "cl-bottle big or cl-bottle small", Q, "big-bottle"),
            ]),
            ("big-bottle", "A big bottle.", "cl-bottle big", S),
            ("one-more-bottle", "One more bottle, please.", "one-more cl-bottle", S),
            ("another-round", "Another round!", "one-more-round", S),
            ("cheers", "Cheers!", "cheers", S),
            ("what-drinking", "What are you drinking?", "what-are-you-drinking", Q, [
                ("Beer.", "beer", S, "same"),
                ("I don't drink.", "mai-not drink", S, "nu.no-worries"),
            ]),
            ("same", "Same for me.", "same", S),
            ("my-treat", "It's on me.", "my-treat", S, [
                ("Really? Thank you.", "true really-checking _ thank-you", S, "nu.no-worries"),
                ("Let's split it.", "split-the-bill", S, "okay"),
            ]),
            ("okay", "Okay.", "okay", S),
            ("live-music", "Is there live music tonight?", "sw.tonight have-or-there-is live-music mai-q", Q, [
                ("Yes, at ten.", "have-or-there-is _ n4 clock-word-for-evening-hours", S, "okay"),
                ("No, there isn't.", "mai-not have-or-there-is", S, "nu.no-worries"),
            ]),
            ("can-i-sit", "Can I sit here?", "can-i-sit-here", Q, [
                ("Sure, go ahead.", "dai emphasis-particle-loei", S, "mk.thank-you"),
                ("Sorry, someone's sitting here.", "have-or-there-is cl-person sit already", S, "nu.no-worries"),
            ]),
            ("a-bit-drunk", "I'm a bit drunk.", "drunk a-little", S),
            ("last-glass", "This is my last one.", "cl-glass sw.last already", S),
        ],
        "frames": [
            ("id-like", [
                ("two-beers", "two beers", "beer n2 cl-bottle"),
                ("big-bottle", "a big bottle", "cl-bottle big"),
                ("water", "water", "water"),
            ]),
            ("can-i-have", [
                ("ice", "some ice", "ice"),
                ("bill", "the bill", "the-bill"),
                ("menu", "the menu", "menu"),
            ]),
        ],
    },
    15: {
        "prefix": "fl", "door": "smile",
        "lines": [
            ("buy-drink", "Can I buy you a drink?", "can-i-buy-you-a-drink", Q, [
                ("Sure, thank you.", "dai _ thank-you", S, "br.what-drinking"),
                ("No thanks, I'm here with a friend.", "never-mind _ come with friend", S, "no-problem"),
            ]),
            ("smile", "You have a lovely smile.", "you-have-a-nice-smile", S, [
                ("Thank you.", "thank-you", S, "like-talking"),
                ("Don't tease me!", "dont-tease-me softening-particle-na", S, "mean-it"),
            ]),
            ("mean-it", "I mean it.", "really-truly", S),
            ("like-talking", "I like talking to you.", "i-like-talking-to-you", S),
            ("see-again", "Can I see you again?", "see-you sw.again dai mai-q", Q, [
                ("Sure.", "dai emphasis-particle-loei", S, "mt.free-tomorrow"),
            ]),
            ("dinner", "Shall we go for dinner together?", "bpai gin rice sw.together mai-q", Q, [
                ("Sure, when?", "dai _ when", Q, "tomorrow-evening"),
                ("Sorry, I have a boyfriend.", "sorry _ have-or-there-is boyfriend-or-girlfriend already", S, "no-problem"),
            ]),
            ("tomorrow-evening", "Is tomorrow evening okay?", "tomorrow evening dai mai-q", Q),
            ("single", "Are you single?", "single mai-q", Q, [
                ("Yes, I'm single.", "single", S, "dinner"),
                ("I have a boyfriend.", "have-or-there-is boyfriend-or-girlfriend already", S, "no-problem"),
            ]),
            ("is-this-ok", "Is this okay for you?", "is-this-okay-for-you", Q, [
                ("Yes, it's okay.", "okay", S, "like-talking"),
                ("I'm not comfortable.", "im-not-comfortable", S, "mk.sorry"),
            ]),
            ("hold-hand", "Can I hold your hand?", "can-i-hold-your-hand", Q, [
                ("Okay.", "dai", S, "is-this-ok"),
                ("I'd like to take it slowly.", "id-like-to-take-it-slowly", S, "no-problem"),
            ]),
            ("walk-home", "Can I walk you home?", "can-i-walk-you-home", Q, [
                ("Okay.", "dai", S, "ga.lets-go"),
                ("It's fine, I'll take a taxi home.", "never-mind _ sit taxi go-home", S, "message-home"),
            ]),
            ("message-home", "Message me when you get home.", "message-me-when-you-get-home", S),
            ("good-time", "I had a great time tonight.", "sw.tonight i-had-a-good-time", S),
            ("no-problem", "No problem, I understand.", "no-problem-accepting-a-no", S),
        ],
        "frames": [
            ("would-you-like", [
                ("dance", "go dancing", "bpai dance"),
                ("eat", "eat something", "gin what"),
                ("drink", "drink something", "drink what"),
                ("beach", "go to the beach", "bpai beach"),
            ]),
            ("can-i", [
                ("call", "call you", "phone look-for"),
                ("sit-here", "sit here", "sit sw.right-here"),
                ("see-again", "see you again", "see-you sw.again"),
            ]),
        ],
    },
    16: {
        "prefix": "wg", "door": "drink-something",
        "note": "Polite, clear and respectful: prices before anything, a firm no when you mean it, and checking she is okay.",
        "lines": [
            ("drink-something", "Would you like a drink?", "drink what mai-q", Q, [
                ("Will you buy me a lady drink?", "sw.treat sw.lady-drink noi dai mai-q", Q, "ld-price"),
                ("Okay, thank you.", "dai _ thank-you", S, "br.cheers"),
            ]),
            ("ld-price", "How much is a lady drink?", "sw.lady-drink how-much", Q, [
                ("Two hundred baht.", "n2 sw.hundred baht", S, "okay-one"),
                ("A hundred and fifty baht.", "sw.hundred n5 n10 baht", S, "okay-one"),
            ]),
            ("okay-one", "Okay, one drink.", "okay _ n1 cl-glass", S),
            ("bar-fine", "How much is the bar fine?", "sw.bar-fine how-much", Q, [
                ("Five hundred baht.", "n5 sw.hundred baht", S, "mk.got-it"),
                ("A thousand baht.", "n1000 baht", S, "mk.got-it"),
            ]),
            ("price-first", "Tell me the price first, please.", "tell sw.price before softening-particle-na", S, [
                ("One thousand five hundred baht.", "n1000 n5 sw.hundred baht", S, "hg.too-expensive"),
                ("It depends.", "it-depends", S, "nm.how-much-all"),
            ]),
            ("just-drink", "I just came for a drink.", "sw.just come sit drink", S),
            ("not-interested", "I'm not interested.", "im-not-interested", S),
            ("not-tonight", "Not tonight.", "not-tonight", S),
            ("are-you-ok", "Are you okay?", "are-you-okay", Q, [
                ("I'm fine.", "never-mind", S, "br.okay"),
                ("I'm tired.", "tired", S, "rest"),
            ]),
            ("rest", "Get some rest.", "sw.rest softening-particle-na", S),
            ("how-home", "How are you getting home?", "go-home how", Q, [
                ("By motorbike taxi.", "sit motorbike-taxi", S, "take-care"),
            ]),
            ("take-care", "Take care of yourself.", "sw.take-care softening-particle-na", S),
            ("going-now", "I'm off now.", "im-going-now softening-particle-na", S, [
                ("Come again!", "come mai-new softening-particle-na", S, "am.see-you-again"),
                ("Thank you.", "thank-you softening-particle-na", S, "am.see-you-again"),
            ]),
            ("tip", "This is for you.", "this give softening-particle-na", S, [
                ("Thank you very much.", "thank-you-very-much", S, "nu.no-worries"),
            ]),
        ],
        "frames": [
            ("how-much", [
                ("lady-drink", "a lady drink", "sw.lady-drink"),
                ("bar-fine", "the bar fine", "sw.bar-fine"),
                ("beer", "a beer", "beer"),
            ]),
            ("not", [
                ("want", "want it", "ao"),
                ("going", "going", "bpai"),
                ("drinking", "drinking", "drink"),
            ]),
        ],
    },
    17: {
        "prefix": "cn", "door": "how-strong",
        "note": "Shop talk only. Smoking in public can bring a fine, and the rules change: ask in the shop.",
        "lines": [
            ("first-time", "It's my first time.", "first-time", S, [
                ("Would you like something mild?", "ao sw.mild mai-q", Q, "not-too-strong"),
                ("What kind do you like?", "like sw.style which", Q, "relax"),
            ]),
            ("how-strong", "How strong is it?", "how-strong-is-it", Q, [
                ("Very strong.", "sw.strong very", S, "not-too-strong"),
                ("Medium.", "sw.medium", S, "mk.ill-take-it"),
            ]),
            ("not-too-strong", "One that's not too strong, please.", "khaw cl-thing at mai-not sw.strong very", S),
            ("relax", "I want to relax. What do you recommend?", "want-to-do relaxed _ what-do-you-recommend good", Q, [
                ("This one is good.", "this good", S, "how-strong"),
                ("Indica is good.", "sw.indica good", S, "how-much-gram"),
            ]),
            ("indica-sativa", "Is this indica or sativa?", "this sw.indica or sw.sativa", Q, [
                ("Indica.", "sw.indica", S, "mk.got-it"),
                ("Sativa.", "sw.sativa", S, "mk.got-it"),
            ]),
            ("edibles", "Do you have edibles?", "have-or-there-is sw.style gin mai-q", Q, [
                ("Yes, we do.", "have-or-there-is", S, "how-strong"),
                ("No, we don't.", "mai-not have-or-there-is", S, "flower"),
            ]),
            ("flower", "Then I'll take flower.", "so-then ao sw.flower", S),
            ("how-much-gram", "How much per gram?", "sw.gram sw.per how-much", Q, [
                ("Three hundred baht.", "n3 sw.hundred baht", S, "one-gram"),
                ("It depends on the strain.", "it-depends sw.strain", S, "relax"),
            ]),
            ("one-gram", "One gram, please.", "ao n1 sw.gram", S),
            ("can-i-see", "Can I have a look?", "khaw look noi", S),
            ("prescription", "Do I need a prescription?", "do-i-need-a-prescription", Q, [
                ("Yes, you do.", "sw.must have-or-there-is", S, "mk.got-it"),
                ("No, you don't.", "mai-not sw.must", S, "mk.got-it"),
            ]),
            ("where-smoke", "Where can I smoke?", "where-can-i-smoke", Q, [
                ("Behind the shop is fine.", "behind shop dai", S, "mk.thank-you"),
                ("Not in public. There's a fine.", "sw.forbid sw.smoke sw.in sw.public _ have-or-there-is sw.fine", S, "mk.got-it"),
            ]),
            ("not-public", "So no smoking in public, right?", "sw.forbid sw.smoke sw.in sw.public isnt-it", Q, [
                ("Right, there's a fine.", "yes _ have-or-there-is sw.fine", S, "mk.got-it"),
            ]),
        ],
        "frames": [
            ("do-you-have", [
                ("edibles", "edibles", "sw.style gin"),
                ("mild", "something mild", "sw.mild"),
                ("lighter", "a lighter", "sw.lighter"),
            ]),
            ("id-like", [
                ("one-gram", "one gram", "n1 sw.gram"),
                ("two-grams", "two grams", "n2 sw.gram"),
                ("flower", "flower", "sw.flower"),
            ]),
            ("how-much", [
                ("per-gram", "it per gram", "sw.gram sw.per"),
                ("this", "this one", "this"),
            ]),
        ],
    },
    18: {
        "prefix": "gh", "door": "going-back",
        "lines": [
            ("going-back", "I'm heading back to the hotel.", "I will sw.go-back hotel already", S, [
                ("Going already?", "sw.go-back already really-checking", Q, "tired"),
                ("How are you getting back?", "sw.go-back how", Q, "by-taxi"),
            ]),
            ("tired", "I'm tired now.", "tired already", S),
            ("by-taxi", "By taxi.", "sit taxi", S),
            ("where-taxi", "Where can I get a taxi?", "sw.call taxi where dai", Q, [
                ("Over there.", "there", S, "mk.thank-you"),
            ]),
            ("this-hotel", "To this hotel, please.", "go-to hotel sw.this-one", S, [
                ("Three hundred baht.", "n3 sw.hundred baht", S, "hg.too-expensive"),
                ("Where is it?", "where-is", Q, "right-here"),
            ]),
            ("right-here", "It's right here.", "be-at sw.right-here", S),
            ("back-at-hotel", "I'm back at the hotel.", "arrive hotel already", S),
            ("walk-myself", "I can walk back on my own.", "walk sw.go-back sw.myself dai", S),
            ("dont-want", "I don't want it.", "i-dont-want-it", S, [
                ("Why not?", "why", Q, "wg.not-interested"),
            ]),
            ("enough", "That's enough for me, thanks.", "please-stop _ thank-you", S),
            ("not-going", "I'm not going.", "I mai-not bpai", S, [
                ("Why? Come on, let's go.", "why _ lets-go", S, "really-not"),
            ]),
            ("really-not", "Really, I'm not going.", "mai-not bpai really-truly", S),
            ("good-night", "Good night.", "sw.sweet-dreams softening-particle-na", S),
        ],
        "frames": [
            ("not", [
                ("want", "want it", "ao"),
                ("going", "going", "bpai"),
                ("drinking", "drinking", "drink"),
                ("drunk", "drunk", "drunk"),
            ]),
            ("already", [
                ("full", "full", "full"),
                ("tired", "tired", "tired"),
                ("drunk", "drunk", "drunk"),
                ("arrived", "arrived", "arrive"),
            ]),
        ],
    },
}
