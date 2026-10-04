// Today's lesson: one short explanation per course day of how Thai works, the
// foundation under the day's words. It builds on the "How Thai works" primer
// (tones, romanisation, polite endings) rather than repeating it.
//
// Thai appears only through `examples` (course item ids), so every Thai word on
// screen is a real, checked item with its own clip. A body may name a Thai
// word only when it is the exact `thai` of an item in that section's examples;
// otherwise the prose is English. lessons.test.ts holds these rules.

export interface LessonSection {
  heading: string;
  /** plain English paragraphs */
  body: string[];
  /** course item ids, shown as rows that play the real clip */
  examples?: string[];
}

export interface Lesson {
  day: number;
  title: string;
  /** one line: "By the end of today you can ..." */
  goal: string;
  sections: LessonSection[];
}

export const LESSONS: Lesson[] = [
  // ---------- week 1 ----------
  {
    day: 1,
    title: 'Hello, I and you',
    goal: 'By the end of today you can greet anyone politely, say I and you, and know what your first letters do.',
    sections: [
      {
        heading: 'One greeting for any time of day',
        body: [
          'Thai has one word for hello, and the same word says goodbye. It works morning, afternoon and night, so there is nothing to choose.',
          'On its own it is friendly. With your polite ending after it, it is polite: the form for anyone you do not know well. Thank you and sorry work the same way, and sorry also does the job of excuse me.',
        ],
        examples: ['hello', 'thank-you', 'sorry'],
      },
      {
        heading: 'I and you',
        body: [
          'Thai has one word for I for men and another for women, and the choice follows the speaker, like the polite ending in the primer. The word for you here is the polite, neutral one for an adult you do not know.',
          'Thai leaves out I and you whenever the meaning is clear. Once a conversation is going, a sentence with no I in it is normal, not rude.',
        ],
        examples: ['i-male', 'i-female', 'you'],
      },
      {
        heading: 'Seven letters and a vowel sign',
        body: [
          'Thai letters are mostly consonants, and each belongs to one of three classes: mid, high or low. The class helps decide a syllable’s tone. Today’s seven are all mid class: the g, j, d, dt, b and bp sounds, and a silent letter that carries a vowel at the start of a syllable.',
          'Vowels are signs written around a consonant. Today’s, long aa, goes after it. For now, copy the tone you hear; the rules arrive a step at a time from day 2.',
        ],
      },
    ],
  },
  {
    day: 2,
    title: 'Yes, no and not',
    goal: 'By the end of today you can answer yes or no the Thai way and make any verb negative.',
    sections: [
      {
        heading: 'Not goes straight before the verb',
        body: [
          'To make a sentence negative, put ไม่ directly in front of the verb: understand becomes ‘not understand’. There is no do or does to add, and the verb never changes. The same word goes before describing words too, as in not spicy.',
        ],
        examples: ['mai-not', 'understand', 'dont-understand'],
      },
      {
        heading: 'Yes and no are not quite yes and no',
        body: [
          'Today’s yes and no really mean ‘that’s right’ and ‘that’s not right’. They answer whether something is so: is this pork? That’s right.',
          'Most other questions are answered by repeating the verb. Asked whether you understand, say ‘understand’ or ‘not understand’. The answer is already in the question.',
        ],
        examples: ['yes', 'no'],
      },
      {
        heading: 'Never mind',
        body: [
          'Never mind is one of the most useful phrases in Thai. It answers thank you and sorry, much like you’re welcome or no problem, and it shrugs off small trouble.',
        ],
        examples: ['never-mind'],
      },
      {
        heading: 'Two long vowels, and the level tone',
        body: [
          'Today’s vowels are long ii, written above the consonant, and long uu, written below it.',
          'Mid is the level, ordinary tone. With no tone mark, you get it when the first letter is mid or low class and the syllable ends in a long vowel or in m, n, ng, y or w. Eat and you both work like this.',
        ],
        examples: ['gin', 'you'],
      },
    ],
  },
  {
    day: 3,
    title: 'Numbers and there is',
    goal: 'By the end of today you can count from zero to ten, give a price in baht, and say what there is.',
    sections: [
      {
        heading: 'Zero to ten',
        body: [
          'Each number is one short word with its own tone, and the tone is part of the number. Two and three both rise, four is low, five and nine fall. Learn each with its tone from the start, so there is nothing to unlearn later.',
          'With money, the number comes first and baht follows: ‘five baht’.',
        ],
        examples: ['n2', 'n3', 'n4', 'n5', 'baht'],
      },
      {
        heading: 'One verb for have and there is',
        body: [
          'Today’s verb does two jobs: ‘I have’ and ‘there is’. Put it before the thing: ‘have rice’, ‘there is a market’. With not in front it means don’t have, or there isn’t any. It is also how you ask whether a shop has something.',
        ],
        examples: ['have-or-there-is', 'market'],
      },
      {
        heading: 'Seven low-class letters',
        body: [
          'Today’s letters are the ng, n, m, y, r, l and w sounds. All seven are low class, the largest of the three classes.',
          'Several of them also close syllables. At the end of a syllable, r and l are both said as n. A low-class letter ending in a long vowel, with no tone mark, gives the level mid tone, just like a mid-class one: the verb for have, above, is an example.',
        ],
      },
    ],
  },
  {
    day: 4,
    title: 'Two kinds of want',
    goal: 'By the end of today you can ask for a thing, say what you want to do, and read vowels written before the consonant.',
    sections: [
      {
        heading: 'Want a thing, want to do',
        body: [
          'English uses one want for both. Thai splits them. The first is followed by a thing: want coffee. The second is followed by an action: want to drink.',
          'Mixing them up is the most common early mistake. A quick check: if the next word is an action, use the second. Here both appear with I in front, in your own form.',
        ],
        examples: ['ao', 'want-to-do'],
      },
      {
        heading: 'No ice, this one',
        body: [
          'To leave something out of a drink, say ‘not put in’, then the thing: ‘not put in ice’. The same shape works for sugar.',
          'This one and that one are a general word for a thing followed by this or that. In Thai, this and that come after the word they point at.',
        ],
        examples: ['no-ice', 'no-sugar', 'this', 'that'],
      },
      {
        heading: 'Vowels written first, said second',
        body: [
          'Three of today’s vowels, ee, ae and oo, are written before the consonant but said after it. Read the consonant first, then the vowel in front of it. In coffee, the second syllable is written vowel then f, but said f then ae.',
          'The tone lab now pairs mid with low. Mid sits level in the middle of your voice; low starts lower and stays down. Iced is mid; drink is low.',
        ],
        examples: ['coffee', 'iced', 'drink'],
      },
    ],
  },
  {
    day: 5,
    title: 'Prices and how much',
    goal: 'By the end of today you can say numbers up to 100, ask what something costs, and read three vowels with a sound built in.',
    sections: [
      {
        heading: 'Building numbers to 100',
        body: [
          'From 11 to 99, Thai builds numbers the way you would spell them out: ‘four ten five’ is 45. There are three exceptions. A one in the tens is not said, so 15 is ‘ten five’. A one at the end of 11, 21, 31 and so on takes a different word, and a two in the tens, from 20 to 29, takes a different word too.',
        ],
        examples: ['n11', 'n20', 'the-pattern-for-12-to-99', 'n100'],
      },
      {
        heading: 'How much is it?',
        body: [
          'How much goes at the end, after the thing: ‘this one, how much?’ Thai question words sit where the answer will go, so the answer has the same shape: ‘this one, 250 baht’.',
          'There is no is in either sentence. Thai needs nothing between a thing and its price.',
        ],
        examples: ['how-much', 'how-much-this', 'the-pattern-for-prices'],
      },
      {
        heading: 'Three vowels with a sound built in',
        body: [
          'One of today’s vowel signs stands for the vowel a closed by an m sound, as in water. The other two both stand for ai and are written before the consonant. One is used in a small, fixed set of everyday words, such as yes; the other almost everywhere else, as in not.',
          'To read a syllable, find the consonant, then look before, above, below and after it for the vowel.',
        ],
        examples: ['water', 'yes', 'mai-not'],
      },
    ],
  },
  {
    day: 6,
    title: 'Asking nicely',
    goal: 'By the end of today you can ask for things and favours politely, say can and cannot, and tell live syllables from dead ones.',
    sections: [
      {
        heading: 'Asking for a thing, asking for a favour',
        body: [
          'To ask for a thing, start with may I have and name it. To ask someone to do something, start with please, or simply end with a small softening word, as the meter request does. The softener turns an order into a request; leave it off and you can sound blunt. Your polite ending goes last of all.',
        ],
        examples: ['khaw', 'please', 'noi', 'use-the-meter-please'],
      },
      {
        heading: 'Can goes after the verb',
        body: [
          'Can comes after the action, not before it: ‘go can’. Not plus can, also after the action, means cannot. With a question word at the end it asks ‘go can?’, and the answer is simply can or cannot.',
        ],
        examples: ['dai', 'cannot', 'go-to'],
      },
      {
        heading: 'Live and dead syllables',
        body: [
          'From today the tone rules come in full. They depend on whether a syllable is live or dead. A syllable is live if it ends in a long vowel or in m, n, ng, y or w. It is dead if it ends in a short vowel or in a p, t or k sound.',
          'Come ends in a long vowel, so it is live. Baht ends in a t sound, so it is dead. With a mid-class first letter and no tone mark, live gives mid and dead gives low, which is what you hear in baht.',
        ],
        examples: ['come', 'baht'],
      },
    ],
  },
  {
    day: 7,
    title: 'Checkpoint: the first week',
    goal: 'By the end of today you can see how your first week fits together and know what to practise next.',
    sections: [
      {
        heading: 'What you have built',
        body: [
          'A Thai sentence so far: the verb never changes, not goes straight before it, and describing words need no is. Question words sit where the answer will go. I and you are often left out, and your polite ending closes anything said to someone you do not know.',
          'On the script side you have fourteen consonants in two classes, a set of vowels, and the idea of live and dead syllables.',
        ],
      },
      {
        heading: 'When you are stuck',
        body: [
          'Today’s phrases are for the moment you lose the thread. What goes at the end, where the answer would go: ‘means what?’ Say it again and speak slowly are requests, so your polite ending finishes them. Use them freely; asking is part of learning.',
        ],
        examples: ['what-does-it-mean', 'how-do-you-say', 'say-it-again', 'speak-slowly-please'],
      },
      {
        heading: 'What to practise',
        body: [
          'The checkpoint mixes tones, letters and words. Afterwards, spend extra time on whatever it shows as weak. For tones, the tone lab is the place, and mid against low is this week’s pair. Keep review going every day; it does more for memory than anything new.',
        ],
      },
    ],
  },

  // ---------- week 2 ----------
  {
    day: 8,
    title: 'Yes-no questions',
    goal: 'By the end of today you can turn a statement into a yes-no question, answer one, and know the seven high-class letters.',
    sections: [
      {
        heading: 'Add the question word at the end',
        body: [
          'Most statements become a yes-no question when you add the question word at the end. Nothing else moves, and there is still no is: ‘this spicy’ becomes ‘this spicy, question word’.',
          'To answer, repeat the describing word or verb: ‘spicy’, or ‘not spicy’.',
        ],
        examples: ['is-this-spicy', 'spicy', 'not-spicy'],
      },
      {
        heading: 'Rising question, falling not',
        body: [
          'The question word ไหม and the word for not sound almost the same. Only the tone tells them apart: the question word rises, not falls. Both are short and very common, so get the shapes right early.',
        ],
        examples: ['mai-q', 'mai-not'],
      },
      {
        heading: 'Right? and or not?',
        body: [
          'Two more endings. One checks something you already think is true, like right? at the end of an English sentence. The other asks ‘or not?’. How are you is itself a yes-no question: ‘well, question word?’, answered with ‘well’.',
        ],
        examples: ['isnt-it', 'or-not', 'how-are-you'],
      },
      {
        heading: 'Seven high-class letters',
        body: [
          'Today’s letters make the kh, ch, th, ph, f, s and h sounds, and all seven are high class. With no tone mark, a high-class letter in a live syllable gives a rising tone: white and tiger both rise. The full rule comes tomorrow.',
        ],
        examples: ['white', 'tiger'],
      },
    ],
  },
  {
    day: 9,
    title: 'Very, a little, and high-class tones',
    goal: 'By the end of today you can say how spicy you want your food, order a whole meal, and work out a high-class tone.',
    sections: [
      {
        heading: 'Describing words come first, then how much',
        body: [
          'Describing words work like verbs, so there is no is. Words that change them, such as very and a little, come after: ‘spicy very’, ‘spicy a little’. Less spicy is ‘spicy few’. Not still goes in front: ‘not spicy’.',
        ],
        examples: ['very-spicy', 'little-spicy', 'less-spicy'],
      },
      {
        heading: 'Here or to take away',
        body: [
          'Eat here is ‘eat at-here’. Take away is ‘put in, wrap’. Without is the not-put-in from day 4, then the thing. Recommend is a verb, so what do you recommend is ‘recommend what?’, with the question word at the end.',
        ],
        examples: ['eat-here', 'take-away', 'without', 'what-do-you-recommend'],
      },
      {
        heading: 'High-class tones',
        body: [
          'A high-class first letter with no tone mark gives a rising tone in a live syllable and a low tone in a dead one.',
          'White ends in w, so it is live and rises. Spicy ends in a t sound, so it is dead and low. Cheap has a long vowel but ends in a k sound, so it is dead and low too. Length does not matter here; the ending does.',
        ],
        examples: ['white', 'spicy', 'cheap'],
      },
    ],
  },
  {
    day: 10,
    title: 'Counting with classifiers',
    goal: 'By the end of today you can order a number of things with the right counting word and read the first tone mark.',
    sections: [
      {
        heading: 'Thing, number, counting word',
        body: [
          'Thai does not put a number straight onto a noun. It says the thing, then the number, then a counting word, called a classifier, that suits the kind of thing: ‘water, one, bottle’. English does this sometimes, as in two cups of coffee. Thai does it every time.',
          'Containers are their own classifiers: glass, bottle, plate. The word for a thing is a general classifier for small objects.',
        ],
        examples: ['cl-glass', 'cl-bottle', 'cl-plate', 'cl-thing'],
      },
      {
        heading: 'How many, and one more',
        body: [
          'How many takes the place of the number, before the classifier: ‘how-many glass?’. One more is ‘more one’, and another round is ‘more round’. Keep the change is ‘no need to give change’.',
        ],
        examples: ['how-many', 'one-more', 'one-more-round', 'keep-the-change'],
      },
      {
        heading: 'The first tone mark',
        body: [
          'Today’s mark is a short upright stroke above the consonant. On a mid-class or high-class letter it makes the syllable low, whatever the ending. Chicken starts with a mid-class letter and egg with a high-class one; both carry this mark, so both are low. On a low-class letter the same mark does something else, which comes on day 12.',
        ],
        examples: ['chicken', 'egg', 'n4'],
      },
    ],
  },
  {
    day: 11,
    title: 'Left, right and straight on',
    goal: 'By the end of today you can direct a driver and know the low-class letters that share sounds with high-class ones.',
    sections: [
      {
        heading: 'Directions start with the action',
        body: [
          'Directions put the verb first, then where: ‘turn left’, ‘turn right’. Straight on is ‘straight go’. Slow down is ‘slow, down’.',
          'There is a general word for stop, and a driver’s word that also means park. The second is the one for pulling over: ‘park here’.',
          'Left and right have different tones, high and rising, so they do not sound alike. In a moving car, say them clearly all the same.',
        ],
        examples: ['turn', 'left', 'right', 'straight', 'stop-here'],
      },
      {
        heading: 'Same sound, two classes',
        body: [
          'Today’s seven letters make the kh, ch, s, th, ph, f and h sounds, all low class. You met every one of these sounds on day 8, spelt with high-class letters. Thai has at least two spellings for each, and the letter’s class decides which tone rules apply.',
          'So one sound can carry different tones with no tone mark at all. You starts with a low-class letter and is level; right starts with a high-class one and rises. Faced with a new word, the first question is always which class its first letter belongs to.',
        ],
        examples: ['you', 'right'],
      },
    ],
  },
  {
    day: 12,
    title: 'Where is it?',
    goal: 'By the end of today you can ask where something is, tell near from far, and read low-class tones and the second tone mark.',
    sections: [
      {
        heading: 'Location has its own verb',
        body: [
          'Thai uses a separate verb for where something is: ‘toilet, be-at, where?’ The question word goes at the end, where the answer will go: ‘toilet, be-at, there’. Use it for where things are, not for jobs or descriptions.',
        ],
        examples: ['where-is-the-toilet', 'here', 'there'],
      },
      {
        heading: 'Near and far',
        body: [
          'The words for near and far differ only in tone. Near falls; far is level. Get it wrong and you have said the opposite, so practise this pair aloud.',
        ],
        examples: ['near', 'far'],
      },
      {
        heading: 'Low-class tones without a mark',
        body: [
          'A low-class first letter with no mark gives mid in a live syllable. In a dead one, vowel length decides: a short vowel gives high, as in soup, and a long one gives falling, as in very.',
        ],
        examples: ['soup', 'very'],
      },
      {
        heading: 'The second tone mark',
        body: [
          'Today’s mark sits above the consonant like the first. On a mid-class or high-class letter it gives falling, as in nine and rice; near falls for the same reason. On a low-class letter it gives high, as in horse. And the first mark on a low-class letter gives falling, as in not.',
        ],
        examples: ['n9', 'rice', 'horse', 'mai-not'],
      },
    ],
  },
  {
    day: 13,
    title: 'Today, tomorrow, yesterday',
    goal: 'By the end of today you can say when something happens without changing the verb, and read short vowels.',
    sections: [
      {
        heading: 'Time words instead of tenses',
        body: [
          'Thai verbs have no past or future forms. Go is go, whether it happened yesterday or happens tomorrow. A time word, usually at the start or end of the sentence, says when. Once the time is clear, it is not repeated.',
        ],
        examples: ['today', 'tomorrow', 'yesterday', 'now'],
      },
      {
        heading: 'Parts of the day, and when',
        body: [
          'Morning, afternoon, evening and night all begin with the same word, meaning ‘at the time of’. When usually goes at the end, like other question words: ‘go when?’',
        ],
        examples: ['morning', 'afternoon', 'evening', 'when'],
      },
      {
        heading: 'Short vowels and dead syllables',
        body: [
          'Today’s short vowels are a, written after the consonant, i above it and u below it, plus a short and a long version of the primer’s spread-lips oo, both above. A syllable that ends in a short vowel is dead, as is one that ends in a p, t or k sound.',
          'Traffic jam shows how class sets a dead syllable’s tone. Its first syllable starts with a low-class letter, short and dead, so it is high. Its second starts with a mid-class letter and is dead, so it is low.',
        ],
        examples: ['traffic-jam'],
      },
    ],
  },
  {
    day: 14,
    title: 'Checkpoint: the tone rules so far',
    goal: 'By the end of today you can work out the tone of most syllables you see and know what to practise in week three.',
    sections: [
      {
        heading: 'The rules on one page',
        body: [
          'Find the class of the first letter, then decide live or dead. With no mark: mid class gives mid when live and low when dead. High class gives rising when live and low when dead. Low class gives mid when live; when dead, high with a short vowel and falling with a long one.',
          'With a mark: the first gives low on mid and high class and falling on low class. The second gives falling on mid and high class and high on low class.',
        ],
        examples: ['white', 'baht', 'soup', 'very'],
      },
      {
        heading: 'The sentence so far',
        body: [
          'Verbs never change; time words carry when. Not goes before verbs and describing words. Question words sit where the answer will go. Counting is thing, number, classifier. Today’s verbs, give and wait, follow the same rules.',
        ],
        examples: ['give', 'wait'],
      },
      {
        heading: 'What to practise',
        body: [
          'Tone Climb opens today: you hear a syllable and jump to the platform shaped like its tone. If the checkpoint shows tones as weak, play a few rounds a day. If letters are weak, give the writing block to the ones you missed. Keep review going.',
        ],
      },
    ],
  },

  // ---------- week 3 ----------
  {
    day: 15,
    title: 'Clock time',
    goal: 'By the end of today you can tell and ask the time the Thai way, and know which sounds can end a syllable.',
    sections: [
      {
        heading: 'The day comes in blocks',
        body: [
          'Thai splits the day into blocks, each with its own word, and counts the hours within each block. From 1 to 5 a.m., the first word below comes before the number. From 6 to 11 a.m., the number comes first, then the second word.',
          'From 1 to 3 p.m., the third word comes first, then the number and the o’clock word. From 7 to 11 p.m., the number comes before the fourth word, counting again from one, so 8 p.m. is two. Late afternoon, noon and midnight have words of their own.',
        ],
        examples: ['clock-word-for-1-to-5-a-m', 'clock-word-for-morning-hours', 'clock-word-for-afternoon-hours', 'clock-word-for-evening-hours'],
      },
      {
        heading: 'Asking the time',
        body: [
          'What time is ‘how-many o’clock?’: the question word takes the place of the number. The full word for hour, below, is for lengths of time, so the same frame with it asks how many hours. Lengths of time put the number first and the unit after, as with classifiers.',
        ],
        examples: ['what-time', 'hour', 'minute'],
      },
      {
        heading: 'Only a few final sounds',
        body: [
          'At the end of a syllable, Thai letters collapse into a few sounds: p, t and k, cut short, and m, n, ng and the y and w glides. Many letters that start with other sounds end as t. The r and l letters end as n, which is why the borrowed word for the bill ends in an n sound.',
        ],
        examples: ['baht', 'the-bill'],
      },
    ],
  },
  {
    day: 16,
    title: 'Done, doing, will do',
    goal: 'By the end of today you can say whether something is done, happening or still to come, and know the last two tone marks.',
    sections: [
      {
        heading: 'Three markers instead of tenses',
        body: [
          'Three small words do the work of English tenses, and the verb never changes. One goes before the verb for something happening now: ‘in-progress eat’. One goes before the verb for something to come: ‘will go’. One goes after the verb, or at the end, for something done: ‘eat already’.',
          'When a time word already makes things clear, you can leave them out, but the last one is everywhere.',
        ],
        examples: ['in-progress', 'will', 'already'],
      },
      {
        heading: 'Still, and not yet',
        body: [
          'Still before not means not yet: ‘still not eat’. To ask whether something has happened, end the question with ‘or yet?’. Answer with the verb and already for yes, or simply ‘still’ for not yet.',
        ],
        examples: ['still', 'yet'],
      },
      {
        heading: 'The third and fourth tone marks',
        body: [
          'These two marks are used only on mid-class letters, and they are much less common than the first two. The third gives a high tone, as in tuk-tuk; the fourth gives a rising tone, as in noodles. With all four marks, a mid-class letter can carry every one of the five tones.',
        ],
        examples: ['tuk-tuk', 'noodles'],
      },
    ],
  },
  {
    day: 17,
    title: 'Likes, tastes and a silent letter',
    goal: 'By the end of today you can say what you like and how food tastes, and read the silent letter that changes a tone.',
    sections: [
      {
        heading: 'Like, with a thing or an action',
        body: [
          'Like takes a thing or an action straight after it, with no to or -ing: ‘like mango’, ‘like eat’. Not goes in front for don’t like.',
          'Hungry and full are describing words, so there is no am: ‘I hungry’. Here they appear in your own form, with I in front.',
        ],
        examples: ['like', 'hungry', 'full'],
      },
      {
        heading: 'Tastes',
        body: [
          'Sweet, sour and salty are describing words like spicy, so very and a little go after them. It’s delicious adds the word for good after delicious.',
        ],
        examples: ['sweet', 'sour', 'salty', 'its-delicious'],
      },
      {
        heading: 'The silent h',
        body: [
          'When the high-class h letter comes before a low-class ng, n, m, y, r, l or w, or the second y letter from day 15, it is not said. Its only job is to move the syllable into the high class. Pork, dog and sweet all rise because of it. One carries the first mark, and with high-class rules that makes it low.',
          'The silent vowel carrier from day 1 does the same in front of y in four words, with mid-class rules. You know two: want to and be at, both low.',
        ],
        examples: ['pork', 'dog', 'n1', 'be-at'],
      },
    ],
  },
  {
    day: 18,
    title: 'Small talk',
    goal: 'By the end of today you can ask and give a name and a country, and read vowels written in more than one piece.',
    sections: [
      {
        heading: 'Name and country',
        body: [
          'What’s your name is ‘you, name, what?’: name works like a verb, and the question word goes at the end. Answer in the same frame, with your name where the question word was. Where are you from is ‘you, come from, which?’, and again the answer fills the last slot.',
        ],
        examples: ['whats-your-name', 'where-are-you-from', 'come-from', 'england'],
      },
      {
        heading: 'A whole sentence, in order',
        body: [
          'I speak a little Thai shows how Thai stacks a sentence: who, the action, the thing, then can, then how much. Each piece comes after the one it changes. Work, as a job, is ‘do work’.',
        ],
        examples: ['i-speak-a-little-thai', 'work-job'],
      },
      {
        heading: 'Vowels in pieces',
        body: [
          'Some vowels are written in two or three pieces around the consonant. Long aw goes after it, as in may I have. The ao vowel has a piece before and one after, as in nine. A small mark above can shorten a vowel, as in be, and a short a inside a syllable is a mark above the consonant, as in and.',
          'Read the consonant first, then gather up the pieces around it.',
        ],
        examples: ['khaw', 'n9', 'be', 'and'],
      },
    ],
  },
  {
    day: 19,
    title: 'People, animals and rooms',
    goal: 'By the end of today you can count people, animals and rooms, read a menu line, and spot the silent-letter mark.',
    sections: [
      {
        heading: 'Three more classifiers',
        body: [
          'The pattern from day 10 holds: thing, number, classifier. People are counted with the word for person: ‘friend, two, person’. Animals use a word that also counts clothes, such as shirts. Room is its own classifier. How many still goes where the number would: ‘how-many person?’ is how many people.',
        ],
        examples: ['cl-person', 'cl-animal', 'cl-room'],
      },
      {
        heading: 'Reading a menu',
        body: [
          'Dish names put the main thing first and the describing word after: fried rice is ‘rice fried’, sticky rice is ‘rice sticky’. Shops work the same way: pharmacy is ‘shop, sell, medicine’. The first word often tells you what kind of thing it is. Learn the main nouns, such as rice, chicken and pork, and you can sort most of a menu by its first words.',
        ],
        examples: ['fried-rice', 'sticky-rice', 'pharmacy'],
      },
      {
        heading: 'The silent-letter mark',
        body: [
          'A small mark above a letter tells you not to say it. It is common in borrowed words, where the spelling keeps a letter the Thai sound has dropped. Beer and bar both end in a silent r, and zero ends in a silent y. The letter before the mark then closes the syllable: zero ends in an n sound.',
        ],
        examples: ['beer', 'bar', 'n0'],
      },
    ],
  },
  {
    day: 20,
    title: 'At the pharmacy',
    goal: 'By the end of today you can say what is wrong, use be before a noun, and recognise the rare letters.',
    sections: [
      {
        heading: 'Saying what hurts',
        body: [
          'Aches are the word for ache plus the body part: ‘ache head’, ‘ache stomach’. Allergic works like a verb, with the thing straight after it: ‘allergic shrimp’. Fever uses the word for be: ‘be fever’. Thai talks about some illnesses this way.',
        ],
        examples: ['headache', 'stomach-ache', 'allergic-to', 'fever'],
      },
      {
        heading: 'Be, between two nouns',
        body: [
          'The word for be links two nouns: ‘I, be, doctor’. Use it for jobs, nationalities and roles. Do not use it before a describing word: hot, tired and expensive take no is at all. Location has its own verb, from day 12, and so does having, from day 3.',
          'For not a doctor, put the no from day 2 before the noun.',
        ],
        examples: ['be', 'doctor', 'no'],
      },
      {
        heading: 'Rare letters, to recognise',
        body: [
          'Today’s letters are for recognition only. Two are no longer used at all. Most of the rest appear mainly in words from Sanskrit and Pali, and each shares its sound with a letter you already know. Two of them complete the mid class, so you have now met all nine mid-class letters.',
        ],
      },
    ],
  },
  {
    day: 21,
    title: 'Checkpoint: three weeks in',
    goal: 'By the end of today you can see the whole shape of a basic Thai sentence and the whole consonant system.',
    sections: [
      {
        heading: 'Three ways to say is',
        body: [
          'English uses is for almost everything. Thai splits it. Before a noun, use be: I am a doctor. For where something is, use be-at. For having, and for there is, use have. Before a describing word, use nothing: ‘beautiful’, with no is.',
        ],
        examples: ['be', 'be-at', 'have-or-there-is', 'beautiful'],
      },
      {
        heading: 'Done as a state',
        body: [
          'Married is ‘marry already’: the done marker from day 16 turns an event into a state. Single is a plain describing word.',
        ],
        examples: ['married', 'single'],
      },
      {
        heading: 'What you can read now',
        body: [
          'You have met every consonant, all four tone marks, the silent h, the silent-letter mark and most vowels. That is enough to read most signs aloud with the right tone, slowly. Signs on toilet doors are a good place to start. Ink Run is fully open from today for letter speed.',
        ],
        examples: ['men-on-a-sign', 'women-on-a-sign'],
      },
      {
        heading: 'What to practise',
        body: [
          'Look at what the checkpoint marks as weak. For words, review clears them. For letters, use Ink Run and the writing block. For sentences, use the sentence builder and watch where not, question words and classifiers go.',
        ],
      },
    ],
  },

  // ---------- week 4 ----------
  {
    day: 22,
    title: 'Feelings and saying no kindly',
    goal: 'By the end of today you can say how you feel, ask why, turn something down politely, and read warning signs.',
    sections: [
      {
        heading: 'How you feel',
        body: [
          'Feelings are describing words, so again there is no am: ‘I tired’. Very goes after, as always: ‘tired very’. Happy is built as ‘have happiness’, the have verb plus a noun.',
        ],
        examples: ['tired', 'sad', 'happy'],
      },
      {
        heading: 'Why and because',
        body: [
          'Why is a question word, so it never takes the yes-no ending as well: ask ‘why not go?’, with no question word added at the end. The same is true of what, where and how much. Because goes before the reason, as in English: ‘because tired’.',
        ],
        examples: ['why', 'because'],
      },
      {
        heading: 'Saying no, and hearing it',
        body: [
          'A soft refusal puts never mind before thank you. A clear no is also fine: I’m not interested, with your polite ending, is polite and leaves no doubt.',
          'When someone says no to you, accept it simply: ‘no problem, understand’. No reason is needed on either side.',
        ],
        examples: ['no-thank-you', 'im-not-interested', 'no-problem-accepting-a-no'],
      },
      {
        heading: 'Reading warning signs',
        body: [
          'Signs often start with a word meaning forbidden, then a verb: ‘forbidden enter’ is no entry, and ‘forbidden smoke cigarette’ is no smoking. Spot that first word and you know the sign is a rule.',
        ],
        examples: ['no-entry', 'no-smoking', 'wet-floor'],
      },
    ],
  },
  {
    day: 23,
    title: 'Offers, opposites and fast speech',
    goal: 'By the end of today you can offer something, read open and closed, and recognise two common fast-speech changes.',
    sections: [
      {
        heading: 'Offering and inviting',
        body: [
          'An offer is a yes-no question built on want-a-thing: ‘want water, question word?’. Answer with ‘want’ or ‘not want’. An invitation to do something together puts a small word meaning together after the action, then the question word. Both leave the other person free to say no, and either answer is fine.',
        ],
        examples: ['water', 'drink'],
      },
      {
        heading: 'Open and closed',
        body: [
          'Open and closed are a pair on every shop door. Both are low, so listen for the vowel: open has the vowel of her, closed a short i. Many signs are a single word like these, which makes them good reading practice: read the sign, then check it by listening. Go home is ‘return house’.',
        ],
        examples: ['open', 'closed', 'go-home'],
      },
      {
        heading: 'Fast speech changes tones',
        body: [
          'In relaxed, fast speech some words lose their dictionary tone. The yes-no question word is often said high instead of rising, and the female I is often said high too.',
          'Courses teach the careful form because it is always correct. Keep saying them that way, and do not be thrown when you hear the change.',
        ],
        examples: ['mai-q', 'i-female'],
      },
    ],
  },
  {
    day: 24,
    title: 'Big numbers and phone numbers',
    goal: 'By the end of today you can read and say large prices and phone numbers.',
    sections: [
      {
        heading: 'A word for each size',
        body: [
          'Thai has its own words for a thousand, ten thousand, a hundred thousand and a million. So 50,000 is ‘five ten-thousand’, not fifty thousand, and 300,000 is ‘three hundred-thousand’.',
          'A long number is read from the biggest word down: 1,250 is ‘one thousand, two hundred, five ten’. Read a big price by its first digit and the word for its size.',
        ],
        examples: ['n1000', 'n10000', 'n100000', 'a-million'],
      },
      {
        heading: 'Phone numbers',
        body: [
          'Phone numbers are read digit by digit, with zero as its own word. Thai mobile numbers start with zero, so you will say it often. Read them slowly; the listener is writing as you go.',
        ],
        examples: ['the-pattern-for-phone-numbers', 'n0'],
      },
      {
        heading: 'Half',
        body: [
          'After a number and its unit, half adds a half: ‘one hour half’ is an hour and a half. Before a unit, it means half a: half a kilo.',
        ],
        examples: ['half', 'hour'],
      },
      {
        heading: 'Today’s street scene',
        body: [
          'Today’s shop scene is talk only, and its words sit behind the 18+ setting. Thai rules on cannabis have changed more than once in recent years, so check the current law before buying anything.',
        ],
      },
    ],
  },
  {
    day: 25,
    title: 'When things go wrong',
    goal: 'By the end of today you can report something lost, say a price is too much, and write a word you hear.',
    sections: [
      {
        heading: 'Lost',
        body: [
          'For something that has gone missing, name the thing, then the word for lost: ‘passport lost’. The thing is the subject; you do not need ‘I lost it’. The same word also means got better: when an illness goes, it is lost too. If you are the one who is lost, use a different phrase: ‘lose way’.',
        ],
        examples: ['lost-something', 'passport', 'lost-my-way'],
      },
      {
        heading: 'Too much',
        body: [
          'Too much goes after the describing word: ‘expensive too-much’. The shorter form from day 5 does the same job. Bad is simply ‘not good’.',
        ],
        examples: ['too-much', 'too-expensive', 'bad'],
      },
      {
        heading: 'From sound to spelling',
        body: [
          'To write a word you hear: the first sound, where more than one letter may fit and you learn which by the word; then the vowel and its length; then the final sound; then the tone. Last, ask whether the class and the ending already give that tone. If not, the word needs a mark.',
          'Shop is a good test. Its low-class letter and long vowel ending in n would give mid with no mark. It is high, so it takes the second mark.',
        ],
        examples: ['shop'],
      },
    ],
  },
  {
    day: 26,
    title: 'More than, and the most',
    goal: 'By the end of today you can compare two things, say which is the most, and say whether things are the same.',
    sections: [
      {
        heading: 'More than',
        body: [
          'English adds -er or more. Thai adds one short word, meaning -er than, after the describing word, then what you compare with: ‘big -er-than that one’. Bigger and smaller here are just big and small with that word after them. More than, below, is many plus that word.',
          'There is no separate form for long words: expensive, delicious and clean all take the same word after them.',
        ],
        examples: ['bigger', 'smaller', 'more-than'],
      },
      {
        heading: 'The most',
        body: [
          'The most goes after the describing word too: ‘this one, delicious the-most’. It works after verbs as well: ‘like the-most’.',
        ],
        examples: ['the-most', 'delicious'],
      },
      {
        heading: 'Same and different',
        body: [
          'To compare two things, join them with and, then say same or different: ‘this and that, same’. Put not before same for not the same. Both end in a small word meaning each other, which you also heard in see you: ‘meet each-other’.',
        ],
        examples: ['same', 'different', 'and'],
      },
      {
        heading: 'More and less as a change',
        body: [
          'When something should change, Thai adds up or down after the word: more is ‘many up’ and less is ‘few down’. You met down already in slow down. Clean helps with a hotel complaint: ‘room not clean’. Floor means a storey of a building, not the ground you walk on.',
        ],
        examples: ['more', 'less', 'clean', 'floor'],
      },
    ],
  },
  {
    day: 27,
    title: 'Plans and getting around',
    goal: 'By the end of today you can suggest a plan, ask how long a trip takes, and talk about buses and boats.',
    sections: [
      {
        heading: 'Shall we?',
        body: [
          'To suggest doing something together, add a small word meaning together after the action and its thing, then the question word: ‘eat rice together, question word?’. It is a friendly, open suggestion, and a yes is often just the verb again. To say what you would like to do yourself, use want to from day 4 before the action.',
        ],
        examples: ['want-to-do', 'mai-q'],
      },
      {
        heading: 'Riding is sitting',
        body: [
          'Thai rides a bus, a train or a boat with the verb sit: ‘sit bus, go market’ means take the bus to the market. Train is ‘vehicle fire’; skytrain adds sky, because fire and sky together make the word for electricity. Board at a station or a pier.',
        ],
        examples: ['sit', 'bus', 'skytrain', 'pier'],
      },
      {
        heading: 'How long, and from',
        body: [
          'How long is ‘long how-much?’, at the end like how much. This long is long in time; long in length is a different word. From goes before the place, as in English. Week and month are the units for longer stays. For a day trip, ask both before you set off: how long, and from where.',
        ],
        examples: ['how-long', 'from', 'week', 'month'],
      },
    ],
  },
  {
    day: 28,
    title: 'Telling what happened',
    goal: 'By the end of today you can tell a short story about your day and link ideas with but, or and also.',
    sections: [
      {
        heading: 'Set the time, then tell it',
        body: [
          'Start with a time word, then list what happened in order: ‘yesterday, go market, eat, go home’. Time words stack from big to small: ‘yesterday evening’. The done marker after a step shows it finished before the next: ‘eat already, go home’. Nobody needs a past tense to follow it.',
        ],
        examples: ['yesterday', 'go-home', 'already'],
      },
      {
        heading: 'Linking words',
        body: [
          'But and or sit between two ideas, as in English. Also goes after the person and before the verb: ‘I also like’. It is one of the most common words in speech, and often just links one idea to the next. But adds a contrast: ‘like, but expensive’. Or is also inside the ending ‘or not?’ from day 8.',
        ],
        examples: ['but', 'or', 'also'],
      },
      {
        heading: 'How often, and how old',
        body: [
          'Always and sometimes say how often. How old is ‘age how-much?’, with the question word at the end as usual, and the answer is age, then the number, then the word for year. Cute works for people, pets and things alike. Family and friends are the usual topics for this kind of small talk.',
        ],
        examples: ['always', 'sometimes', 'how-old', 'cute'],
      },
    ],
  },
  {
    day: 29,
    title: 'Signs and the tone test',
    goal: 'By the end of today you can read door and exit signs and check every tone rule in one pass.',
    sections: [
      {
        heading: 'Door signs',
        body: [
          'Entrance is ‘way enter’; exit is ‘way go-out’. Push and pull are on most doors, so read them before you lean.',
        ],
        examples: ['entrance', 'exit', 'push', 'pull'],
      },
      {
        heading: 'The tone rules in one pass',
        body: [
          'Class of the first letter, then live or dead, then any mark. No mark: mid and low class give mid when live; dead gives low on mid and high class, and high or falling on low class. High class gives rising when live.',
          'Marks: the first gives low, or falling on low class. The second gives falling, or high on low class. The third and fourth, on mid class only, give high and rising. A silent h moves a word into the high class. Milk and tea are low-class and live, so both are mid.',
        ],
        examples: ['milk', 'tea'],
      },
      {
        heading: 'Your weak patterns',
        body: [
          'Today’s practice goes back to the patterns you have found hardest. Common trouble spots are where not goes, which want to use, the classifier after a number, and question words at the end. Build a few sentences of each in the sentence builder.',
        ],
      },
    ],
  },
  {
    day: 30,
    title: 'Checkpoint: thirty days',
    goal: 'By the end of today you can see everything the first thirty days have built, whether your course ends here or carries on.',
    sections: [
      {
        heading: 'Sentences',
        body: [
          'Thai sentences run who, action, thing, then whatever changes them: very, a little, can, already. Verbs never change; time words and three markers carry when. Not goes before a verb or describing word, and no before a noun. Question words sit where the answer will go. Counting is thing, number, classifier.',
          'Politeness rests on your ending, the softener and never mind.',
        ],
        examples: ['i-speak-a-little-thai'],
      },
      {
        heading: 'Sounds and script',
        body: [
          'Every syllable has a tone, and you can now read it from the spelling: three classes, live and dead, four marks, the silent h and the silent-letter mark. You can read signs and menus slowly, and the tone lab and drills keep sharpening your ear.',
        ],
      },
      {
        heading: 'What next',
        body: [
          'If your course ends today, keep review going for a few minutes a day: it keeps what you have. If you are on the sixty-day course, the second half goes further: every vowel form, reading running text, natural-speed listening and longer conversations. Either way, this page is a good one to come back to.',
        ],
      },
    ],
  },

  // ---------- days 31 to 60 ----------
  {
    day: 31,
    title: 'Opinions and feelings',
    goal: 'By the end of today you can give an opinion, say how you feel, and pair each short vowel with its long one.',
    sections: [
      {
        heading: 'Think that',
        body: [
          'To give an opinion, start with think-that, then the opinion: ‘think-that expensive’. The I in front is usually dropped. It also covers English I guess and I believe. The same linking word introduces anything thought or said, which comes back on day 36. I think so too is ‘think same’.',
        ],
        examples: ['in-my-opinion', 'i-think-so-too'],
      },
      {
        heading: 'Feel',
        body: [
          'Feel goes before the feeling: ‘feel nervous’. It is followed directly by the feeling, with no like or that. Most feelings can also stand alone as describing words, with no am.',
        ],
        examples: ['i-feel', 'excited', 'nervous', 'relaxed'],
      },
      {
        heading: 'Short and long, in pairs',
        body: [
          'Almost every Thai vowel comes as a pair, short and long, and length can change the word. The short forms of the vowels written in front add a short a sign after the consonant.',
          'When a final consonant follows, some short vowels change shape. A short e takes the shortening mark from day 18, as in small. A short o is often not written at all, as in person: a syllable of just two letters, a first and a final, usually hides that o.',
        ],
        examples: ['small', 'cl-person'],
      },
    ],
  },
  {
    day: 32,
    title: 'Things you have done',
    goal: 'By the end of today you can ask about and describe past experiences, and read the three vowel glides.',
    sections: [
      {
        heading: 'Ever and never',
        body: [
          'Ever goes before the verb: ‘ever go?’ With the question word at the end, it asks have you ever. Answer with ‘ever’ for yes, or ‘not ever’ for no. The verb does not change. Have you been here before is ‘ever come, question word?’, and first time is a natural answer.',
        ],
        examples: ['have-ever-done', 'never-have-done', 'been-here-before', 'first-time'],
      },
      {
        heading: 'Points in the past',
        body: [
          'Last night and this morning are fixed phrases. Ago goes after a length of time: ‘two days ago’. Last week is built the same way, ‘week ago’. The second half of ago is the done word: something done, now behind you.',
        ],
        examples: ['last-night', 'this-morning', 'last-week', 'ago'],
      },
      {
        heading: 'Three glides',
        body: [
          'Today’s vowels glide from one sound to another: ia, the spread-lips oo into a, and ua. Each is written in pieces around the consonant, as in beer, tiger and the classifier for animals. All three count as long, so they make a syllable live.',
          'When a final consonant follows the ua glide, its top piece drops and only the w letter stays, as in mango.',
        ],
        examples: ['beer', 'tiger', 'cl-animal', 'mango'],
      },
    ],
  },
  {
    day: 33,
    title: 'Comparing in detail',
    goal: 'By the end of today you can say a bit more, much more and as much as, and choose the right tone mark when you write.',
    sections: [
      {
        heading: 'A bit more, much more',
        body: [
          'Add a little or very after a comparison: ‘bigger a-little’ is a bit bigger, ‘bigger very’ is much bigger. Less than works like more than. For as big as, join the two things with and, then say ‘big equally’.',
        ],
        examples: ['less-than', 'equally-as-as', 'a-little'],
      },
      {
        heading: 'Too big, too small, just right',
        body: [
          'Too goes after the describing word, and here it is the word for go: ‘big go’ means too big. The longer too-much from day 25 is stronger. Fits well means just right. These are the sentences of a fitting room.',
        ],
        examples: ['too-big', 'too-small', 'fits-well', 'fitting-room'],
      },
      {
        heading: 'Writing the first two marks',
        body: [
          'To write a tone you hear, decide the class of the first letter and whether the syllable is live or dead, then pick the mark that gives that tone. The same tone needs different marks on different classes.',
          'All three words below fall. Rice and nine take the second mark, on a high-class and a mid-class letter. Not takes the first mark, because it starts with a low-class letter. Check by reading the word back with the rules.',
        ],
        examples: ['rice', 'n9', 'mai-not'],
      },
    ],
  },
  {
    day: 34,
    title: 'If, maybe, probably',
    goal: 'By the end of today you can talk about plans that might change and write the third and fourth tone marks.',
    sections: [
      {
        heading: 'If, then',
        body: [
          'If goes first, as in English. The result often takes the also word from day 28. The word below, meaning in that case, usually replies to what someone else said: ‘in-that-case next time’. Next time is ‘occasion front’: the word for front also means next.',
        ],
        examples: ['if', 'so-then', 'next-time'],
      },
      {
        heading: 'Maybe and probably',
        body: [
          'Maybe and probably go before the verb, like will: ‘maybe rain’. Probably is ‘worth will’, the worth word from cute plus will. Instead goes after the verb: ‘go instead’. It can’t be helped is ‘help cannot’, a phrase you will hear when plans fall through, and a calm one to use yourself.',
        ],
        examples: ['maybe', 'probably', 'instead', 'it-cant-be-helped'],
      },
      {
        heading: 'Writing the rare marks',
        body: [
          'On a mid-class letter, a high tone needs the third mark and a rising tone the fourth. On a low-class letter, high comes from the second mark, as in horse, or from a short dead syllable. A low-class letter can only rise with a silent h in front. So when you write a high or rising tone, check the class first.',
          'Few everyday words need the third and fourth marks, so learn them as you meet them.',
        ],
        examples: ['tuk-tuk', 'noodles', 'horse'],
      },
    ],
  },
  {
    day: 35,
    title: 'Chains of requests',
    goal: 'By the end of today you can ask for two things at once, report what does not work, and write words from dictation.',
    sections: [
      {
        heading: 'This, and then that',
        body: [
          'To chain two requests, put and-then between them and the softener at the end: ‘may I have a towel, and-then water, softener’. And-then is the done word plus also: done, also, the next thing. After that and before put the steps of a story or a plan in order.',
        ],
        examples: ['and-then', 'after-that', 'before'],
      },
      {
        heading: 'It doesn’t work',
        body: [
          'Doesn’t work is ‘use cannot’: the cannot pattern from day 6, on the verb use. Broken is a describing word, and it also means spoiled, for food that has gone off. To ask for a repair, start with please: ‘please fix’. Send someone up is ‘send person up-come’. Shower is ‘lotus pod’, from the shape of the head.',
        ],
        examples: ['doesnt-work', 'broken', 'fix', 'send-someone-up', 'shower'],
      },
      {
        heading: 'Dictation, round two',
        body: [
          'Use the same steps as day 25: first sound, vowel and length, final sound, tone, and only then the mark. Dirty is a good test: three dead syllables in a row, all low, and none needs a mark. Write the word, then read it back aloud with the rules; if the tone you read is not the tone you heard, the mark is wrong.',
        ],
        examples: ['dirty'],
      },
    ],
  },
  {
    day: 36,
    title: 'He said that',
    goal: 'By the end of today you can report what someone said, say whether it is true, and read a short notice.',
    sections: [
      {
        heading: 'Said that',
        body: [
          'To report speech, use say-that, then the words, with no change of tense: ‘he, say-that, busy’. Thai has one word for both he and she, and they is a group word in front of it; listeners rely on context, and so will you. Tell is the same verb without the linking word.',
        ],
        examples: ['say-that', 'he-or-she', 'they', 'tell'],
      },
      {
        heading: 'True, really',
        body: [
          'True is a describing word, so not true takes not like any other. A small mark after a word tells you to say it twice: ‘true, twice’ means really, truly. Doubling also turns some describing words into ways of doing, as in speak slowly, where you met the same mark.',
        ],
        examples: ['true', 'not-true', 'really-truly', 'speak-slowly-please'],
      },
      {
        heading: 'Reading running text',
        body: [
          'Thai is written without spaces between words. A space marks the end of a phrase or sentence, where English would use a comma or a full stop. To split a line, look for the vowels written in front of a consonant: each one always starts a new syllable. Notices are short, so the first words usually carry the point.',
        ],
        examples: ['where-is-the-toilet'],
      },
    ],
  },
  {
    day: 37,
    title: 'Checkpoint: the second half so far',
    goal: 'By the end of today you can see what the second half has added and know what to practise next.',
    sections: [
      {
        heading: 'Grammar since day 30',
        body: [
          'Opinions with think-that, experiences with ever, comparisons with more-than, a little and equally, conditions with if, chained requests with and-then, and reported speech with say-that. All of them follow the old rules: the verb never changes, and small words carry the meaning.',
        ],
      },
      {
        heading: 'Script since day 30',
        body: [
          'You have now written every consonant and met the short and long forms of the vowels, the glides, and all four tone marks in writing. Almost the whole system is in place; what remains is practice and a few special cases.',
        ],
      },
      {
        heading: 'Food by region',
        body: [
          'Today’s words name food the way Thai names most things: food first, then the region. Sticky rice belongs to the north and the north-east.',
        ],
        examples: ['northern-food', 'north-eastern-food', 'southern-food', 'sticky-rice'],
      },
      {
        heading: 'What to practise',
        body: [
          'Check which patterns the checkpoint marks as weak and give each a few sentences in the sentence builder. If writing is weak, practise the letters you missed on paper, saying each one as you write it. If listening is weak, play the day’s words at normal speed before slow. Keep review going every day.',
        ],
      },
    ],
  },
  {
    day: 38,
    title: 'Worried, surprised, annoyed',
    goal: 'By the end of today you can describe stronger feelings, report something left behind, and read consonant clusters.',
    sections: [
      {
        heading: 'Heart words',
        body: [
          'Many Thai words for feeling and thinking are built on the word for heart or mind. Surprised is ‘fall heart’. Understand is ‘enter heart’. Change your mind, or your plans, is ‘change heart’. The heart word appears in dozens of everyday expressions, so it repays learning well. Worried and angry are plain describing words.',
        ],
        examples: ['surprised', 'understand', 'change-plans', 'worried'],
      },
      {
        heading: 'Left behind',
        body: [
          'To say you left something somewhere: ‘forget, the thing, keep, at, the place’. The keep word after the thing shows it stayed where you put it down. Wallet is ‘bag money’. Find is ‘look for, meet’: search, then come upon it.',
        ],
        examples: ['forget', 'leave-behind', 'wallet', 'find'],
      },
      {
        heading: 'Clusters',
        body: [
          'Some words start with two consonants and no vowel between, such as kr, kl or pr. Say them together as one syllable, with no vowel slipped in. The first letter decides the class, so near, with a mid-class first letter and the second mark, falls.',
          'In everyday speech the r in a cluster is often softened to l or dropped. Say it fully, but expect to hear it go.',
        ],
        examples: ['near', 'sour', 'straight'],
      },
    ],
  },
  {
    day: 39,
    title: 'Trains and borrowed words',
    goal: 'By the end of today you can book a train ticket, ask when it leaves, and read borrowed and irregular spellings.',
    sections: [
      {
        heading: 'Booking',
        body: [
          'Tickets and berths put the noun first and the detail after: a return ticket is ‘ticket go-return’, berths are ‘bed top’ and ‘bed lower’. One-way is ‘trip single’, and seat is ‘place sit’. Platform and timetable are the signs to look for at the station.',
        ],
        examples: ['return-ticket', 'one-way', 'upper-berth', 'lower-berth', 'seat'],
      },
      {
        heading: 'What time does it leave?',
        body: [
          'Put the vehicle first, then the verb, then the question at the end: ‘train, leave, what time?’ Arrive works the same way. Depart is the go-out word from exit, and arrive is the same word as to, from day 16.',
        ],
        examples: ['train', 'depart', 'arrive'],
      },
      {
        heading: 'Borrowed and irregular spellings',
        body: [
          'Words borrowed from English are spelt to match the Thai sound, often with the silent-letter mark. Coffee, beer and bar are borrowed too. Some words use letters rare elsewhere, such as the vowel letter in England.',
          'A few common words are simply irregular. Also is written with the shortening mark and no tone mark, yet it is said with a falling tone. Taxi follows the rules, though: read its two tones for yourself.',
        ],
        examples: ['england', 'also', 'taxi'],
      },
    ],
  },
  {
    day: 40,
    title: 'Ordering for a group',
    goal: 'By the end of today you can order for a table, share and split the bill, and mention an allergy.',
    sections: [
      {
        heading: 'One more plate',
        body: [
          'Another plate of rice is ‘rice, more, plate’: with one, the number is usually dropped. With more than one, say it: ‘rice, more, two, plate’. A table for six is ‘table for six person’, with person as the classifier. The word for table carries the third tone mark from day 16.',
        ],
        examples: ['another-plate-of-rice', 'table-for-six'],
      },
      {
        heading: 'Each and every',
        body: [
          'Every goes before a classifier or a time word: ‘every person’ is everyone, and ‘every day’ is every day. One each is ‘person each thing’: the each word between them means per. Every works with any classifier: every glass, every plate.',
        ],
        examples: ['everyone', 'one-each'],
      },
      {
        heading: 'Preferences and paying',
        body: [
          'Not too salty is ‘not salty too-much’. Sharing dishes is ‘eat together’, splitting the bill is ‘divide together’, and my treat is ‘treat self’. Thai meals are usually shared, so ordering several dishes for the table is normal.',
        ],
        examples: ['not-too-salty', 'share-dishes', 'split-the-bill', 'my-treat'],
      },
      {
        heading: 'Allergies',
        body: [
          'If peanuts or seafood matter to you, use the allergic pattern from day 20: ‘allergic peanuts’. Say it before you order, not after. If you are unsure, ask whether a dish has them: ‘have peanuts, question word?’.',
        ],
        examples: ['peanuts', 'seafood', 'allergic-to'],
      },
    ],
  },
  {
    day: 41,
    title: 'Symptoms and doses',
    goal: 'By the end of today you can describe symptoms and when they started, follow dosing instructions, and read numbers in text.',
    sections: [
      {
        heading: 'Since when',
        body: [
          'Name the symptom, then since and the time: ‘cough since yesterday’. Since works with any time word: since this morning, since last night. Sore throat is ‘hurt throat’, and dizzy is ‘spin head’. Diarrhoea is ‘stomach broken’, with the broken word from day 26.',
        ],
        examples: ['since', 'sore-throat', 'dizzy', 'cough'],
      },
      {
        heading: 'How often',
        body: [
          'Doses use per: ‘day, per, two, time’ is twice a day. It is the same per you met in one each on day 40. Every day is ‘every day’, and after meals is ‘after food’.',
        ],
        examples: ['twice-a-day', 'every-day', 'after-meals'],
      },
      {
        heading: 'At the clinic',
        body: [
          'Feel sick, meaning about to vomit, is a different word from sick meaning ill, so use the right one. Clinic and insurance are the other two words you will need there.',
        ],
        examples: ['feel-sick-nauseous', 'sick', 'clinic', 'insurance'],
      },
      {
        heading: 'Numbers in writing',
        body: [
          'Written times often use the 24-hour clock, with a short abbreviation after the number, even though people speak in the blocks from day 15. Years are often counted in the Buddhist Era, 543 years ahead of the Western count, so check which one a date uses.',
        ],
      },
    ],
  },
  {
    day: 42,
    title: 'Little words with big jobs',
    goal: 'By the end of today you can soften, urge and stress with four common particles, and follow them at natural speed.',
    sections: [
      {
        heading: 'Softening',
        body: [
          'นะ at the end of a sentence softens it: a request becomes gentle, a statement invites agreement. It is one of the commonest particles of all. After it, a woman uses her question ending, not her statement ending; a man’s ending does not change.',
        ],
        examples: ['softening-particle-na', 'wait-a-moment'],
      },
      {
        heading: 'Urging and stress',
        body: [
          'One particle urges: go on, of course. Another stresses: completely, or go right ahead. The third adds feeling, like so in so cute. Each changes the mood of a sentence, not its meaning.',
          'Of course is ‘sure’ plus the urging particle, and go ahead is ‘take’ plus the stress particle. After a negative, the stress particle means at all: ‘not like at-all’.',
        ],
        examples: ['urging-particle-si', 'of-course', 'emphasis-particle-loei', 'go-ahead', 'particle-for-so-jang'],
      },
      {
        heading: 'Listening at speed',
        body: [
          'Particles are short and come at the end, where the speaker’s attitude lives. When natural speech feels too fast, catch the last word or two first: they tell you whether you heard a question, a request or a friendly remark. Particles can stack: the softener and the polite ending often come together.',
        ],
      },
    ],
  },
  {
    day: 43,
    title: 'Casual questions and phone calls',
    goal: 'By the end of today you can ask casual checking questions, handle a phone call, and follow speech with dropped pronouns.',
    sections: [
      {
        heading: 'Really? and yet?',
        body: [
          'Add the checking word to the end of a statement to ask whether it is really so: ‘busy, really?’. ‘True, really?’ is a whole reply on its own. The yet question from day 16 has a quick spoken form that runs or and yet together.',
        ],
        examples: ['really-checking', 'or-not-yet', 'yet'],
      },
      {
        heading: 'On the phone',
        body: [
          'Phone hello is borrowed from English, and it is for calls, not for greeting people face to face. Who’s calling is ‘who phone come?’, and can you hear me is ‘hear, question word?’. Speak louder doubles loud, then softens the request. Battery dead is the borrowed battery plus the word for used up.',
        ],
        examples: ['hello-on-the-phone', 'whos-calling', 'can-you-hear-me', 'speak-louder', 'my-phone-battery-is-dead'],
      },
      {
        heading: 'Dropped pronouns',
        body: [
          'At natural speed, I, you and he are left out whenever the context makes them clear. A question to you is about you; an answer is about the speaker. Questions often keep only the key word and the ending: ‘eat yet?’ is complete and natural. When you lose track, ask who. It is a normal question, not a failure.',
        ],
        examples: ['who'],
      },
    ],
  },
  {
    day: 44,
    title: 'Checkpoint: running text and new voices',
    goal: 'By the end of today you can read short running text and hear tones in voices you have not heard before.',
    sections: [
      {
        heading: 'Since day 37',
        body: [
          'Clusters and the first letter that decides their class, borrowed and irregular spellings, the four particles, casual questions, symptoms and doses, and ordering for a group. The patterns are new; the rules underneath are the same. If any of these felt shaky, go back to that day’s lesson in the library.',
        ],
      },
      {
        heading: 'New voices',
        body: [
          'Every voice sits at a different height. A tone is a shape within the speaker’s own range, not a fixed note, so listen for the movement: level, low, falling, high or rising. A deep voice and a high voice draw the same shapes. The course has four voices to train exactly this.',
        ],
      },
      {
        heading: 'Festivals',
        body: [
          'New year is ‘year new’: the describing word after the noun, as always. Public holiday is ‘day stop’, and lantern is ‘lamp light’.',
        ],
        examples: ['new-year', 'public-holiday', 'festival', 'lantern'],
      },
      {
        heading: 'What to practise',
        body: [
          'If new voices threw you, give the tone lab a few minutes a day. For running text, read street signs and notes slowly, then play them to check.',
        ],
      },
    ],
  },
  {
    day: 45,
    title: 'Money and Thai numerals',
    goal: 'By the end of today you can change money, use a cash machine, and recognise the Thai digits.',
    sections: [
      {
        heading: 'Change X into Y',
        body: [
          'To change money, say ‘exchange’, the money you have, the word for be, then the money you want. Here be means into. Pound and dollar are borrowed, so they read the way they sound. Withdraw is ‘pull out money’, and the rate and the fee are the two numbers to check.',
        ],
        examples: ['exchange-money', 'pound-money', 'withdraw', 'fee'],
      },
      {
        heading: 'Words from parts',
        body: [
          'A cash machine is ‘cabinet ATM’, and the machine kept my card is ‘cabinet eat card’. Exchange rate is ‘rate, exchange, change’. Banknote is borrowed from the English bank. Thai often builds a new word from plain parts, so it pays to look inside long words.',
        ],
        examples: ['cash-machine', 'the-machine-kept-my-card', 'exchange-rate', 'banknote'],
      },
      {
        heading: 'Thai digits',
        body: [
          'Thai has its own digits for zero to nine. Western digits are far more common, but Thai ones appear on some signs, menus and official papers. They work the same way, place by place, so once you know the ten shapes you can read any number. Zero is a small circle, easy to spot.',
        ],
      },
    ],
  },
  {
    day: 46,
    title: 'Where exactly',
    goal: 'By the end of today you can say where something is next to, opposite or above, and read transport signs.',
    sections: [
      {
        heading: 'Side words',
        body: [
          'Most position words are built on the word for side: in front, behind, inside, outside, upstairs and downstairs are all ‘side’ plus a direction. Next to doubles the side word. Remember them as side plus a direction and the whole set comes easily. The front word also means face and next, as in next time, and the back word also means after, as in after meals.',
        ],
        examples: ['in-front-of', 'behind', 'inside', 'next-to'],
      },
      {
        heading: 'Between and opposite',
        body: [
          'Location uses be-at, then the position word, then the landmark: ‘toilet be-at next-to lift’. Between takes two landmarks joined by and. Opposite is ‘straight across’. A full description stacks them: ‘pharmacy be-at opposite hotel’. Near and far, from day 12, still work for anything less exact. Practise with real places near you.',
        ],
        examples: ['between', 'opposite', 'lift'],
      },
      {
        heading: 'Floors and signs',
        body: [
          'Floor comes before its number: ‘floor three’. Thai borrowed lift from British English, not elevator. Upstairs and downstairs also mean above and below. On transport signs, look for words you already know: station, platform, entrance and exit. Signs are short, so the first word usually carries the meaning.',
        ],
        examples: ['floor', 'upstairs', 'downstairs', 'station'],
      },
    ],
  },
  {
    day: 47,
    title: 'Older, younger and formal',
    goal: 'By the end of today you can address people by age, move into a more formal register, and recognise royal vocabulary.',
    sections: [
      {
        heading: 'Older and younger',
        body: [
          'Thai often uses family words instead of you and I. Someone a little older is addressed with the older-sibling word, someone younger with the younger-sibling word, and older men and women with the uncle and aunt words. It is warm and polite, and you can use these words for yourself. When unsure, the older-sibling word is the safe choice.',
        ],
        examples: ['older-person-phii', 'younger-person-nawng', 'uncle-older-man-lung', 'aunt-older-woman-bpaa'],
      },
      {
        heading: 'Going up a register',
        body: [
          'Men use the same I in everyday and formal speech. Women have a more formal I for formal settings. Formal please is mostly written, on signs and in announcements, and comes before the verb like the everyday one. Thank you very much and excuse me with a softener are polite in any setting.',
        ],
        examples: ['i-male', 'i-formal-female', 'please-formal', 'thank-you-very-much', 'excuse-me-to-get-attention'],
      },
      {
        heading: 'Royal and formal vocabulary',
        body: [
          'Thai has a special vocabulary for the royal family, and another for monks, with their own words even for eat and sleep. You will see them in the news and on signs. Recognise them when you meet them; you do not need to use them, and simple politeness is enough.',
        ],
      },
    ],
  },
  {
    day: 48,
    title: 'Invitations and replies',
    goal: 'By the end of today you can invite someone, accept or decline, and write a short message to arrange a meeting.',
    sections: [
      {
        heading: 'Inviting',
        body: [
          'Invite works like ask: ‘invite friend, go eat’. Are you coming is ‘come, question word?’, and count me in is ‘go too, person’. Where and when to meet put the question word at the end, as always: ‘meet where?’, ‘meet what time?’. Live music is ‘music fresh’, the same fresh as in cash, ‘money fresh’.',
        ],
        examples: ['invite', 'are-you-coming', 'count-me-in', 'where-shall-we-meet', 'what-time-shall-we-meet', 'live-music'],
      },
      {
        heading: 'Yes, and not this time',
        body: [
          'A warm yes is ‘want go very’. Maybe next time is ‘keep day after’: keep it for later, with the keep word from day 38. That is a soft no, and it is fine to take it as one. Running late is ‘will go late, softener’.',
        ],
        examples: ['id-love-to', 'maybe-next-time', 'ill-be-a-bit-late'],
      },
      {
        heading: 'Writing a short message',
        body: [
          'A message follows the order of speech. Keep it to what, where and when, leave out I and you, and close with your polite ending as you would aloud. Numbers and times are easiest in digits. Write it in Thai script, then check each tone against the rules before you send it.',
        ],
      },
    ],
  },
  {
    day: 49,
    title: 'Describing people and places',
    goal: 'By the end of today you can describe a person and a place, and read a short story.',
    sections: [
      {
        heading: 'People',
        body: [
          'Tall, short and kind are describing words, so they follow the person with no is: ‘friend tall’. Very goes after: ‘tall very’. Thai has two words for short, one for height and one for length, so pick the right one. Kind is ‘heart good’, the heart word from day 38 again. Funny is the word for someone who makes you laugh.',
        ],
        examples: ['tall', 'short-height', 'short-length', 'kind', 'funny'],
      },
      {
        heading: 'Places',
        body: [
          'To link two descriptions, put and-then between them: ‘room big, and-then clean’. Crowded is ‘people many’. Home town is ‘house born’, and river is ‘mother water’. City and countryside are the two halves of most stories about home. Big, small, clean and noisy from earlier days all work here too.',
        ],
        examples: ['crowded', 'quiet', 'home-town', 'river'],
      },
      {
        heading: 'Reading a short story',
        body: [
          'A story moves forward by its time words and linking words. Find those first, then read each chunk between them. You do not need every word to follow what happened; the verbs and nouns you know carry most of it. Read it once without stopping, then again for the words you missed.',
        ],
      },
    ],
  },
  {
    day: 50,
    title: 'Teasing and fast speech',
    goal: 'By the end of today you can tease and be teased, tell someone not to do something, and catch tone changes in fast speech.',
    sections: [
      {
        heading: 'Don’t',
        body: [
          'Don’t goes before the action: ‘don’t tease’. It is one of the four words with a silent vowel carrier before y, so it is low; the others are want to, be at and a word meaning kind or way. Add the softening word from day 42 to make it friendlier.',
        ],
        examples: ['dont-tease-me'],
      },
      {
        heading: 'Banter',
        body: [
          'Just kidding and no way keep banter light. No way is ‘not have way’, and lucky is ‘luck good’. You’re good at bargaining is a compliment you may earn at the market. Cute is built from a word meaning worth before love: worth loving. Teasing among friends is a sign of warmth, so laugh along.',
        ],
        examples: ['just-kidding', 'no-way', 'lucky', 'youre-good-at-bargaining', 'cute'],
      },
      {
        heading: 'Fast speech in practice',
        body: [
          'Day 23 showed the question word said high in relaxed speech, and he is often said high too. Longer questions shrink as well: seriously is ‘true’ plus a clipped or-not, cut to one quick syllable. Hearing these is the goal. Keep your own speech clear.',
        ],
        examples: ['seriously', 'or-not', 'mai-q'],
      },
    ],
  },
  {
    day: 51,
    title: 'Checkpoint: five minutes of talk',
    goal: 'By the end of today you can keep a short conversation going and know what to practise for the last stretch.',
    sections: [
      {
        heading: 'Keeping it going',
        body: [
          'Five minutes of talk is not about knowing every word. It is about asking when you do not follow. Say it again, speak slowly, what does it mean and how do you say are the tools; use them as often as you need. Keep sentences short, and use the patterns you trust. A pause while you think is fine.',
        ],
        examples: ['say-it-again', 'speak-slowly-please', 'what-does-it-mean', 'how-do-you-say'],
      },
      {
        heading: 'At a temple',
        body: [
          'Today’s words are for a temple visit. Take off shoes is ‘take off, shoes’, and the quiet sign uses the formal please from day 47. Pray is the word for the wai greeting plus the word for monk. Monk is a short, dead syllable on a low-class letter, so it is high.',
        ],
        examples: ['take-off-shoes', 'please-be-quiet', 'monk', 'pray'],
      },
      {
        heading: 'What to practise',
        body: [
          'Since day 44: money, position words, family words for people, invitations, descriptions and teasing. Look at where the live talk stalled. Was it a missing word, a pattern, or hearing? Review covers the first, the sentence builder the second, and the tone lab and listening the third.',
        ],
      },
    ],
  },
  {
    day: 52,
    title: 'Delays and refunds',
    goal: 'By the end of today you can talk about delays and cancellations, ask for a refund, and write whole sentences from dictation.',
    sections: [
      {
        heading: 'Delays and cancellations',
        body: [
          'Delayed is borrowed from English, followed by the number of hours: ‘flight delayed two hour’. Cancelled puts a small marker before cancel to show it happened to the flight. Thai uses this marker mostly for things that happen to someone against their wishes, and it is spelt like the word for cheap. Miss a bus or a train is ‘fall vehicle’; for a flight, swap in the plane word from boarding pass.',
        ],
        examples: ['delayed', 'cancelled', 'cheap', 'miss-a-flight-or-train'],
      },
      {
        heading: 'Getting money back',
        body: [
          'Refund is ‘return money’. Compensation and the next flight are the other two things to ask about at the desk. Ask for each with may I have, from day 2: ‘may I have refund’. Overweight luggage is ‘weight over’, with the over word from too-much on day 25. Boarding pass is ‘card, board, plane’.',
        ],
        examples: ['refund', 'compensation', 'next-flight', 'overweight-luggage', 'boarding-pass'],
      },
      {
        heading: 'Dictation: whole sentences',
        body: [
          'Write a whole sentence as one chain, with no spaces between words, and a space only where a phrase ends. Work word by word with the steps from day 25, then read the whole line back for tones.',
        ],
      },
    ],
  },
  {
    day: 53,
    title: 'Agreeing and disagreeing',
    goal: 'By the end of today you can agree, disagree gently, and steer away from a topic.',
    sections: [
      {
        heading: 'Agreeing',
        body: [
          'Agree is ‘see with’: you see it the same way. That’s right uses the word for correct, which is the same word as cheap. I think so too is ‘think same’. Agree with your polite ending is a full, polite reply on its own.',
        ],
        examples: ['agree', 'thats-right', 'i-think-so-too'],
      },
      {
        heading: 'Disagreeing gently',
        body: [
          'Thai disagreement is usually soft. I don’t think so is ‘think-that not’, with the softening word at the end. It depends is a useful middle answer, and interesting is ‘worth interest’, the worth word again. When a topic is uncomfortable, say you do not know much about it, or suggest a change of subject. Some topics are best left alone; today’s culture note says which.',
        ],
        examples: ['i-dont-think-so', 'it-depends', 'interesting', 'i-dont-know-much-about-that', 'lets-change-the-subject'],
      },
      {
        heading: 'Reading headlines',
        body: [
          'Headlines pack words tightly and leave out small words. Read them slowly, word by word, and look for the nouns first. Prices are going up puts the up word after expensive, as more did on day 26. Read the headline first, then the first line under it. Weather is a safe topic anywhere.',
        ],
        examples: ['news', 'prices-are-going-up', 'weather'],
      },
    ],
  },
  {
    day: 54,
    title: 'Plans and boundaries',
    goal: 'By the end of today you can say what you are and are not comfortable with, and hear a no that is not said as no.',
    sections: [
      {
        heading: 'Saying how you feel about a plan',
        body: [
          'Not comfortable is ‘not comfortable heart’, with the comfortable from how are you; comfortable heart on its own means at ease. Not tonight is ‘tonight not convenient’. Please stop is ‘enough already’. None of them needs a reason after it, and your polite ending makes each one firm and polite at once.',
        ],
        examples: ['im-not-comfortable', 'not-tonight', 'please-stop'],
      },
      {
        heading: 'Hearing a no',
        body: [
          'Thai often says no without the word no. Not convenient, maybe next time, or a change of subject can all mean no. Take them as one, without pushing or asking again. When you are the one saying no, the same soft forms are open to you.',
        ],
        examples: ['maybe-next-time'],
      },
      {
        heading: 'Asking first',
        body: [
          'To ask whether something is all right, put the action first, then can and the question word: ‘sit here, can, question word?’. It is the same pattern as any polite request, so asking first sounds natural, not awkward. Ask, then take the answer as given; a yes should be as clear as a no. Respect is ‘give honour’, and it runs through all of this.',
        ],
        examples: ['dai', 'mai-q', 'respect'],
      },
    ],
  },
  {
    day: 55,
    title: 'Islands and boats',
    goal: 'By the end of today you can ask how long a crossing takes, when the last boat leaves, and what to bring.',
    sections: [
      {
        heading: 'How long by boat',
        body: [
          'Sit plus a vehicle means ride it, from day 27. Put it together: ‘sit boat, go island, long how-much?’. The question goes at the end. Island is a short, dead syllable on a mid-class letter, so it is low.',
        ],
        examples: ['boat', 'island', 'how-long'],
      },
      {
        heading: 'The last boat',
        body: [
          'When does the last boat leave is ‘boat, round, last, leave, what time?’: the thing first, the question at the end. Round is the word from one more round on day 10, and last is ‘utmost end’. Ask before you set out, as island boats can stop early. Big waves is ‘wave strong’, a phrase to listen for before you board.',
        ],
        examples: ['when-does-the-last-boat-leave', 'big-waves'],
      },
      {
        heading: 'Words from parts',
        body: [
          'Many beach words are built from plain parts. A life jacket is a shirt that keeps you afloat, sunscreen is ‘cream protect sun’, a speedboat is ‘boat fast’, and go snorkelling is ‘dive water’. When you meet a long word, look for the short words inside it. Sea and beach are the words for the rest of the day.',
        ],
        examples: ['life-jacket', 'sunscreen', 'speedboat', 'go-snorkelling', 'sea', 'beach'],
      },
    ],
  },
  {
    day: 56,
    title: 'Emergencies',
    goal: 'By the end of today you can call for help, check that someone is all right, and give a quick instruction.',
    sections: [
      {
        heading: 'Calling for help',
        body: [
          'The call for help is help plus a small word meaning also, and everyone understands it. Call an ambulance is ‘call’ plus ambulance, which is itself ‘vehicle nurse’. Fire is ‘fire burn’. Accident is the first word to give. Keep the emergency numbers saved on your phone, as the day 20 culture note suggests.',
        ],
        examples: ['help-calling-for-help', 'call-an-ambulance', 'fire', 'accident'],
      },
      {
        heading: 'Checking on someone',
        body: [
          'Are you okay is ‘be what, question word?’: is anything wrong? Someone fainted is ‘be wind’, and bleeding is ‘blood out’. Injured is the more formal word; it hurts, from day 19, works too. Don’t move uses the don’t from day 50, low like the other three words of its kind.',
        ],
        examples: ['are-you-okay', 'someone-fainted', 'bleeding', 'injured', 'dont-move'],
      },
      {
        heading: 'Quick',
        body: [
          'In an emergency, fast goes before a command to urge: ‘fast, call’. I’ll get help is a whole plan in one line: ‘I will go fetch person come help’. Thief is the word to shout if something is snatched. Your polite ending can wait; clear words matter more.',
        ],
        examples: ['fast', 'ill-get-help', 'thief'],
      },
    ],
  },
  {
    day: 57,
    title: 'Telling a story',
    goal: 'By the end of today you can tell the story of your trip in order and say what you will remember.',
    sections: [
      {
        heading: 'Story order',
        body: [
          'First of all, next, suddenly and in the end mark the steps of a story. Put each at the start of its part; the verbs never change. First of all is ‘before other’, next is ‘continue come’, and in the end contains the most from day 26; finally, ‘in the most’, works the same way. Suddenly doubles a word, like really.',
        ],
        examples: ['first-of-all', 'next-in-a-story', 'suddenly', 'in-the-end', 'finally'],
      },
      {
        heading: 'Remembering',
        body: [
          'Remember is ‘remember can’, with can after it as usual; not remember puts not before can. Forget, from day 38, is its opposite. Unforgettable is a phrase: ‘forget not down’, meaning you cannot bring yourself to forget. Photo, which also means picture, and trip will fill your stories.',
        ],
        examples: ['remember', 'unforgettable', 'photo', 'trip'],
      },
      {
        heading: 'Mixed reading',
        body: [
          'A story uses everything: time words, markers, linking words and classifiers. Read it once for the shape, using the time words, then again for the detail. Then tell it back aloud in your own words, in short sentences: start with the time, add what happened, and finish with how you felt.',
        ],
      },
    ],
  },
  {
    day: 58,
    title: 'Checkpoint: writing and weak patterns',
    goal: 'By the end of today you can write any word you can say, and know which patterns need a last push.',
    sections: [
      {
        heading: 'Direction after the verb',
        body: [
          'Go and come after a verb show direction: away from the speaker, or towards. Come back is ‘return come’, and take is ‘take go’. Up and down work the same way: send someone up is ‘send person up come’. Miss someone is ‘think reach’, and a souvenir is ‘thing entrust’, a thing to give.',
        ],
        examples: ['come-back', 'take', 'send-someone-up', 'miss-someone', 'souvenir'],
      },
      {
        heading: 'Writing, the whole method',
        body: [
          'Hear the first sound and choose its letter. Find the vowel and its length, then the final sound. Decide live or dead, then the tone. If the class and the ending already give that tone, no mark; if not, choose the mark for that class. Then read the word back to check.',
        ],
      },
      {
        heading: 'Weak patterns',
        body: [
          'The checkpoint shows the patterns you trip on. The most common slips are the two wants, where not goes and the classifier, so check those first. Give each weak one a few minutes in the sentence builder. Saying them aloud with the right ending matters as much as getting the order right.',
        ],
      },
    ],
  },
  {
    day: 59,
    title: 'Checkpoint: the final tone test',
    goal: 'By the end of today you can work out any tone from the spelling and hear it in real speech.',
    sections: [
      {
        heading: 'Every rule',
        body: [
          'Class, live or dead, mark. No mark: mid and low class give mid when live, high class gives rising. Dead gives low on mid and high class, and high or falling on low class, by vowel length. The first mark gives low, or falling on low class; the second gives falling, or high on low class; the third and fourth, on mid class only, give high and rising. A silent h makes high class.',
          'Chicken, rice, horse and pork each show one of these rules.',
        ],
        examples: ['chicken', 'rice', 'horse', 'pork'],
      },
      {
        heading: 'Tones in real speech',
        body: [
          'Real speech bends the rules a little: particles carry feeling, fast speech flattens some tones, and every voice sits at its own height. Listen for the shape. The fast-speech changes from days 23 and 50 are worth listening for in every conversation.',
        ],
      },
      {
        heading: 'Keep going',
        body: [
          'Practise is a verb you will need after the course. Keep going is ‘do continue go’. A few minutes a day is enough to keep what you have.',
        ],
        examples: ['practise', 'keep-going'],
      },
    ],
  },
  {
    day: 60,
    title: 'Checkpoint: sixty days',
    goal: 'By the end of today you can see how far you have come and how to keep your Thai going.',
    sections: [
      {
        heading: 'How Thai works, in one page',
        body: [
          'Every syllable has a tone, and the spelling tells you which. Verbs never change; time words and markers say when. Describing words follow what they describe, with no is. Question words sit where the answer goes. Things are counted with a classifier. Pronouns drop away when they are clear. Small words at the end soften, stress or make it polite.',
        ],
      },
      {
        heading: 'What you can do',
        body: [
          'You can greet, order, bargain, find your way, check in, see a pharmacist, make friends, make plans, handle trouble and tell a story, and you can read the signs around you. Congratulations is ‘glad with’, and well done is ‘skilled very’.',
        ],
        examples: ['congratulations', 'well-done'],
      },
      {
        heading: 'Keeping it',
        body: [
          'Memory fades without use. A few minutes of review a day keeps what you have. Read signs wherever you are, and say words aloud with the right tone. Talk to people whenever you can, and ask when you are stuck. When you forget a word, the library has every one, with its sound.',
        ],
      },
    ],
  },
];

const BY_DAY = new Map(LESSONS.map((l) => [l.day, l]));

/** The lesson for a course day, or null when there is none. */
export function lessonFor(day: number): Lesson | null {
  return BY_DAY.get(day) ?? null;
}

/** Lessons from day 1 up to and including `day`, in order. */
export function lessonsUpTo(day: number): Lesson[] {
  return LESSONS.filter((l) => l.day <= day);
}

/** Every example id in a lesson, in order, without repeats. */
export function lessonExamples(l: Lesson): string[] {
  return [...new Set(l.sections.flatMap((s) => s.examples ?? []))];
}

const WORD = /[A-Za-z0-9]/;

/** Words of English in a lesson's section bodies (what the word limits count). */
export function lessonWords(l: Lesson): number {
  return l.sections.flatMap((s) => s.body).join(' ').split(/\s+/).filter((w) => WORD.test(w)).length;
}

/** Runs of Thai script in a string. */
export function thaiRuns(s: string): string[] {
  return s.match(/[฀-๿]+/g) ?? [];
}

/**
 * The learner's own forms first: words only their sex says, then words anyone
 * says, then the other sex's words. Stable within each group.
 */
export function ownFirst<T extends { speaker?: 'm' | 'f' }>(items: T[], identity: 'm' | 'f'): T[] {
  const rank = (it: T) => (!it.speaker ? 1 : it.speaker === identity ? 0 : 2);
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map((x) => x.it);
}

/** The day `/lesson?day=` opens: a whole day from 1 to 60 that has a lesson, else today (capped to the course). */
export function lessonDay(param: string | null, today: number, courseDays: number): number {
  const n = Number(param);
  if (param && Number.isInteger(n) && BY_DAY.has(n)) return n;
  return Math.max(1, Math.min(today, courseDays, LESSONS.length));
}
