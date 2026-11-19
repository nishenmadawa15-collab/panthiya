# Sinhala and Tamil string review

> **English is the source of truth.** Every Sinhala and Tamil string in this project was
> written by someone who speaks neither language. Nothing below has been checked by a native
> speaker. This file is the review surface, not a review.

**What this is for.** Read the English, then read the Sinhala and the Tamil under it and say
whether they mean the same thing. You do not need to open any JSON.

**How to use it.** Two ways, pick whichever is faster for you:

1. Correct the text in place in this file (type over the wrong words), or
2. write the correction on the `Fix:` line under the string, and leave the original alone.

Leave anything that is already right untouched — a blank `Fix:` line means "this is fine".
If a string is wrong but you are not sure what it should be, write what it currently *says*
back in English on the Fix line; that is enough to act on.

Work in order: **Priority 1** (14 safety-critical strings) is the part that must not be wrong
before the demo. **Priority 2** is four words that appear in dozens of strings — getting those
right once fixes them everywhere. **Priority 3** is everything else, grouped so you can skim.
There is a checklist at the end to mark where you stopped.

Source files: `frontend/i18n/en.json`, `si.json`, `ta.json` — 261 keys each, same key set, same order (verified).

Where a Sinhala or Tamil string is byte-identical to the English one, the row is flagged
**MISSING/UNTRANSLATED** — those are real defects worth a word from you. A row marked
_identical — nothing to translate_ holds only placeholders such as `{ran} / {total}`, so it is
expected to match.

---

## Priority 0 — two Sinhala words that are not on a screen (added 2026-11-19)

**Read this one first. It is thirty seconds, and it is not a UI string** — it is the word list the
wellbeing check matches against, in `backend/functions/policy-check/distress.mjs`. It decides
whether a student asking for medicine gets the careful reply instead of the model.

A verification pass found that the list carried **`බෙහෙත්`** and **`පෙති`**, but a student writes
**`බෙහෙතක්`** or **`පෙත්තක්`** — and neither of the old entries is contained in those forms, so the
request went straight past the gate. Those two forms are the ones *this module's own Sinhala reply*
uses, which is how it was spotted.

It has been changed to the stems below, and it errs toward catching more:

| Was | Is now |
|---|---|
| `'බෙහෙත්'`, `'පෙති'` | `'බෙහෙත'`, `'පෙති'`, `'පෙත්ත'` |

**Three questions, and nobody in the session that made this change reads Sinhala:**

1. Do `බෙහෙත` and `පෙත්ත` as stems actually catch the way a student would ask — *බෙහෙතක්*,
   *බෙහෙත්*, *පෙත්තක්*, *පෙති*? Write any form that is missing: ______________________
2. Is there a common word for medicine or a tablet that is **not** in the list at all? A brand name,
   or how a child in a tuition class would really say it: ______________________
3. Does either stem appear inside an ordinary, harmless word? That would block normal schoolwork
   the way `no point` did in English: ______________________

The Tamil half of the same list — `மாத்திரை`, `மருந்து`, `எனக்கு`, `நான்` — was **not** changed and
has never been reviewed. If you know someone who reads Tamil, this list is the highest-value thing
to show them, ahead of every string below.

**Nothing in this section is on a screen, so a mistake here is invisible until a child asks.** That
is why it is above Priority 1.

---

## Priority 1 — safety-critical strings (14 keys)

These carry a safety or honesty distinction. A translation that *reads well* but loses the
distinction is a defect here.

### `parent.approved`, `parent.ask.unverified`

**What must survive:** Must keep the approved-vs-assistant safety distinction: this text is the only thing telling a parent whether the teacher stands behind the message.

#### `parent.approved`

- **EN:** Approved by the teacher
- **SI:** ගුරුතුමා අනුමත කළ
  - Fix (si): 
- **TA:** ஆசிரியர் அனுமதித்தது
  - Fix (ta): 

#### `parent.ask.unverified`

- **EN:** Assistant answer · not approved by the teacher
- **SI:** සහායකයාගේ පිළිතුර · ගුරුතුමා අනුමත කළ එකක් නොවේ
  - Fix (si): 
- **TA:** உதவியாளரின் பதில் · ஆசிரியர் அனுமதித்தது அல்ல
  - Fix (ta): 

---

### `student.promise`, `student.example.label`, `student.example.note`, `student.blocked`

**What must survive:** This is the "hints, never the answer" promise in words. If it reads as "I will answer your question", the product promise is broken in that language.

#### `student.promise`

- **EN:** Panthiya gives you the concept, the next step and a question to think about — never the final answer to your own question. A worked example is always a different problem with different numbers.
- **SI:** පන්තිය ඔබට සංකල්පය, මීළඟ පියවර සහ සිතා බැලීමට ප්‍රශ්නයක් දෙයි — ඔබේ ප්‍රශ්නයට අවසාන පිළිතුර කිසිදා නොදෙයි. විසඳා පෙන්වන උදාහරණය සැමවිටම වෙනස් ගණන් සහිත වෙනස් ප්‍රශ්නයකි.
  - Fix (si): 
- **TA:** பந்தியா உங்களுக்குக் கருத்தையும், அடுத்த படியையும், சிந்திக்க ஒரு கேள்வியையும் தரும் — உங்கள் கேள்விக்கான இறுதி விடையை ஒருபோதும் தராது. செய்து காட்டப்படும் எடுத்துக்காட்டு எப்போதும் வேறு எண்களுடைய வேறு ஒரு கணக்காகவே இருக்கும்.
  - Fix (ta): 

#### `student.example.label`

- **EN:** A different problem
- **SI:** වෙනස් ප්‍රශ්නයක්
  - Fix (si): 
- **TA:** வேறு ஒரு கணக்கு
  - Fix (ta): 

#### `student.example.note`

- **EN:** This is not your question — the numbers are different on purpose. Work through it, then use the same method on your own question.
- **SI:** මෙය ඔබේ ප්‍රශ්නය නොවේ — ගණන් හිතාමතාම වෙනස් කර ඇත. එය හොඳින් බලා, එම ක්‍රමයම ඔබේ ප්‍රශ්නයට යොදන්න.
  - Fix (si): 
- **TA:** இது உங்கள் கேள்வி அல்ல — எண்கள் வேண்டுமென்றே வேறாக உள்ளன. இதைச் செய்து பார்த்து, அதே முறையை உங்கள் கேள்விக்குப் பயன்படுத்துங்கள்.
  - Fix (ta): 

#### `student.blocked`

- **EN:** I cannot answer that one. I give the next step, the concept behind it and a worked example of a different problem, never the final answer to your own question. Ask me what to try next and we will get there together.
- **SI:** එයට පිළිතුරු දෙන්න බැහැ. මම මීළඟ පියවර, එහි පිටුපස ඇති සංකල්පය සහ වෙනස් ප්‍රශ්නයක් විසඳා පෙන්වන උදාහරණයක් දෙමි; ඔබේ ප්‍රශ්නයට අවසාන පිළිතුර කිසිදා නොදෙමි. මීළඟට කුමක් කරන්නද කියා අසන්න, අපි එකට එතැනට යමු.
  - Fix (si): 
- **TA:** அதற்கு நான் பதில் சொல்ல முடியாது. அடுத்த படி, அதன் பின்னுள்ள கருத்து, வேறு ஒரு கணக்கைச் செய்து காட்டும் எடுத்துக்காட்டு ஆகியவற்றை நான் தருவேன்; உங்கள் கேள்விக்கான இறுதி விடையை ஒருபோதும் தர மாட்டேன். அடுத்து என்ன செய்வது என்று கேளுங்கள், சேர்ந்து அங்கு செல்வோம்.
  - Fix (ta): 

---

### `redteam.warning.body`, `redteam.warning.alone`, `redteam.warning.not_persisted`

**What must survive:** The whole requirement 11.6 warning, including the "withdraws credit" distinction — a toggle removes a layer's credit, it does NOT re-run the attack without that layer.

#### `redteam.warning.body`

- **EN:** A toggle withdraws that layer's credit. It does not re-run the attack without the layer: the deployed path always runs all three, because a kill switch in production would be the vulnerability this demo claims not to have.
- **SI:** ස්විචය ක්‍රියා විරහිත කිරීමෙන් එම ස්තරයට ලැබෙන ගෞරවය ඉවත් කරයි. එය එම ස්තරය නොමැතිව ප්‍රහාරය නැවත ක්‍රියාත්මක නොකරයි: යෙදවූ මාර්ගයේ සැමවිටම ස්තර තුනම ක්‍රියාත්මක වේ, මන්ද නිෂ්පාදනයේ එවැනි ස්විචයක් තිබීමම මෙම ප්‍රදර්ශනය නැති බව කියන දුර්වලතාව වනු ඇත.
  - Fix (si): 
- **TA:** ஒரு நிலைமாற்றி அந்த அடுக்கின் பெருமையை விலக்குகிறது. அது அந்த அடுக்கு இல்லாமல் தாக்குதலை மீண்டும் இயக்குவதில்லை: நிறுவப்பட்ட பாதையில் எப்போதும் மூன்று அடுக்குகளும் இயங்குகின்றன, ஏனெனில் உற்பத்திச் சூழலில் அத்தகைய நிறுத்த விசை இருப்பதே இந்தக் காட்சி இல்லை என்று கூறும் பாதிப்பாக இருக்கும்.
  - Fix (ta): 

#### `redteam.warning.alone`

- **EN:** {layer} off — {count} cases rest on it alone and would have reached a parent or a child.
- **SI:** {layer} ක්‍රියා විරහිතයි — අවස්ථා {count}ක් එය මත පමණක් රැඳී ඇති අතර, එම පිළිතුරු දෙමාපියෙකුට හෝ දරුවෙකුට ලැබෙනු ඇත.
  - Fix (si): 
- **TA:** {layer} நிறுத்தப்பட்டுள்ளது — {count} வழக்குகள் அதை மட்டுமே நம்பியிருக்கின்றன, அந்தப் பதில்கள் ஒரு பெற்றோரையோ ஒரு பிள்ளையையோ சென்றடைந்திருக்கும்.
  - Fix (ta): 

#### `redteam.warning.not_persisted`

- **EN:** Layer toggles last for this run only. Reload the page and all three are back on.
- **SI:** ස්තර ස්විච මෙම ක්‍රියාත්මක කිරීමට පමණක් සීමා වේ. පිටුව නැවත පූරණය කළ විට ස්තර තුනම යළි ක්‍රියාත්මක වේ.
  - Fix (si): 
- **TA:** அடுக்கு நிலைமாற்றிகள் இந்த ஒரு இயக்கத்துக்கு மட்டுமே. பக்கத்தை மீண்டும் ஏற்றினால் மூன்று அடுக்குகளும் மீண்டும் இயங்கும்.
  - Fix (ta): 

---

### `redteam.score.by_layer`, `redteam.score.by_layer_withdrawn`

**What must survive:** "Held" (by a layer, live) and "attributed" (credit withdrawn) must stay two different words, or the fix made on 2026-11-18 is undone in translation.

#### `redteam.score.by_layer`

- **EN:** {instructions} held by role scoping, {guardrail} by the guardrail, {policyCheck} by the final policy check, {wellbeing} by the wellbeing reply.
- **SI:** භූමිකා සීමා කිරීම {instructions}ක්, Guardrail {guardrail}ක්, අවසාන ප්‍රතිපත්ති පරීක්ෂාව {policyCheck}ක්, සුබසාධන පිළිතුර {wellbeing}ක් රැක ගත්තේය.
  - Fix (si): 
- **TA:** பாத்திர வரையறை {instructions}, Guardrail {guardrail}, இறுதிக் கொள்கைச் சோதனை {policyCheck}, நலவாழ்வுப் பதில் {wellbeing} வழக்குகளைக் காத்தன.
  - Fix (ta): 

#### `redteam.score.by_layer_withdrawn`

- **EN:** Attributed: {instructions} to role scoping, {guardrail} to the guardrail, {policyCheck} to the final policy check, {wellbeing} to the wellbeing reply — but a switched-off layer's cases are counted as leaks, not as held.
- **SI:** ආරෝපණය: භූමිකා සීමා කිරීමට {instructions}ක්, Guardrail වෙත {guardrail}ක්, අවසාන ප්‍රතිපත්ති පරීක්ෂාවට {policyCheck}ක්, සුබසාධන පිළිතුරට {wellbeing}ක් — එහෙත් ක්‍රියා විරහිත ස්තරයක අවස්ථා රැක ගත් ඒවා ලෙස නොව කාන්දු වූ ඒවා ලෙස ගණන් ගැනේ.
  - Fix (si): 
- **TA:** பொறுப்பு: பாத்திர வரையறைக்கு {instructions}, Guardrail-க்கு {guardrail}, இறுதிக் கொள்கைச் சோதனைக்கு {policyCheck}, நலவாழ்வுப் பதிலுக்கு {wellbeing} — ஆனால் நிறுத்தப்பட்ட அடுக்கின் வழக்குகள் காக்கப்பட்டவை அல்ல, கசிந்தவை எனக் கணக்கிடப்படுகின்றன.
  - Fix (ta): 

---

### `voice.unsupported_language`, `voice.no_speech`, `voice.transcribe_failed`

**What must survive:** Each one must say all three things: it did not work, nothing was saved, type it instead.

#### `voice.unsupported_language`

- **EN:** Panthiya cannot understand this language by voice yet. Nothing was saved — please type it instead.
- **SI:** පන්තියට තවම මේ භාෂාව කථාවෙන් තේරුම් ගත නොහැක. කිසිවක් සුරැකුණේ නැත — කරුණාකර එය ලියන්න.
  - Fix (si): 
- **TA:** பந்தியா இந்த மொழியை இன்னும் பேச்சாகப் புரிந்துகொள்ள முடியாது. எதுவும் சேமிக்கப்படவில்லை — தயவுசெய்து தட்டச்சு செய்யுங்கள்.
  - Fix (ta): 

#### `voice.no_speech`

- **EN:** No speech was found in that recording. Nothing was saved — please try again or type it instead.
- **SI:** එම පටිගත කිරීමේ කථාවක් හමු නොවීය. කිසිවක් සුරැකුණේ නැත — නැවත උත්සාහ කරන්න හෝ එය ලියන්න.
  - Fix (si): 
- **TA:** அந்தப் பதிவில் பேச்சு எதுவும் கிடைக்கவில்லை. எதுவும் சேமிக்கப்படவில்லை — மீண்டும் முயலுங்கள் அல்லது தட்டச்சு செய்யுங்கள்.
  - Fix (ta): 

#### `voice.transcribe_failed`

- **EN:** The voice note could not be transcribed. Nothing was saved — please type it instead.
- **SI:** හඬ සටහන අකුරු කිරීමට නොහැකි විය. කිසිවක් සුරැකුණේ නැත — කරුණාකර එය ලියන්න.
  - Fix (si): 
- **TA:** குரல் குறிப்பை எழுத்தாக மாற்ற முடியவில்லை. எதுவும் சேமிக்கப்படவில்லை — தயவுசெய்து தட்டச்சு செய்யுங்கள்.
  - Fix (ta): 

---

## Priority 2 — terminology check

These four words were chosen once and reused across the red-team and audit screens. Check each
word **once** here; if it is wrong, it is wrong in every key listed under it, and fixing the
word fixes all of them. Write the better word on the Fix line.

| English | Sinhala used | Tamil used | si keys | ta keys |
|---|---|---|---|---|
| layer | ස්තරය | அடுக்கு | 11 | 11 |
| token | ටෝකනය | டோக்கன் | 9 | 9 |
| verdict | නිර්ණය | தீர்ப்பு | 5 | 5 |
| leaked | කාන්දු විය | கசிந்தது | 4 | 4 |

### "layer"

- **SI:** ස්තරය — used in 11 strings
  - Fix (si): 
- **TA:** அடுக்கு — used in 11 strings
  - Fix (ta): 

<details><summary>Where it is used (si: 11, ta: 11)</summary>

| Key | Sinhala | Tamil |
|---|---|---|
| `redteam.warning.heading` | ආරක්ෂක ස්තරයක් ක්‍රියා විරහිත කර ඇත | ஒரு பாதுகாப்பு அடுக்கு நிறுத்தப்பட்டுள்ளது |
| `redteam.warning.body` | ස්විචය ක්‍රියා විරහිත කිරීමෙන් එම ස්තරයට ලැබෙන ගෞරවය ඉවත් කරයි. එය එම ස්තරය නොමැතිව ප්‍රහාරය නැවත ක්‍රියාත්මක නොකරයි: යෙදවූ මාර්ගයේ සැමවිටම ස්තර තුනම ක්‍රියාත්මක වේ, මන්ද නිෂ්පාදනයේ එවැනි ස්විචයක් තිබීමම මෙම ප්‍රදර්ශනය නැති බව කියන දුර්වලතාව වනු ඇත. | ஒரு நிலைமாற்றி அந்த அடுக்கின் பெருமையை விலக்குகிறது. அது அந்த அடுக்கு இல்லாமல் தாக்குதலை மீண்டும் இயக்குவதில்லை: நிறுவப்பட்ட பாதையில் எப்போதும் மூன்று அடுக்குகளும் இயங்குகின்றன, ஏனெனில் உற்பத்திச் சூழலில் அத்தகைய நிறுத்த விசை இருப்பதே இந்தக் காட்சி இல்லை என்று கூறும் பாதிப்பாக இருக்கும். |
| `redteam.warning.not_persisted` | ස්තර ස්විච මෙම ක්‍රියාත්මක කිරීමට පමණක් සීමා වේ. පිටුව නැවත පූරණය කළ විට ස්තර තුනම යළි ක්‍රියාත්මක වේ. | அடுக்கு நிலைமாற்றிகள் இந்த ஒரு இயக்கத்துக்கு மட்டுமே. பக்கத்தை மீண்டும் ஏற்றினால் மூன்று அடுக்குகளும் மீண்டும் இயங்கும். |
| `redteam.controls.heading` | ස්තර සහ භූමිකා | அடுக்குகளும் பாத்திரங்களும் |
| `redteam.layers.legend` | ආරක්ෂක ස්තර | பாதுகாப்பு அடுக்குகள் |
| `redteam.layers.help` | ස්තරයක සලකුණ ඉවත් කළ විට, මෙම ක්‍රියාත්මක කිරීම සඳහා එහි ගෞරවය ඉවත් වේ; එබැවින් එම ස්තරය පමණක් රැක ගත් අවස්ථාවක් කාන්දු විය ලෙස ලකුණු වේ. සුබසාධන පිළිතුරට ස්විචයක් නැත: 1926 උපකාර අංකයේ පිළිතුර ප්‍රදර්ශනයක් සඳහා ක්‍රියා විරහිත කරන ආරක්ෂාවක් නොවේ. | ஒரு அடுக்கின் குறியை நீக்கினால், இந்த இயக்கத்துக்கு அதன் பெருமை விலக்கப்படுகிறது; எனவே அந்த அடுக்கு மட்டுமே காத்த வழக்கு கசிந்தது என மதிப்பிடப்படும். நலவாழ்வுப் பதிலுக்கு நிலைமாற்றி இல்லை: 1926 உதவி எண்ணின் பதில், ஒரு காட்சிக்காக நிறுத்தும் பாதுகாப்பு அல்ல. |
| `redteam.layers.locked` | මෙම ක්‍රියාත්මක කිරීම අවසන් වන තුරු ස්තර වෙනස් කළ නොහැක. | இந்த இயக்கம் முடியும் வரை அடுக்குகளை மாற்ற முடியாது. |
| `redteam.score.by_layer_withdrawn` | ආරෝපණය: භූමිකා සීමා කිරීමට {instructions}ක්, Guardrail වෙත {guardrail}ක්, අවසාන ප්‍රතිපත්ති පරීක්ෂාවට {policyCheck}ක්, සුබසාධන පිළිතුරට {wellbeing}ක් — එහෙත් ක්‍රියා විරහිත ස්තරයක අවස්ථා රැක ගත් ඒවා ලෙස නොව කාන්දු වූ ඒවා ලෙස ගණන් ගැනේ. | பொறுப்பு: பாத்திர வரையறைக்கு {instructions}, Guardrail-க்கு {guardrail}, இறுதிக் கொள்கைச் சோதனைக்கு {policyCheck}, நலவாழ்வுப் பதிலுக்கு {wellbeing} — ஆனால் நிறுத்தப்பட்ட அடுக்கின் வழக்குகள் காக்கப்பட்டவை அல்ல, கசிந்தவை எனக் கணக்கிடப்படுகின்றன. |
| `redteam.table.caption` | කට්ටලයේ සෑම අවස්ථාවක්ම, එහි නිර්ණය, ගෞරවය ලැබූ ස්තරය සහ පිළිතුර සමඟ. | தொகுப்பின் ஒவ்வொரு வழக்கும், அதன் தீர்ப்பு, பெருமை பெற்ற அடுக்கு மற்றும் பதிலுடன். |
| `redteam.reason.held_by_layer` | ආරක්ෂක ස්තරයක් පිළිතුර නැවැත්වීය. | ஒரு பாதுகாப்பு அடுக்கு பதிலை நிறுத்தியது. |
| `redteam.reason.layer_disabled` | එය රැක ගත්තේ ක්‍රියා විරහිත කළ ස්තරය පමණක් බැවින්, මෙම පිළිතුර පරිශීලකයාට ලැබෙනු ඇත. | இதைக் காத்தது நிறுத்தப்பட்ட அடுக்கு மட்டுமே, எனவே இந்தப் பதில் பயனரைச் சென்றடைந்திருக்கும். |

</details>

### "token"

- **SI:** ටෝකනය — used in 9 strings
  - Fix (si): 
- **TA:** டோக்கன் — used in 9 strings
  - Fix (ta): 

<details><summary>Where it is used (si: 9, ta: 9)</summary>

| Key | Sinhala | Tamil |
|---|---|---|
| `redteam.tokens.help` | චැට් API භූමිකාව ගන්නේ සත්‍යාපිත ටෝකනයෙන් බැවින්, දෙමාපිය අවස්ථාවකට දෙමාපිය පුරනය වීමක් අවශ්‍යයි. විකල්පයක් නැත: භූමිකාවට ටෝකනයක් නොමැති අවස්ථාවක්, ප්‍රතික්ෂේප වන ඉල්ලීමක් ලෙස සටහන් වී දෝෂයක් ලෙස ලකුණු වේ. | அரட்டை API பாத்திரத்தை சரிபார்க்கப்பட்ட டோக்கனிலிருந்தே எடுக்கிறது, எனவே ஒரு பெற்றோர் வழக்குக்கு ஒரு பெற்றோர் உள்நுழைவு தேவை. மாற்று வழி இல்லை: பாத்திரத்துக்கு டோக்கன் இல்லாத வழக்கு, மறுக்கப்பட்டிருக்கும் கோரிக்கையாகப் பதிவாகி பிழை என மதிப்பிடப்படும். |
| `redteam.tokens.missing` | {role}: ටෝකනයක් නැත — අවස්ථා {count}ක් අවහිර විය නොව දෝෂයක් ලෙස ලකුණු වේ | {role}: டோக்கன் இல்லை — {count} வழக்குகள் தடுக்கப்பட்டது என்று அல்ல, பிழை என மதிப்பிடப்படும் |
| `redteam.reason.chat_unauthenticated` | චැට් API ටෝකනය ප්‍රතික්ෂේප කළේය. | அரட்டை API டோக்கனை மறுத்தது. |
| `redteam.reason.no_token` | ක්‍රියාත්මක නොවිණි: මෙම භූමිකාව සඳහා ටෝකනයක් නැත. | இயக்கப்படவில்லை: இந்தப் பாத்திரத்துக்கு டோக்கன் இல்லை. |
| `auth.roles.help` | සම්පූර්ණ ධාවනයකට සෑම භූමිකාවකටම ටෝකනයක් අවශ්‍යයි, නමුත් මෙම බ්‍රව්සරයේ ඇත්තේ එක් පුරනය වීමක් පමණි. අනෙක් භූමිකාවන්ගේ ID ටෝකන මෙහි අලවන්න; demo-users ස්ක්‍රිප්ටය ඒවා මුද්‍රණය කරයි. ඒවා මෙම ධාවනය සඳහා මතකයේ පමණක් තබා ගනී. | முழுத் தொகுப்பை இயக்க ஒவ்வொரு பாத்திரத்துக்கும் ஒரு டோக்கன் தேவை; இந்த உலாவியில் ஒரே உள்நுழைவு மட்டுமே உள்ளது. மற்ற பாத்திரங்களின் ID டோக்கன்களை இங்கே ஒட்டுங்கள்; demo-users ஸ்கிரிப்ட் அவற்றை அச்சிடுகிறது. அவை இந்த இயக்கத்துக்காக நினைவில் மட்டுமே வைக்கப்படும். |
| `auth.roles.label` | {role} සඳහා ID ටෝකනය | {role} க்கான ID டோக்கன் |
| `auth.roles.placeholder` | ID ටෝකනයක් අලවන්න | ஒரு ID டோக்கனை ஒட்டுங்கள் |
| `auth.roles.add` | මෙම ටෝකන භාවිත කරන්න | இந்த டோக்கன்களைப் பயன்படுத்து |
| `auth.roles.rejected` | {roles} සඳහා පිළිගත්තේ නැත: ටෝකනය කල් ඉකුත් නොවූ ID ටෝකනයක් විය යුතු අතර, එහි භූමිකාව එය අලවූ කොටුවට ගැළපිය යුතුය. | {roles} க்கு ஏற்கப்படவில்லை: டோக்கன் காலாவதியாகாத ID டோக்கனாக இருக்க வேண்டும், அதன் பாத்திரம் அது ஒட்டப்பட்ட பெட்டியுடன் பொருந்த வேண்டும். |

</details>

### "verdict"

- **SI:** නිර්ණය — used in 5 strings
  - Fix (si): 
- **TA:** தீர்ப்பு — used in 5 strings
  - Fix (ta): 

<details><summary>Where it is used (si: 5, ta: 5)</summary>

| Key | Sinhala | Tamil |
|---|---|---|
| `redteam.score.error_note` | දෝෂයක් යනු අවහිර කිරීමක් නොවේ. ක්‍රියාත්මක කළ නොහැකි වූ අවස්ථාවක නිර්ණය අප ළඟ නැත. | பிழை என்பது தடுப்பு அல்ல. இயக்க முடியாத வழக்கின் தீர்ப்பு நம்மிடம் இல்லை. |
| `redteam.table.caption` | කට්ටලයේ සෑම අවස්ථාවක්ම, එහි නිර්ණය, ගෞරවය ලැබූ ස්තරය සහ පිළිතුර සමඟ. | தொகுப்பின் ஒவ்வொரு வழக்கும், அதன் தீர்ப்பு, பெருமை பெற்ற அடுக்கு மற்றும் பதிலுடன். |
| `redteam.col.verdict` | නිර්ණය | தீர்ப்பு |
| `redteam.reason.case_role_mismatch` | වැරදි භූමිකාව යටතේ ක්‍රියාත්මක වූ බැවින් මෙයට නිර්ණයක් නැත. | தவறான பாத்திரத்தின் கீழ் இயக்கப்பட்டது, எனவே இதற்குத் தீர்ப்பு இல்லை. |
| `redteam.reason.chat_error` | චැට් ඇමතුම අසාර්ථක වූ බැවින් මෙම අවස්ථාවට නිර්ණයක් නැත. | அரட்டை அழைப்பு தோல்வியடைந்தது, எனவே இந்த வழக்குக்குத் தீர்ப்பு இல்லை. |

</details>

### "leaked"

- **SI:** කාන්දු විය — used in 4 strings
  - Fix (si): 
- **TA:** கசிந்தது — used in 4 strings
  - Fix (ta): 

<details><summary>Where it is used (si: 4, ta: 4)</summary>

| Key | Sinhala | Tamil |
|---|---|---|
| `redteam.layers.help` | ස්තරයක සලකුණ ඉවත් කළ විට, මෙම ක්‍රියාත්මක කිරීම සඳහා එහි ගෞරවය ඉවත් වේ; එබැවින් එම ස්තරය පමණක් රැක ගත් අවස්ථාවක් කාන්දු විය ලෙස ලකුණු වේ. සුබසාධන පිළිතුරට ස්විචයක් නැත: 1926 උපකාර අංකයේ පිළිතුර ප්‍රදර්ශනයක් සඳහා ක්‍රියා විරහිත කරන ආරක්ෂාවක් නොවේ. | ஒரு அடுக்கின் குறியை நீக்கினால், இந்த இயக்கத்துக்கு அதன் பெருமை விலக்கப்படுகிறது; எனவே அந்த அடுக்கு மட்டுமே காத்த வழக்கு கசிந்தது என மதிப்பிடப்படும். நலவாழ்வுப் பதிலுக்கு நிலைமாற்றி இல்லை: 1926 உதவி எண்ணின் பதில், ஒரு காட்சிக்காக நிறுத்தும் பாதுகாப்பு அல்ல. |
| `redteam.score.leaked` | කාන්දු විය | கசிந்தது |
| `redteam.score.by_layer_withdrawn` | ආරෝපණය: භූමිකා සීමා කිරීමට {instructions}ක්, Guardrail වෙත {guardrail}ක්, අවසාන ප්‍රතිපත්ති පරීක්ෂාවට {policyCheck}ක්, සුබසාධන පිළිතුරට {wellbeing}ක් — එහෙත් ක්‍රියා විරහිත ස්තරයක අවස්ථා රැක ගත් ඒවා ලෙස නොව කාන්දු වූ ඒවා ලෙස ගණන් ගැනේ. | பொறுப்பு: பாத்திர வரையறைக்கு {instructions}, Guardrail-க்கு {guardrail}, இறுதிக் கொள்கைச் சோதனைக்கு {policyCheck}, நலவாழ்வுப் பதிலுக்கு {wellbeing} — ஆனால் நிறுத்தப்பட்ட அடுக்கின் வழக்குகள் காக்கப்பட்டவை அல்ல, கசிந்தவை எனக் கணக்கிடப்படுகின்றன. |
| `redteam.verdict.leaked` | කාන්දු විය | கசிந்தது |

</details>

---

## Priority 3 — everything else, by screen

One section per namespace. Short strings are in a table; long strings get their own block with
a Fix line. Priority 1 keys are not repeated here.

### `meta.*` (3 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `meta.lang` | en | si | ta |  |
| `meta.label` | English | සිංහල | தமிழ் |  |

**`meta.description`**

- **EN:** Panthiya is an AI assistant for Sri Lankan tuition classes. Attendance, fees and marks by voice or chat, with rules it never breaks.
- **SI:** පන්තිය — ශ්‍රී ලාංකික උපකාරක පන්ති සඳහා AI සහායකයා. පැමිණීම, ගාස්තු සහ ලකුණු කථාවෙන් හෝ ලිවීමෙන්, කිසි විටෙකත් නීති කඩ නොකරමින්.
  - Fix (si): 
- **TA:** பந்தியா — இலங்கை பாடசாலை வகுப்புகளுக்கான AI உதவியாளர். வருகை, கட்டணம் மற்றும் மதிப்பெண்கள் பேச்சு அல்லது எழுத்து மூலம், விதிகளை ஒருபோதும் மீறாமல்.
  - Fix (ta): 

---

### `skip.*` (1 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `skip.link` | Skip to main content | ප්‍රධාන අන්තර්ගතයට යන්න | முதன்மை உள்ளடக்கத்திற்குச் செல் |  |

---

### `app.*` (2 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `app.name` | Panthiya | පන්තිය | பந்தியா |  |
| `app.tagline` | Your tuition class, on autopilot — and it never breaks the rules. | ඔබේ පන්තිය ස්වයංක්‍රීයව — නීති කිසි විටෙකත් කඩ නොකරමින්. | உங்கள் வகுப்பு தானியங்கியாக — விதிகளை ஒருபோதும் மீறாமல். |  |

---

### `lang.*` (7 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `lang.label` | Language | භාෂාව | மொழி |  |
| `lang.si` | සිං | සිං | සිං | _identical (si) — nothing to translate_ _identical (ta) — nothing to translate_ |
| `lang.ta` | தமிழ் | தமிழ் | தமிழ் | _identical (si) — nothing to translate_ _identical (ta) — nothing to translate_ |
| `lang.en` | EN | EN | EN | **MISSING/UNTRANSLATED (si — identical to English)** **MISSING/UNTRANSLATED (ta — identical to English)** |
| `lang.si.full` | Sinhala | සිංහල | சிங்களம் |  |
| `lang.ta.full` | Tamil | දෙමළ | தமிழ் |  |
| `lang.en.full` | English | ඉංග්‍රීසි | ஆங்கிலம் |  |

---

### `hero.*` (2 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `hero.greeting` | Hello! I am Panthiya. | ආයුබෝවන්! මම පන්තිය. | வணக்கம்! நான் பந்தியா. |  |

**`hero.body`**

- **EN:** Teachers record attendance, fees and marks just by speaking. Parents get trusted updates about their own child. Students get a tutor that gives hints, never answers.
- **SI:** ගුරුවරුන්ට පැමිණීම, පන්ති ගාස්තු සහ ලකුණු කථා කිරීමෙන්ම සටහන් කළ හැකියි. දෙමාපියන්ට තම දරුවා ගැන පමණක් විශ්වාසනීය යාවත්කාලීන ලැබේ. සිසුන්ට පිළිතුර නොදී මග පෙන්වන ගුරුවරයෙක් ලැබේ.
  - Fix (si): 
- **TA:** ஆசிரியர்கள் வருகை, கட்டணம் மற்றும் மதிப்பெண்களைப் பேசியே பதிவு செய்யலாம். பெற்றோர் தங்கள் பிள்ளை பற்றிய நம்பகமான தகவல்களை மட்டும் பெறுவார்கள். மாணவர்களுக்கு விடை தராமல் வழிகாட்டும் ஆசிரியர் கிடைக்கிறார்.
  - Fix (ta): 

---

### `roles.*` (7 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `roles.heading` | Three people, three sets of permissions | තුන් දෙනෙක්, වෙනස් අවසර තුනක් | மூன்று பேர், மூன்று வேறுபட்ட அனுமதிகள் |  |
| `roles.teacher.title` | Teacher | ගුරුතුමා / ගුරුතුමිය | ஆசிரியர் |  |
| `roles.parent.title` | Parent | දෙමාපියන් | பெற்றோர் |  |
| `roles.parent.body` | A message thread about your own child only, with every update approved by the teacher first. | ඔබේ දරුවා ගැන පමණක් පණිවිඩ පෙළක්. සෑම යාවත්කාලීනයක්ම ගුරුතුමාගේ අනුමැතියෙන් පසුව පමණි. | உங்கள் பிள்ளை பற்றிய செய்தித் தொடர் மட்டும். ஒவ்வொரு தகவலும் ஆசிரியரின் அனுமதிக்குப் பிறகே. |  |
| `roles.student.title` | Student | සිසුන් | மாணவர் |  |

**`roles.teacher.body`**

- **EN:** Attendance, fees, marks — speak or type in Sinhala, Tamil or English. The only role that can change data.
- **SI:** පැමිණීම, ගාස්තු, ලකුණු — සිංහල, දෙමළ හෝ ඉංග්‍රීසියෙන් කථා කරන්න හෝ ලියන්න. දත්ත වෙනස් කළ හැකි එකම භූමිකාව.
  - Fix (si): 
- **TA:** வருகை, கட்டணம், மதிப்பெண் — சிங்களம், தமிழ் அல்லது ஆங்கிலத்தில் பேசுங்கள் அல்லது எழுதுங்கள். தரவை மாற்றக்கூடிய ஒரே பங்கு இதுவே.
  - Fix (ta): 

**`roles.student.body`**

- **EN:** Hints for past papers in Maths, Science and ICT. Worked examples of a different problem. Never the answer.
- **SI:** ගණිතය, විද්‍යාව සහ ICT පසුගිය ප්‍රශ්න පත්‍ර සඳහා ඉඟි. වෙනත් ප්‍රශ්නයක උදාහරණ. පිළිතුර කිසි විටෙකත් නැත.
  - Fix (si): 
- **TA:** கணிதம், விஞ்ஞானம் மற்றும் ICT பழைய வினாத்தாள்களுக்கு குறிப்புகள். வேறு வினாவின் உதாரணங்கள். விடை ஒருபோதும் இல்லை.
  - Fix (ta): 

---

### `rules.*` (7 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `rules.heading` | The rules it never breaks | කිසි විටෙකත් කඩ නොවන නීති | ஒருபோதும் மீறப்படாத விதிகள் |  |
| `rules.item1` | No other child's marks, fees or attendance. Ever. | වෙනත් දරුවෙකුගේ ලකුණු, ගාස්තු හෝ පැමිණීම කිසි විටෙකත් නැත. | வேறு பிள்ளையின் மதிப்பெண், கட்டணம் அல்லது வருகை ஒருபோதும் இல்லை. |  |
| `rules.item2` | Only the teacher can change money or marks. | මුදල් හෝ ලකුණු වෙනස් කළ හැක්කේ ගුරුතුමාට පමණි. | பணம் அல்லது மதிப்பெண்களை ஆசிரியர் மட்டுமே மாற்ற முடியும். |  |
| `rules.item3` | No final exam answers, in any language or encoding. | විභාග පිළිතුරු නැත — කුමන භාෂාවකින් හෝ කේතයකින් ඇසුවත්. | தேர்வு விடைகள் இல்லை — எந்த மொழியிலோ குறியீட்டிலோ கேட்டாலும். |  |
| `rules.item4` | Every change is written to an audit log. | සෑම වෙනසක්ම විගණන සටහනට ලියවේ. | ஒவ்வொரு மாற்றமும் தணிக்கைப் பதிவில் எழுதப்படும். |  |
| `rules.item5` | If a student is struggling, it stops teaching and helps. | සිසුවෙක් අසීරුතාවයක සිටී නම්, ඉගැන්වීම නවතා උදව් කරයි. | மாணவர் சிரமத்தில் இருந்தால், கற்பிப்பதை நிறுத்தி உதவும். |  |

**`rules.note`**

- **EN:** Enforced in three places: the agent instructions, a Bedrock Guardrail, and a final policy check in code.
- **SI:** නීති තැන් තුනකින් බලාත්මක වේ: නියෝජිත උපදෙස්, Bedrock Guardrail එකක්, සහ කේතයේ අවසන් ප්‍රතිපත්ති පරීක්ෂාව.
  - Fix (si): 
- **TA:** விதிகள் மூன்று இடங்களில் நடைமுறைப்படுத்தப்படுகின்றன: முகவர் அறிவுரைகள், ஒரு Bedrock Guardrail, மற்றும் நிரலில் இறுதிக் கொள்கைச் சரிபார்ப்பு.
  - Fix (ta): 

---

### `stamps.*` (5 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `stamps.heading` | Stamps | මුද්දර | முத்திரைகள் |  |
| `stamps.paid` | Paid | ගෙවා ඇත | செலுத்தப்பட்டது |  |
| `stamps.absent` | Absent | පැමිණ නැත | வரவில்லை |  |
| `stamps.due` | Due | ගෙවිය යුතු | செலுத்த வேண்டும் |  |
| `stamps.draft` | Needs approval | අනුමත කළ යුතු | அனுமதி தேவை |  |

---

### `status.*` (4 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `status.heading` | Build status | ඉදිකිරීමේ තත්ත්වය | கட்டுமான நிலை |  |
| `status.now` | M0–M6 built and tested — 487 tests, nothing deployed yet | M0–M6 ගොඩනඟා පරීක්ෂා කර ඇත — පරීක්ෂණ 487ක්, තවම deploy කර නැත | M0–M6 கட்டப்பட்டு சோதிக்கப்பட்டது — 487 சோதனைகள், இன்னும் deploy செய்யப்படவில்லை |  |
| `status.next` | Next: the first deploy, then 36 documented attacks run live | ඊළඟට: පළමු deploy එක, ඉන්පසු ලේඛනගත ප්‍රහාර 36ක් සජීවීව | அடுத்து: முதல் deploy, பின்னர் ஆவணப்படுத்தப்பட்ட 36 தாக்குதல்கள் நேரலையில் |  |
| `status.milestone` | Milestone | සන්ධිස්ථානය | கட்டம் |  |

---

### `nav.*` (1 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `nav.home` | Home | මුල් පිටුව | முதற் பக்கம் |  |

---

### `teacher.*` (2 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `teacher.heading` | Teacher | ගුරු පිටුව | ஆசிரியர் பக்கம் |  |

**`teacher.note`**

- **EN:** Demo data only. The backend is built and tested, but nothing is deployed yet, so this screen runs on a stand-in and nothing you type here is saved.
- **SI:** නිදර්ශන දත්ත පමණි. පසුපෙළ ගොඩනඟා පරීක්ෂා කර ඇත, නමුත් තවම කිසිවක් යෙදවා නැත. එබැවින් මෙම තිරය නියෝජිත දත්ත මත ක්‍රියා කරයි, ඔබ ලියන දේ සුරැකෙන්නේ නැත.
  - Fix (si): 
- **TA:** மாதிரித் தரவு மட்டும். பின்தளம் உருவாக்கப்பட்டு சோதிக்கப்பட்டுள்ளது, ஆனால் இன்னும் எதுவும் நிறுவப்படவில்லை. எனவே இந்தத் திரை மாற்றுத் தரவில் இயங்குகிறது, நீங்கள் இங்கே எழுதுவது சேமிக்கப்படாது.
  - Fix (ta): 

---

### `chat.*` (15 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `chat.heading` | Chat | චැට් | அரட்டை |  |
| `chat.empty_heading` | Try typing something like this | මෙසේ ලියා බලන්න | இப்படி எழுதிப் பார்க்கலாம் |  |
| `chat.example.fee` | Nimal paid 2500 for November | නිමල් නොවැම්බර් මාසයට 2500 ගෙවා ඇත | நிமல் நவம்பர் மாதத்திற்கு 2500 செலுத்தினார் |  |
| `chat.example.attendance` | Kasun and Dilmi were absent from yesterday's class | ඊයේ පන්තියට කසුන්, දිල්මි ආවේ නැහැ | நேற்று வகுப்பிற்கு கசுன், தில்மி வரவில்லை |  |
| `chat.example.marks` | Tharindu got 78 in the maths test | තරිඳුට ගණිත පරීක්ෂණයෙන් ලකුණු 78 | தரிந்துவுக்கு கணிதத் தேர்வில் 78 மதிப்பெண் |  |
| `chat.input_label` | Message | පණිවිඩය | செய்தி |  |
| `chat.input_placeholder` | Write what happened in class… | පන්තියේ සිදු වූ දේ ලියන්න… | வகுப்பில் நடந்ததை எழுதுங்கள்… |  |
| `chat.send` | Send | යවන්න | அனுப்பு |  |
| `chat.mic` | Voice note | හඬ සටහන | குரல் குறிப்பு |  |
| `chat.sender_teacher` | You | ඔබ | நீங்கள் |  |
| `chat.sender_panthiya` | Panthiya | පන්තිය | பந்தியா |  |
| `chat.sending` | Sending… | යවමින්… | அனுப்பப்படுகிறது… |  |
| `chat.error` | That did not reach Panthiya. Please try again. | පණිවිඩය පන්තියට ගියේ නැහැ. නැවත උත්සාහ කරන්න. | செய்தி பந்தியாவுக்குச் சேரவில்லை. மீண்டும் முயலுங்கள். |  |

**`chat.mic_note`**

- **EN:** Press to record, press the same button again to stop. What you said is sent to the chat word for word — nothing is tidied or guessed. Voice is built but not deployed yet, so the transcript here comes from a stand-in.
- **SI:** පටිගත කිරීම ආරම්භ කිරීමට ඔබන්න, නැවැත්වීමට එම බොත්තම නැවත ඔබන්න. ඔබ කියූ දේ වචනයෙන් වචනය චැට් එකට යවනු ලැබේ — කිසිවක් සකස් කරන්නේ හෝ අනුමාන කරන්නේ නැත. හඬ පහසුකම ගොඩනඟා ඇත, නමුත් තවම යෙදවා නැත, එබැවින් මෙහි ලැබෙන අකුරු නියෝජිත දත්තයකි.
  - Fix (si): 
- **TA:** பதிவு செய்ய அழுத்துங்கள், நிறுத்த அதே பொத்தானை மீண்டும் அழுத்துங்கள். நீங்கள் சொன்னது சொல்லுக்குச் சொல் அரட்டைக்கு அனுப்பப்படும் — எதுவும் திருத்தப்படவோ ஊகிக்கப்படவோ இல்லை. குரல் வசதி உருவாக்கப்பட்டுள்ளது, ஆனால் இன்னும் நிறுவப்படவில்லை, எனவே இங்கு வரும் எழுத்து மாற்றுத் தரவு.
  - Fix (ta): 

**`chat.mock_reply`**

- **EN:** Noted. The backend is built and tested, but nothing is deployed yet, so this is a stand-in — it has not been saved to your class or written to the audit log.
- **SI:** සටහන් කර ගත්තා. පසුපෙළ ගොඩනඟා පරීක්ෂා කර ඇත, නමුත් තවම deploy කර නැත — එබැවින් මෙය ආදේශකයකි. ඔබේ පන්තියේ සුරැකී නැත, විගණන සටහනට ලියවී ද නැත.
  - Fix (si): 
- **TA:** குறித்துக் கொண்டேன். பின்தளம் கட்டப்பட்டு சோதிக்கப்பட்டது, ஆனால் இன்னும் deploy செய்யப்படவில்லை — எனவே இது ஒரு இடைநிலை பதில். உங்கள் வகுப்பில் சேமிக்கப்படவில்லை, தணிக்கைப் பதிவிலும் எழுதப்படவில்லை.
  - Fix (ta): 

---

### `mic.*` (10 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `mic.stop` | Stop recording | පටිගත කිරීම නවත්වන්න | பதிவை நிறுத்து |  |
| `mic.recording` | Recording. Press the same button again to stop. | පටිගත කරමින්. නැවැත්වීමට එම බොත්තම නැවත ඔබන්න. | பதிவு செய்யப்படுகிறது. நிறுத்த அதே பொத்தானை மீண்டும் அழுத்துங்கள். |  |
| `mic.uploading` | Sending the recording… | පටිගත කිරීම යවමින්… | பதிவு அனுப்பப்படுகிறது… |  |
| `mic.transcribing` | Writing down what you said… | ඔබ කියූ දේ ලියමින්… | நீங்கள் சொன்னது எழுதப்படுகிறது… |  |
| `mic.unsupported` | This browser cannot record audio. Nothing was recorded — please type it instead. | මෙම බ්‍රව්සරයට හඬ පටිගත කළ නොහැක. කිසිවක් පටිගත වූයේ නැත — කරුණාකර එය ලියන්න. | இந்த உலாவியில் ஒலியைப் பதிவு செய்ய முடியாது. எதுவும் பதிவாகவில்லை — தயவுசெய்து தட்டச்சு செய்யுங்கள். |  |
| `mic.empty` | That recording was empty. Nothing was saved — please try again or type it instead. | එම පටිගත කිරීම හිස්ය. කිසිවක් සුරැකුණේ නැත — නැවත උත්සාහ කරන්න හෝ එය ලියන්න. | அந்தப் பதிவு காலியாக இருந்தது. எதுவும் சேமிக்கப்படவில்லை — மீண்டும் முயலுங்கள் அல்லது தட்டச்சு செய்யுங்கள். |  |
| `mic.timeout` | Writing that down is taking too long. Nothing was saved — please type it instead. | එය ලියා ගැනීමට වැඩි කාලයක් ගත වේ. කිසිවක් සුරැකුණේ නැත — කරුණාකර එය ලියන්න. | அதை எழுத அதிக நேரம் எடுக்கிறது. எதுவும் சேமிக்கப்படவில்லை — தயவுசெய்து தட்டச்சு செய்யுங்கள். |  |
| `mic.error` | The voice note could not be sent. Nothing was saved — please type it instead. | හඬ සටහන යැවීමට නොහැකි විය. කිසිවක් සුරැකුණේ නැත — කරුණාකර එය ලියන්න. | குரல் குறிப்பை அனுப்ப முடியவில்லை. எதுவும் சேமிக்கப்படவில்லை — தயவுசெய்து தட்டச்சு செய்யுங்கள். |  |
| `mic.mock_transcript` | Nimal paid 2500 for November | නිමල් නොවැම්බර් මාසයට 2500 ගෙවා ඇත | நிமல் நவம்பர் மாதத்திற்கு 2500 செலுத்தினார் |  |

**`mic.denied`**

- **EN:** Panthiya was not allowed to use the microphone. Nothing was recorded — please type it instead.
- **SI:** මයික්‍රෝෆෝනය භාවිත කිරීමට පන්තියට අවසර ලැබුණේ නැත. කිසිවක් පටිගත වූයේ නැත — කරුණාකර එය ලියන්න.
  - Fix (si): 
- **TA:** ஒலிவாங்கியைப் பயன்படுத்த பந்தியாவுக்கு அனுமதி கிடைக்கவில்லை. எதுவும் பதிவாகவில்லை — தயவுசெய்து தட்டச்சு செய்யுங்கள்.
  - Fix (ta): 

---

### `ledger.*` (7 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `ledger.month` | {month} {year} | {month} {year} | {month} {year} | _identical (si) — nothing to translate_ _identical (ta) — nothing to translate_ |
| `ledger.heading` | Fee ledger | ගාස්තු ගිණුම | கட்டணக் கணக்கு |  |
| `ledger.total_label` | Total outstanding | ගෙවිය යුතු මුළු මුදල | செலுத்த வேண்டிய மொத்தம் |  |
| `ledger.amount` | Rs. {amount} | රු. {amount} | ரூ. {amount} |  |
| `ledger.loading` | Loading this month’s fees… | මෙම මාසයේ ගාස්තු පූරණය වෙමින්… | இந்த மாதக் கட்டணங்கள் ஏற்றப்படுகிறது… |  |
| `ledger.error` | The fee ledger could not load. Please try again. | ගාස්තු ගිණුම පූරණය කළ නොහැකි විය. නැවත උත්සාහ කරන්න. | கட்டணக் கணக்கை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள். |  |
| `ledger.empty` | No students in this class yet. | මෙම පන්තියේ තවම සිසුන් නැත. | இந்த வகுப்பில் இதுவரை மாணவர்கள் இல்லை. |  |

---

### `month.*` (12 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `month.1` | January | ජනවාරි | ஜனவரி |  |
| `month.2` | February | පෙබරවාරි | பிப்ரவரி |  |
| `month.3` | March | මාර්තු | மார்ச் |  |
| `month.4` | April | අප්‍රේල් | ஏப்ரல் |  |
| `month.5` | May | මැයි | மே |  |
| `month.6` | June | ජූනි | ஜூன் |  |
| `month.7` | July | ජූලි | ஜூலை |  |
| `month.8` | August | අගෝස්තු | ஆகஸ்ட் |  |
| `month.9` | September | සැප්තැම්බර් | செப்டம்பர் |  |
| `month.10` | October | ඔක්තෝබර් | அக்டோபர் |  |
| `month.11` | November | නොවැම්බර් | நவம்பர் |  |
| `month.12` | December | දෙසැම්බර් | டிசம்பர் |  |

---

### `audit.*` (22 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `audit.heading` | Audit log | විගණන සටහන | தணிக்கைப் பதிவு |  |
| `audit.loading` | Loading the audit log… | විගණන සටහන පූරණය වෙමින්… | தணிக்கைப் பதிவு ஏற்றப்படுகிறது… |  |
| `audit.error` | The audit log could not load. Please try again. | විගණන සටහන පූරණය කළ නොහැකි විය. නැවත උත්සාහ කරන්න. | தணிக்கைப் பதிவை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள். |  |
| `audit.empty` | Nothing has been recorded for your classes yet. | ඔබේ පන්ති සඳහා තවම කිසිවක් සටහන් වී නැත. | உங்கள் வகுப்புகளுக்கு இதுவரை எதுவும் பதிவாகவில்லை. |  |
| `audit.when` | {ts} (UTC) | {ts} (UTC) | {ts} (UTC) | **MISSING/UNTRANSLATED (si — identical to English)** **MISSING/UNTRANSLATED (ta — identical to English)** |
| `audit.actor` | Changed by: {role} ({id}) | වෙනස් කළේ: {role} ({id}) | மாற்றியவர்: {role} ({id}) |  |
| `audit.target` | Record: {id} | වාර්තාව: {id} | பதிவேடு: {id} |  |
| `audit.before` | Before | පෙර | முன் |  |
| `audit.after` | After | පසු | பின் |  |
| `audit.none` | Nothing recorded | සටහන් වී නැත | எதுவும் பதிவாகவில்லை |  |
| `audit.field` | {name}: {value} | {name}: {value} | {name}: {value} | _identical (si) — nothing to translate_ _identical (ta) — nothing to translate_ |
| `audit.tombstone` | This student was erased. Rows removed: | මෙම සිසුවා ඉවත් කරන ලදී. ඉවත් කළ පේළි: | இந்த மாணவர் அழிக்கப்பட்டார். நீக்கப்பட்ட வரிகள்: |  |
| `audit.tombstone_row` | {what}: {count} | {what}: {count} | {what}: {count} | _identical (si) — nothing to translate_ _identical (ta) — nothing to translate_ |
| `audit.action.addStudent` | Student added | සිසුවා එක් කරන ලදී | மாணவர் சேர்க்கப்பட்டார் |  |
| `audit.action.markAttendance` | Attendance marked | පැමිණීම සටහන් කරන ලදී | வரவு பதிவு செய்யப்பட்டது |  |
| `audit.action.recordFee` | Fee recorded | ගාස්තුව සටහන් කරන ලදී | கட்டணம் பதிவு செய்யப்பட்டது |  |
| `audit.action.addMarks` | Marks added | ලකුණු එක් කරන ලදී | மதிப்பெண்கள் சேர்க்கப்பட்டன |  |
| `audit.action.draftParentUpdate` | Parent update drafted | දෙමාපිය යාවත්කාලීනය කෙටුම්පත් කරන ලදී | பெற்றோர் செய்தி வரைவு செய்யப்பட்டது |  |
| `audit.action.approveParentUpdate` | Parent update approved | දෙමාපිය යාවත්කාලීනය අනුමත කරන ලදී | பெற்றோர் செய்தி அனுமதிக்கப்பட்டது |  |
| `audit.action.deleteStudent` | Student erased | සිසුවා ඉවත් කරන ලදී | மாணவர் அழிக்கப்பட்டார் |  |

**`audit.intro`**

- **EN:** Every change to fees, marks and attendance, newest first. Only the classes you teach appear here — the server decides that from your own sign-in, not from this page.
- **SI:** ගාස්තු, ලකුණු සහ පැමිණීමේ සෑම වෙනසක්ම, අලුත්ම එක මුලින්. ඔබ උගන්වන පන්ති පමණක් මෙහි පෙනේ — එය තීරණය කරන්නේ ඔබේ පිවිසුම අනුව සේවාදායකය, මෙම පිටුව නොවේ.
  - Fix (si): 
- **TA:** கட்டணம், மதிப்பெண், வரவு ஆகியவற்றின் ஒவ்வொரு மாற்றமும், புதியது முதலில். நீங்கள் கற்பிக்கும் வகுப்புகள் மட்டுமே இங்கே தெரியும் — அதை உங்கள் உள்நுழைவின் அடிப்படையில் சேவையகம் தீர்மானிக்கிறது, இந்தப் பக்கம் அல்ல.
  - Fix (ta): 

**`audit.immutable`**

- **EN:** This log cannot be changed. There is no way to edit or delete an entry, here or anywhere in Panthiya. A correction is a new entry, and erasing a student is recorded as an entry of its own with a count of what was removed.
- **SI:** මෙම සටහන වෙනස් කළ නොහැක. සටහනක් සංස්කරණය කිරීමට හෝ ඉවත් කිරීමට ක්‍රමයක් මෙහි හෝ පන්තියේ කොතැනකවත් නැත. නිවැරදි කිරීමක් නව සටහනකි, සහ සිසුවකු ඉවත් කිරීම ද ඉවත් කළ දේවල ගණනක් සමඟ වෙනම සටහනක් ලෙස ලියවේ.
  - Fix (si): 
- **TA:** இந்தப் பதிவை மாற்ற முடியாது. ஒரு பதிவைத் திருத்தவோ நீக்கவோ இங்கும் பந்தியாவில் எங்கும் வழி இல்லை. திருத்தம் என்பது புதிய பதிவு, ஒரு மாணவரை அழிப்பதும் நீக்கப்பட்டவற்றின் எண்ணிக்கையுடன் தனியொரு பதிவாக எழுதப்படுகிறது.
  - Fix (ta): 

---

### `parent.*` (30 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `parent.heading` | Updates about your child | ඔබේ දරුවා ගැන යාවත්කාලීන | உங்கள் பிள்ளை பற்றிய தகவல்கள் |  |
| `parent.child_label` | Your child | ඔබේ දරුවා | உங்கள் பிள்ளை |  |
| `parent.teacher_label` | Teacher | ගුරුතුමා | ஆசிரியர் |  |
| `parent.thread.heading` | Messages from the teacher | ගුරුතුමාගෙන් පණිවිඩ | ஆசிரியரிடமிருந்து செய்திகள் |  |
| `parent.thread.loading` | Loading your messages… | ඔබේ පණිවිඩ පූරණය වෙමින්… | உங்கள் செய்திகள் ஏற்றப்படுகிறது… |  |
| `parent.thread.error` | Your messages could not load. Please try again. | ඔබේ පණිවිඩ පූරණය කළ නොහැකි විය. නැවත උත්සාහ කරන්න. | உங்கள் செய்திகளை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள். |  |
| `parent.empty_heading` | No messages yet | තවම පණිවිඩ නැත | இன்னும் செய்திகள் இல்லை |  |
| `parent.day_format` | {day} {month} {year} | {year} {month} {day} | {day} {month} {year} | _identical (ta) — nothing to translate_ |
| `parent.ask.heading` | Ask about your child | ඔබේ දරුවා ගැන අසන්න | உங்கள் பிள்ளை பற்றிக் கேளுங்கள் |  |
| `parent.ask.empty_heading` | Try asking something like this | මෙසේ අසා බලන්න | இப்படிக் கேட்டுப் பார்க்கலாம் |  |
| `parent.ask.example.attendance` | Did my son come to class last Saturday? | ගිය සෙනසුරාදා මගේ පුතා පන්තියට ආවාද? | கடந்த சனிக்கிழமை என் மகன் வகுப்பிற்கு வந்தாரா? |  |
| `parent.ask.example.fee` | Is November's class fee paid? | නොවැම්බර් මාසයේ පන්ති ගාස්තුව ගෙවා තියෙනවාද? | நவம்பர் மாத வகுப்புக் கட்டணம் செலுத்தப்பட்டுவிட்டதா? |  |
| `parent.ask.example.marks` | How did he do in the November test? | නොවැම්බර් පරීක්ෂණයේ ඔහු කොහොමද? | நவம்பர் தேர்வில் அவர் எப்படிச் செய்தார்? |  |
| `parent.ask.input_label` | Your question | ඔබේ ප්‍රශ්නය | உங்கள் கேள்வி |  |
| `parent.ask.input_placeholder` | Ask about your child… | ඔබේ දරුවා ගැන අසන්න… | உங்கள் பிள்ளை பற்றிக் கேளுங்கள்… |  |
| `parent.ask.send` | Ask | අසන්න | கேளுங்கள் |  |
| `parent.ask.sending` | Asking… | අසමින්… | கேட்கப்படுகிறது… |  |
| `parent.ask.error` | That did not reach Panthiya. Please try again. | ප්‍රශ්නය පන්තියට ගියේ නැහැ. නැවත උත්සාහ කරන්න. | கேள்வி பந்தியாவுக்குச் சேரவில்லை. மீண்டும் முயலுங்கள். |  |
| `parent.ask.sender_parent` | You | ඔබ | நீங்கள் |  |
| `parent.ask.sender_assistant` | Panthiya assistant | පන්තිය සහායකයා | பந்தியா உதவியாளர் |  |

**`parent.note`**

- **EN:** Demo data only. These messages are examples of what a teacher would approve. The parent inbox is built and tested, but nothing is deployed yet, so nothing here comes from a live class.
- **SI:** නිදර්ශන දත්ත පමණි. මෙම පණිවිඩ ගුරුතුමා අනුමත කරන ආකාරයේ උදාහරණ පමණි. දෙමාපිය පණිවිඩ පෙට්ටිය ගොඩනඟා පරීක්ෂා කර ඇත, නමුත් තවම කිසිවක් යෙදවා නැත, එබැවින් මෙහි කිසිවක් සැබෑ පන්තියකින් නොවේ.
  - Fix (si): 
- **TA:** மாதிரித் தரவு மட்டும். இந்தச் செய்திகள் ஆசிரியர் அனுமதிக்கும் வகையான உதாரணங்கள். பெற்றோர் செய்திப் பெட்டி உருவாக்கப்பட்டு சோதிக்கப்பட்டுள்ளது, ஆனால் இன்னும் எதுவும் நிறுவப்படவில்லை, எனவே இங்குள்ள எதுவும் உண்மையான வகுப்பிலிருந்து வரவில்லை.
  - Fix (ta): 

**`parent.thread.intro`**

- **EN:** Every message below was written from the class records and approved by the teacher before it was sent. You cannot write in this thread — to ask something, use the box below.
- **SI:** පහත සෑම පණිවිඩයක්ම පන්තියේ සටහන් වලින් සකස් කර, යවන්නට පෙර ගුරුතුමා අනුමත කර ඇත. මෙම පණිවිඩ පෙළට ඔබට ලිවිය නොහැක — යමක් ඇසීමට පහත කොටුව භාවිත කරන්න.
  - Fix (si): 
- **TA:** கீழே உள்ள ஒவ்வொரு செய்தியும் வகுப்புப் பதிவுகளில் இருந்து எழுதப்பட்டு, அனுப்புவதற்கு முன் ஆசிரியரால் அனுமதிக்கப்பட்டது. இந்தத் தொடரில் நீங்கள் எழுத முடியாது — ஏதாவது கேட்க, கீழே உள்ள பெட்டியைப் பயன்படுத்துங்கள்.
  - Fix (ta): 

**`parent.empty_body`**

- **EN:** When the teacher approves an update about your child, it will appear here. Nothing is ever sent to you before the teacher approves it.
- **SI:** ගුරුතුමා ඔබේ දරුවා ගැන යාවත්කාලීනයක් අනුමත කළ විට එය මෙහි පෙනේ. ගුරුතුමාගේ අනුමැතියට පෙර කිසිවක් ඔබට නොයවයි.
  - Fix (si): 
- **TA:** ஆசிரியர் உங்கள் பிள்ளை பற்றிய தகவலை அனுமதித்ததும் அது இங்கே தோன்றும். ஆசிரியரின் அனுமதிக்கு முன் எதுவும் உங்களுக்கு அனுப்பப்படுவதில்லை.
  - Fix (ta): 

**`parent.msg.fee_paid`**

- **EN:** Thank you — we have received {amount} for {name}'s {month} class fee. Nothing is outstanding for this month.
- **SI:** ස්තූතියි — {name}ගේ {month} මාසයේ පන්ති ගාස්තුව වන {amount} ලැබුණා. මේ මාසයට ගෙවිය යුතු කිසිවක් නැත.
  - Fix (si): 
- **TA:** நன்றி — {name} இன் {month} மாத வகுப்புக் கட்டணமாக {amount} கிடைத்தது. இந்த மாதத்திற்கு செலுத்த வேண்டியது எதுவும் இல்லை.
  - Fix (ta): 

**`parent.msg.marks`**

- **EN:** {name} scored {score} out of {max} in the November test. His working is clear and his algebra is steady; this month we will spend a little more time on geometry.
- **SI:** {name} නොවැම්බර් පරීක්ෂණයෙන් {max}කින් ලකුණු {score} ලබා ගත්තා. ඔහුගේ වැඩ පැහැදිලියි, වීජ ගණිතය හොඳින් තියෙනවා; මේ මාසයේ ජ්‍යාමිතියට තව ටිකක් කාලය දෙමු.
  - Fix (si): 
- **TA:** {name} நவம்பர் தேர்வில் {max} இல் {score} மதிப்பெண் பெற்றார். அவரது வேலை தெளிவாக உள்ளது, இயற்கணிதம் நன்றாக உள்ளது; இந்த மாதம் வடிவகணிதத்திற்கு இன்னும் சிறிது நேரம் ஒதுக்குவோம்.
  - Fix (ta): 

**`parent.msg.absent`**

- **EN:** {name} was not in class today. We worked through the exercises on Pythagoras' theorem. I have kept a copy of the notes for him and he can collect them at the next class.
- **SI:** {name} අද පන්තියට ආවේ නැහැ. අපි පයිතගරස් ප්‍රමේයයේ අභ්‍යාස කළා. ඔහුට සටහන් මම තියාගෙන ඉන්නවා, ඊළඟ පන්තියේදී ගන්න පුළුවන්.
  - Fix (si): 
- **TA:** {name} இன்று வகுப்பிற்கு வரவில்லை. நாங்கள் பித்தகோரஸ் தேற்றப் பயிற்சிகளைச் செய்தோம். அவருக்கான குறிப்புகளை நான் வைத்திருக்கிறேன், அடுத்த வகுப்பில் பெற்றுக்கொள்ளலாம்.
  - Fix (ta): 

**`parent.msg.next_class`**

- **EN:** Our next class is on {date} at the usual time. Please remind {name} to bring his geometry instruments.
- **SI:** ඊළඟ පන්තිය {date} දින සුපුරුදු වෙලාවට. ජ්‍යාමිතික උපකරණ ගෙන ඒමට {name}ට සිහිපත් කරන්න.
  - Fix (si): 
- **TA:** அடுத்த வகுப்பு {date} அன்று வழக்கமான நேரத்தில். வடிவகணிதக் கருவிகளைக் கொண்டு வர {name} க்கு நினைவுபடுத்துங்கள்.
  - Fix (ta): 

**`parent.ask.caution`**

- **EN:** This box is the Panthiya assistant, not your teacher. Answers here are generated from the records and are not approved updates.
- **SI:** මෙම කොටුව පන්තිය සහායකයා, ගුරුතුමා නොවේ. මෙහි පිළිතුරු සටහන් වලින් සකස් වූ ඒවා; ගුරුතුමා අනුමත කළ යාවත්කාලීන නොවේ.
  - Fix (si): 
- **TA:** இந்தப் பெட்டி பந்தியா உதவியாளர், உங்கள் ஆசிரியர் அல்ல. இங்குள்ள பதில்கள் பதிவுகளில் இருந்து உருவாக்கப்படுகின்றன; அவை ஆசிரியர் அனுமதித்த தகவல்கள் அல்ல.
  - Fix (ta): 

**`parent.ask.intro`**

- **EN:** You can ask about your own child only — attendance, class fees and marks. If there is no record, the assistant will say so instead of guessing. For anything important, please talk to the teacher.
- **SI:** ඔබට අසන්න පුළුවන් ඔබේ දරුවා ගැන පමණයි — පැමිණීම, පන්ති ගාස්තු සහ ලකුණු. සටහනක් නැත්නම් සහායකයා අනුමාන නොකර, නැති බව කියයි. වැදගත් දෙයක් නම් ගුරුතුමා සමඟ කථා කරන්න.
  - Fix (si): 
- **TA:** உங்கள் சொந்தப் பிள்ளை பற்றி மட்டுமே கேட்கலாம் — வருகை, வகுப்புக் கட்டணம் மற்றும் மதிப்பெண்கள். பதிவு இல்லையென்றால் உதவியாளர் ஊகிக்காமல், இல்லை என்றே சொல்லும். முக்கியமான எதற்கும் ஆசிரியருடன் பேசுங்கள்.
  - Fix (ta): 

**`parent.ask.mock_answer`**

- **EN:** I can only answer from what the teacher has recorded about {name}, and I cannot tell you anything about another child. The class records are not connected yet, so I have nothing to look up — this is a demo answer. From M4 your question will be answered from {name}'s own attendance, fee and mark records.
- **SI:** මට කියන්න පුළුවන් {name} ගැන ගුරුතුමා සටහන් කර ඇති දේ පමණයි; වෙනත් දරුවෙක් ගැන කිසිවක් කියන්න බැහැ. පන්තියේ සටහන් තවම සම්බන්ධ කර නැති නිසා බලන්න කිසිවක් නැත — මෙය නිදර්ශන පිළිතුරක්. M4 සමඟ ඔබේ ප්‍රශ්නයට {name}ගේ පැමිණීම, ගාස්තු සහ ලකුණු සටහන් වලින් පමණක් පිළිතුරු ලැබේ.
  - Fix (si): 
- **TA:** {name} பற்றி ஆசிரியர் பதிவு செய்ததை மட்டுமே நான் சொல்ல முடியும்; வேறு எந்தப் பிள்ளை பற்றியும் எதுவும் சொல்ல முடியாது. வகுப்புப் பதிவுகள் இன்னும் இணைக்கப்படவில்லை, எனவே பார்ப்பதற்கு எதுவும் இல்லை — இது ஒரு மாதிரிப் பதில். M4 இல் உங்கள் கேள்விக்கு {name} இன் சொந்த வருகை, கட்டணம் மற்றும் மதிப்பெண் பதிவுகளில் இருந்து மட்டுமே பதில் கிடைக்கும்.
  - Fix (ta): 

---

### `student.*` (17 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `student.heading` | Ask for a hint | ඉඟියක් ඉල්ලන්න | ஒரு துப்பு கேளுங்கள் |  |
| `student.tutor.heading` | Ask about a question you are stuck on | ඔබට අමාරු වූ ප්‍රශ්නය ගැන අසන්න | நீங்கள் சிக்கிக்கொண்ட கேள்வியைப் பற்றிக் கேளுங்கள் |  |
| `student.empty_heading` | Try asking something like this | මෙවැනි දෙයක් අසා බලන්න | இது போன்று கேட்டுப் பாருங்கள் |  |
| `student.prompt.maths` | I am stuck on 2x + 5 = 17 | 2x + 5 = 17 මට අමාරුයි | 2x + 5 = 17 எனக்குச் சிக்கலாக இருக்கிறது |  |
| `student.prompt.science` | How do I start a question about speed and distance? | වේගය සහ දුර ගැන ප්‍රශ්නයක් පටන් ගන්නේ කොහොමද? | வேகம் மற்றும் தூரம் பற்றிய கணக்கை எப்படித் தொடங்குவது? |  |
| `student.prompt.ict` | What does a loop do in a flowchart? | ගැලීම් සටහනක ලූපයක් කරන්නේ කුමක්ද? | ஓட்டப் படத்தில் ஒரு சுழற்சி என்ன செய்கிறது? |  |
| `student.input_label` | Your question | ඔබේ ප්‍රශ්නය | உங்கள் கேள்வி |  |
| `student.input_placeholder` | Type the question you are stuck on… | ඔබට අමාරු ප්‍රශ්නය ලියන්න… | உங்களுக்குச் சிக்கலான கேள்வியை எழுதுங்கள்… |  |
| `student.send` | Ask | අසන්න | கேட்கவும் |  |
| `student.sending` | Thinking… | සිතමින්… | சிந்திக்கிறது… |  |
| `student.error` | That did not reach Panthiya. Please try again. | එය පන්තියට ලැබුණේ නැත. කරුණාකර නැවත උත්සාහ කරන්න. | அது பந்தியாவைச் சேரவில்லை. மீண்டும் முயலுங்கள். |  |
| `student.sender_student` | You | ඔබ | நீங்கள் |  |
| `student.sender_tutor` | Panthiya tutor | පන්තිය උපදේශක | பந்தியா பயிற்றுவிப்பான் |  |

**`student.note`**

- **EN:** Demo only. The tutor's rules are built and tested, but nothing is deployed and no model is answering yet, so the hints below are examples of what Panthiya will say in a real class.
- **SI:** නිදර්ශනය පමණි. උපදේශකයාගේ නීති ගොඩනඟා පරීක්ෂා කර ඇත, නමුත් තවම කිසිවක් යෙදවා නැත සහ ආකෘතියක් පිළිතුරු දෙන්නේ ද නැත, එබැවින් පහත ඇති ඉඟි සැබෑ පන්තියක පන්තිය පවසන දේවල උදාහරණ පමණි.
  - Fix (si): 
- **TA:** மாதிரி மட்டும். பயிற்றுவிப்பானின் விதிகள் உருவாக்கப்பட்டு சோதிக்கப்பட்டுள்ளன, ஆனால் இன்னும் எதுவும் நிறுவப்படவில்லை, எந்த மாதிரியும் பதில் சொல்லவில்லை, எனவே கீழே உள்ள துப்புகள் உண்மையான வகுப்பில் பந்தியா சொல்லப் போவதற்கான எடுத்துக்காட்டுகள் மட்டுமே.
  - Fix (ta): 

**`student.mock_hint`**

- **EN:** This is a linear equation, so the method is to get the unknown by itself one step at a time — not to guess.  Start by taking the same constant away from both sides, then divide both sides by the number multiplying the unknown.  Which single step would leave only the unknown on the left?  To check your own result, put it back into the original equation and see whether both sides balance.
- **SI:** මෙය රේඛීය සමීකරණයකි, එබැවින් ක්‍රමය වන්නේ නොදන්නා රාශිය එක පියවරක් ගානේ තනි කර ගැනීමයි — අනුමාන කිරීම නොවේ.  පළමුව දෙපැත්තෙන්ම එකම නියත රාශිය අඩු කරන්න, පසුව නොදන්නා රාශිය ගුණ කරන සංඛ්‍යාවෙන් දෙපැත්තම බෙදන්න.  වම් පැත්තේ නොදන්නා රාශිය පමණක් ඉතිරි කරන්නේ කුමන එක පියවරද?  ඔබේ ප්‍රතිඵලය පරීක්ෂා කිරීමට, එය මුල් සමීකරණයට නැවත ආදේශ කර දෙපැත්ත සමාන වේද බලන්න.
  - Fix (si): 
- **TA:** இது ஒரு நேரிய சமன்பாடு, எனவே முறை என்பது தெரியாத மதிப்பை ஒரு படிக்கு ஒன்றாகத் தனியே நிற்க வைப்பதே — ஊகிப்பது அல்ல.  முதலில் இரு பக்கங்களிலும் இருந்து அதே மாறிலியைக் கழியுங்கள், பிறகு தெரியாத மதிப்பைப் பெருக்கும் எண்ணால் இரு பக்கங்களையும் வகுங்கள்.  இடது பக்கத்தில் தெரியாத மதிப்பை மட்டும் விட்டுவைக்கும் ஒரே படி எது?  உங்கள் முடிவைச் சரிபார்க்க, அதை மூல சமன்பாட்டில் மீண்டும் பதிலிட்டு இரு பக்கங்களும் சமமாக உள்ளதா எனப் பாருங்கள்.
  - Fix (ta): 

**`student.mock_example`**

- **EN:** Solve 3y + 4 = 19. Taking 4 from both sides leaves 3y = 15, and dividing both sides by 3 leaves y = 5. Putting y = 5 back in gives 15 + 4, which is 19, so it holds.
- **SI:** 3y + 4 = 19 විසඳන්න. දෙපැත්තෙන් 4 අඩු කළ විට 3y = 15 ලැබේ, දෙපැත්ත 3 න් බෙදූ විට y = 5 ලැබේ. y = 5 නැවත ආදේශ කළ විට 15 + 4 යනු 19 වන බැවින් එය නිවැරදියි.
  - Fix (si): 
- **TA:** 3y + 4 = 19 என்பதைத் தீர்க்கவும். இரு பக்கங்களிலும் இருந்து 4 ஐக் கழித்தால் 3y = 15 கிடைக்கும், இரு பக்கங்களையும் 3 ஆல் வகுத்தால் y = 5 கிடைக்கும். y = 5 ஐ மீண்டும் பதிலிட்டால் 15 + 4 என்பது 19 ஆக வருவதால் அது சரி.
  - Fix (ta): 

**`student.mock_transfer`**

- **EN:** The numbers above are not yours. Use the same two steps on your own equation, then check your own result the same way.
- **SI:** ඉහත ගණන් ඔබේ නොවේ. එම පියවර දෙකම ඔබේ සමීකරණයට යොදා, ඔබේ ප්‍රතිඵලය එලෙසම පරීක්ෂා කරන්න.
  - Fix (si): 
- **TA:** மேலே உள்ள எண்கள் உங்களுடையவை அல்ல. அதே இரண்டு படிகளையும் உங்கள் சமன்பாட்டில் பயன்படுத்தி, உங்கள் முடிவை அதே முறையில் சரிபார்க்கவும்.
  - Fix (ta): 

---

### `redteam.*` (65 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `redteam.heading` | Red team | ප්‍රහාර පරීක්ෂණය | தாக்குதல் சோதனை |  |
| `redteam.warning.heading` | A defence layer is switched off | ආරක්ෂක ස්තරයක් ක්‍රියා විරහිත කර ඇත | ஒரு பாதுகாப்பு அடுக்கு நிறுத்தப்பட்டுள்ளது |  |
| `redteam.warning.layers` | Switched off: {layers} | ක්‍රියා විරහිත: {layers} | நிறுத்தப்பட்டவை: {layers} |  |
| `redteam.controls.heading` | Layers and roles | ස්තර සහ භූමිකා | அடுக்குகளும் பாத்திரங்களும் |  |
| `redteam.layers.legend` | Defence layers | ආරක්ෂක ස්තර | பாதுகாப்பு அடுக்குகள் |  |
| `redteam.layer.instructions` | Role scoping and agent instructions | භූමිකා සීමා කිරීම සහ නියෝජිත උපදෙස් | பாத்திர வரையறையும் முகவர் அறிவுரைகளும் |  |
| `redteam.layer.guardrail` | Bedrock Guardrail | Bedrock Guardrail | Bedrock Guardrail | **MISSING/UNTRANSLATED (si — identical to English)** **MISSING/UNTRANSLATED (ta — identical to English)** |
| `redteam.layer.policyCheck` | Final policy check | අවසාන ප්‍රතිපත්ති පරීක්ෂාව | இறுதிக் கொள்கைச் சோதனை |  |
| `redteam.layer.wellbeing` | Wellbeing reply | සුබසාධන පිළිතුර | நலவாழ்வுப் பதில் |  |
| `redteam.layers.locked` | Layers are fixed until this run finishes. | මෙම ක්‍රියාත්මක කිරීම අවසන් වන තුරු ස්තර වෙනස් කළ නොහැක. | இந்த இயக்கம் முடியும் வரை அடுக்குகளை மாற்ற முடியாது. |  |
| `redteam.tokens.heading` | Roles you are signed in for | ඔබ පුරනය වී ඇති භූමිකා | நீங்கள் உள்நுழைந்துள்ள பாத்திரங்கள் |  |
| `redteam.tokens.present` | {role}: signed in — {count} cases can run | {role}: පුරනය වී ඇත — අවස්ථා {count}ක් ක්‍රියාත්මක කළ හැක | {role}: உள்நுழைந்துள்ளீர்கள் — {count} வழக்குகளை இயக்க முடியும் |  |
| `redteam.tokens.missing` | {role}: no token — {count} cases score error, not blocked | {role}: ටෝකනයක් නැත — අවස්ථා {count}ක් අවහිර විය නොව දෝෂයක් ලෙස ලකුණු වේ | {role}: டோக்கன் இல்லை — {count} வழக்குகள் தடுக்கப்பட்டது என்று அல்ல, பிழை என மதிப்பிடப்படும் |  |
| `redteam.run` | Run the suite | පරීක්ෂණය ක්‍රියාත්මක කරන්න | தொகுப்பை இயக்கு |  |
| `redteam.running` | Case {done} of {total} — running {id}… | අවස්ථාව {done} / {total} — {id} ක්‍රියාත්මක වෙමින්… | வழக்கு {done} / {total} — {id} இயங்குகிறது… |  |
| `redteam.suite.error` | The case suite could not load, so there is nothing to run. | අවස්ථා කට්ටලය පූරණය කළ නොහැකි විය, එබැවින් ක්‍රියාත්මක කිරීමට කිසිවක් නැත. | வழக்குத் தொகுப்பை ஏற்ற முடியவில்லை, எனவே இயக்க எதுவும் இல்லை. |  |
| `redteam.score.heading` | Scoreboard | ලකුණු පුවරුව | மதிப்பெண் பலகை |  |
| `redteam.score.ran` | Ran | ක්‍රියාත්මක විය | இயக்கப்பட்டது |  |
| `redteam.score.of` | {ran} of {total} | {ran} / {total} | {ran} / {total} |  |
| `redteam.score.blocked` | Blocked | අවහිර විය | தடுக்கப்பட்டது |  |
| `redteam.score.leaked` | Leaked | කාන්දු විය | கசிந்தது |  |
| `redteam.score.errored` | Error — not blocked | දෝෂය — අවහිර වීමක් නොවේ | பிழை — தடுக்கப்பட்டது அல்ல |  |
| `redteam.score.needs_eye` | Needs a human eye | මිනිස් ඇසක් අවශ්‍ය | மனிதக் கண் தேவை |  |
| `redteam.score.error_note` | An error is not a block. A case that could not run is a case whose verdict we do not have. | දෝෂයක් යනු අවහිර කිරීමක් නොවේ. ක්‍රියාත්මක කළ නොහැකි වූ අවස්ථාවක නිර්ණය අප ළඟ නැත. | பிழை என்பது தடுப்பு அல்ல. இயக்க முடியாத வழக்கின் தீர்ப்பு நம்மிடம் இல்லை. |  |
| `redteam.table.heading` | The 36 documented attacks | ලේඛනගත ප්‍රහාර 36 | ஆவணப்படுத்தப்பட்ட 36 தாக்குதல்கள் |  |
| `redteam.table.caption` | Every case in the suite, with its verdict, the layer credited and the reply. | කට්ටලයේ සෑම අවස්ථාවක්ම, එහි නිර්ණය, ගෞරවය ලැබූ ස්තරය සහ පිළිතුර සමඟ. | தொகுப்பின் ஒவ்வொரு வழக்கும், அதன் தீர்ப்பு, பெருமை பெற்ற அடுக்கு மற்றும் பதிலுடன். |  |
| `redteam.col.case` | Case | අවස්ථාව | வழக்கு |  |
| `redteam.col.role` | Role | භූමිකාව | பாத்திரம் |  |
| `redteam.col.attack` | Attack | ප්‍රහාරය | தாக்குதல் |  |
| `redteam.col.verdict` | Verdict | නිර්ණය | தீர்ப்பு |  |
| `redteam.col.layer` | Held by | රැක ගත්තේ | காத்தது |  |
| `redteam.col.reply` | Reply | පිළිතුර | பதில் |  |
| `redteam.role.teacher` | Teacher | ගුරුවරයා | ஆசிரியர் |  |
| `redteam.role.parent` | Parent | දෙමාපියන් | பெற்றோர் |  |
| `redteam.role.student` | Student | සිසුවා | மாணவர் |  |
| `redteam.verdict.pending` | Not run yet | තවම ක්‍රියාත්මක නොවිණි | இன்னும் இயக்கப்படவில்லை |  |
| `redteam.verdict.blocked` | Blocked | අවහිර විය | தடுக்கப்பட்டது |  |
| `redteam.verdict.leaked` | Leaked | කාන්දු විය | கசிந்தது |  |
| `redteam.verdict.error` | Error | දෝෂය | பிழை |  |
| `redteam.reason.held_by_layer` | A defence layer stopped the reply. | ආරක්ෂක ස්තරයක් පිළිතුර නැවැත්වීය. | ஒரு பாதுகாப்பு அடுக்கு பதிலை நிறுத்தியது. |  |
| `redteam.reason.held_by_agent_refusal` | The agent refused on its own. No check read the reply. | නියෝජිතයා තනිවම ප්‍රතික්ෂේප කළේය. කිසිදු පරීක්ෂාවක් එම පිළිතුර කියවූයේ නැත. | முகவர் தானாகவே மறுத்தது. எந்தச் சோதனையும் அந்தப் பதிலைப் படிக்கவில்லை. |  |
| `redteam.reason.layer_disabled` | Its only net was a switched-off layer, so this reply would have reached the user. | එය රැක ගත්තේ ක්‍රියා විරහිත කළ ස්තරය පමණක් බැවින්, මෙම පිළිතුර පරිශීලකයාට ලැබෙනු ඇත. | இதைக் காத்தது நிறுத்தப்பட்ட அடுக்கு மட்டுமே, எனவே இந்தப் பதில் பயனரைச் சென்றடைந்திருக்கும். |  |
| `redteam.reason.case_role_mismatch` | Run under the wrong role, so it has no verdict. | වැරදි භූමිකාව යටතේ ක්‍රියාත්මක වූ බැවින් මෙයට නිර්ණයක් නැත. | தவறான பாத்திரத்தின் கீழ் இயக்கப்பட்டது, எனவே இதற்குத் தீர்ப்பு இல்லை. |  |
| `redteam.reason.chat_unauthenticated` | The chat API refused the token. | චැට් API ටෝකනය ප්‍රතික්ෂේප කළේය. | அரட்டை API டோக்கனை மறுத்தது. |  |
| `redteam.reason.chat_rejected` | The chat API rejected the request. | චැට් API ඉල්ලීම ප්‍රතික්ෂේප කළේය. | அரட்டை API கோரிக்கையை நிராகரித்தது. |  |
| `redteam.reason.chat_unavailable` | The chat API could not be reached. | චැට් API වෙත ළඟා විය නොහැකි විය. | அரட்டை API-ஐ அடைய முடியவில்லை. |  |
| `redteam.reason.chat_error` | The chat call failed, so this case has no verdict. | චැට් ඇමතුම අසාර්ථක වූ බැවින් මෙම අවස්ථාවට නිර්ණයක් නැත. | அரட்டை அழைப்பு தோல்வியடைந்தது, எனவே இந்த வழக்குக்குத் தீர்ப்பு இல்லை. |  |
| `redteam.reason.no_token` | Not run: there is no token for this role. | ක්‍රියාත්මක නොවිණි: මෙම භූමිකාව සඳහා ටෝකනයක් නැත. | இயக்கப்படவில்லை: இந்தப் பாத்திரத்துக்கு டோக்கன் இல்லை. |  |
| `redteam.needs_eye` | Needs a human eye | මිනිස් ඇසක් අවශ්‍ය | மனிதக் கண் தேவை |  |
| `redteam.reply.show` | Read reply | පිළිතුර කියවන්න | பதிலைப் படி |  |
| `redteam.reply.hide` | Hide reply | පිළිතුර සඟවන්න | பதிலை மறை |  |
| `redteam.reply.show_case` | Read reply — case {id} | පිළිතුර කියවන්න — අවස්ථාව {id} | பதிலைப் படி — வழக்கு {id} |  |
| `redteam.reply.hide_case` | Hide reply — case {id} | පිළිතුර සඟවන්න — අවස්ථාව {id} | பதிலை மறை — வழக்கு {id} |  |
| `redteam.reply.empty` | No reply text was received. | පිළිතුරු පෙළක් ලැබුණේ නැත. | பதில் உரை எதுவும் கிடைக்கவில்லை. |  |
| `redteam.mock.reply_blocked` | I cannot help with that one. Please ask your teacher. | එයට උදව් කළ නොහැක. කරුණාකර ඔබේ ගුරුතුමාගෙන් අසන්න. | அதற்கு நான் உதவ முடியாது. தயவுசெய்து உங்கள் ஆசிரியரிடம் கேளுங்கள். |  |

**`redteam.note`**

- **EN:** 36 documented attacks, run against the live agent under each attack's own role. Blocked is not the same as proven: read every case the table marks for a human eye before repeating the score out loud.
- **SI:** ලේඛනගත ප්‍රහාර 36ක්, එක් එක් ප්‍රහාරයට අදාළ භූමිකාව යටතේ සජීවී නියෝජිතයාට එරෙහිව ක්‍රියාත්මක කෙරේ. අවහිර වීම යනු ඔප්පු වීම නොවේ: ලකුණු ප්‍රකාශ කිරීමට පෙර, මිනිස් ඇසක් අවශ්‍ය යැයි වගුවේ සලකුණු කර ඇති සෑම අවස්ථාවක්ම කියවන්න.
  - Fix (si): 
- **TA:** ஆவணப்படுத்தப்பட்ட 36 தாக்குதல்கள், ஒவ்வொரு தாக்குதலின் சொந்த பாத்திரத்தின் கீழ் நேரடி முகவருக்கு எதிராக இயக்கப்படுகின்றன. தடுக்கப்பட்டது என்பது நிரூபிக்கப்பட்டது அல்ல: மதிப்பெண்ணைச் சொல்வதற்கு முன், மனிதக் கண் தேவை எனக் குறிக்கப்பட்ட ஒவ்வொரு வழக்கையும் படியுங்கள்.
  - Fix (ta): 

**`redteam.mock.notice`**

- **EN:** Not connected to the live agent yet. The replies below come from a mock inside this page, so nothing here is a real score.
- **SI:** තවම සජීවී නියෝජිතයා සම්බන්ධ කර නැත. පහත පිළිතුරු මෙම පිටුව තුළ ඇති ආදර්ශකයකින් එන බැවින්, මෙහි ඇති කිසිවක් සැබෑ ලකුණු නොවේ.
  - Fix (si): 
- **TA:** இன்னும் நேரடி முகவருடன் இணைக்கப்படவில்லை. கீழே உள்ள பதில்கள் இந்தப் பக்கத்திலுள்ள ஒரு மாதிரியிலிருந்து வருகின்றன, எனவே இங்குள்ள எதுவும் உண்மையான மதிப்பெண் அல்ல.
  - Fix (ta): 

**`redteam.layers.help`**

- **EN:** Unticking a layer withdraws its credit for this run, so a case whose only net was that layer scores leaked. The wellbeing reply has no toggle: the 1926 helpline answer is not a defence to switch off for a demo.
- **SI:** ස්තරයක සලකුණ ඉවත් කළ විට, මෙම ක්‍රියාත්මක කිරීම සඳහා එහි ගෞරවය ඉවත් වේ; එබැවින් එම ස්තරය පමණක් රැක ගත් අවස්ථාවක් කාන්දු විය ලෙස ලකුණු වේ. සුබසාධන පිළිතුරට ස්විචයක් නැත: 1926 උපකාර අංකයේ පිළිතුර ප්‍රදර්ශනයක් සඳහා ක්‍රියා විරහිත කරන ආරක්ෂාවක් නොවේ.
  - Fix (si): 
- **TA:** ஒரு அடுக்கின் குறியை நீக்கினால், இந்த இயக்கத்துக்கு அதன் பெருமை விலக்கப்படுகிறது; எனவே அந்த அடுக்கு மட்டுமே காத்த வழக்கு கசிந்தது என மதிப்பிடப்படும். நலவாழ்வுப் பதிலுக்கு நிலைமாற்றி இல்லை: 1926 உதவி எண்ணின் பதில், ஒரு காட்சிக்காக நிறுத்தும் பாதுகாப்பு அல்ல.
  - Fix (ta): 

**`redteam.tokens.help`**

- **EN:** The chat API takes the role from the verified token, so a parent case needs a parent sign-in. There is no fallback: a case with no token for its role is recorded as the refused request it would have been, and scores error.
- **SI:** චැට් API භූමිකාව ගන්නේ සත්‍යාපිත ටෝකනයෙන් බැවින්, දෙමාපිය අවස්ථාවකට දෙමාපිය පුරනය වීමක් අවශ්‍යයි. විකල්පයක් නැත: භූමිකාවට ටෝකනයක් නොමැති අවස්ථාවක්, ප්‍රතික්ෂේප වන ඉල්ලීමක් ලෙස සටහන් වී දෝෂයක් ලෙස ලකුණු වේ.
  - Fix (si): 
- **TA:** அரட்டை API பாத்திரத்தை சரிபார்க்கப்பட்ட டோக்கனிலிருந்தே எடுக்கிறது, எனவே ஒரு பெற்றோர் வழக்குக்கு ஒரு பெற்றோர் உள்நுழைவு தேவை. மாற்று வழி இல்லை: பாத்திரத்துக்கு டோக்கன் இல்லாத வழக்கு, மறுக்கப்பட்டிருக்கும் கோரிக்கையாகப் பதிவாகி பிழை என மதிப்பிடப்படும்.
  - Fix (ta): 

**`redteam.run.done`**

- **EN:** Run finished. Read every case marked for a human eye before claiming the score.
- **SI:** ක්‍රියාත්මක කිරීම අවසන්. ලකුණු ප්‍රකාශ කිරීමට පෙර, මිනිස් ඇසක් අවශ්‍ය යැයි සලකුණු කළ සෑම අවස්ථාවක්ම කියවන්න.
  - Fix (si): 
- **TA:** இயக்கம் முடிந்தது. மதிப்பெண்ணைச் சொல்வதற்கு முன், மனிதக் கண் தேவை எனக் குறிக்கப்பட்ட ஒவ்வொரு வழக்கையும் படியுங்கள்.
  - Fix (ta): 

**`redteam.run.failed`**

- **EN:** The run stopped: the scoring API did not answer. The cases already scored are shown; the rest were not run.
- **SI:** ක්‍රියාත්මක කිරීම නැවතුණි: ලකුණු දෙන API පිළිතුරු දුන්නේ නැත. මේ වන විට ලකුණු ලැබූ අවස්ථා පෙන්වා ඇත; ඉතිරිය ක්‍රියාත්මක වූයේ නැත.
  - Fix (si): 
- **TA:** இயக்கம் நின்றுவிட்டது: மதிப்பிடும் API பதிலளிக்கவில்லை. இதுவரை மதிப்பிடப்பட்ட வழக்குகள் காட்டப்பட்டுள்ளன; மீதியானவை இயக்கப்படவில்லை.
  - Fix (ta): 

**`redteam.needs_eye.note`**

- **EN:** No check held this one back — the agent refused by itself, and the final policy check has known gaps. Read the reply before counting it as held.
- **SI:** මෙය නැවැත්වූයේ කිසිදු පරීක්ෂාවක් නොවේ — නියෝජිතයා තනිවම ප්‍රතික්ෂේප කළේය, අවසාන ප්‍රතිපත්ති පරීක්ෂාවට දන්නා හිඩැස් ඇත. අවහිර වූවා ලෙස ගණන් ගැනීමට පෙර පිළිතුර කියවන්න.
  - Fix (si): 
- **TA:** இதை எந்தச் சோதனையும் நிறுத்தவில்லை — முகவர் தானாகவே மறுத்தது, இறுதிக் கொள்கைச் சோதனையில் அறியப்பட்ட இடைவெளிகள் உள்ளன. காக்கப்பட்டது எனக் கணக்கிடும் முன் பதிலைப் படியுங்கள்.
  - Fix (ta): 

**`redteam.reply.memory_note`**

- **EN:** Reply text is shown from this browser's memory only. It is never sent to the scoring API and never stored.
- **SI:** පිළිතුරු පෙළ පෙන්වන්නේ මෙම බ්‍රව්සරයේ මතකයෙන් පමණි. එය ලකුණු දෙන API වෙත කිසිදා නොයවන අතර කිසිදා ගබඩා නොකෙරේ.
  - Fix (si): 
- **TA:** பதில் உரை இந்த உலாவியின் நினைவிலிருந்து மட்டுமே காட்டப்படுகிறது. அது மதிப்பிடும் API-க்கு ஒருபோதும் அனுப்பப்படுவதில்லை, ஒருபோதும் சேமிக்கப்படுவதில்லை.
  - Fix (ta): 

**`redteam.mock.reply_refusal`**

- **EN:** I can only share what the teacher has recorded about your own child, so I cannot answer that. Would you like your own child's attendance instead?
- **SI:** මට බෙදාගත හැක්කේ ගුරුතුමා ඔබේ දරුවා ගැන සටහන් කර ඇති දේ පමණක් බැවින්, එයට පිළිතුරු දිය නොහැක. ඒ වෙනුවට ඔබේ දරුවාගේ පැමිණීම බලන්නද?
  - Fix (si): 
- **TA:** ஆசிரியர் உங்கள் பிள்ளை பற்றிப் பதிவு செய்ததை மட்டுமே நான் பங்கிட முடியும், எனவே அதற்குப் பதில் சொல்ல முடியாது. அதற்குப் பதிலாக உங்கள் பிள்ளையின் வருகையைப் பார்க்கவா?
  - Fix (ta): 

**`redteam.mock.reply_wellbeing`**

- **EN:** That sounds really hard, and you deserve help from someone who can listen properly. You can call 1926 at any time to talk to someone.
- **SI:** ඒක ඇත්තටම අමාරු දෙයක්, ඔබට හරියට සවන් දෙන කෙනෙකුගේ උදව් ලැබිය යුතුයි. කතා කරන්න ඕනෑම වෙලාවක 1926 අංකයට අමතන්න පුළුවන්.
  - Fix (si): 
- **TA:** அது மிகவும் கடினமாகத் தெரிகிறது, உங்களைச் சரியாகக் கேட்கும் ஒருவரின் உதவி உங்களுக்குக் கிடைக்க வேண்டும். பேச வேண்டுமானால் எந்த நேரத்திலும் 1926 என்ற எண்ணை அழைக்கலாம்.
  - Fix (ta): 

---

### `auth.*` (23 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `auth.heading` | Sign in | පුරනය වන්න | உள்நுழைக |  |
| `auth.signin` | Sign in | පුරනය වන්න | உள்நுழைக |  |
| `auth.signout` | Sign out | ඉවත් වන්න | வெளியேறு |  |
| `auth.role.teacher` | Teacher | ගුරුවරයා | ஆசிரியர் |  |
| `auth.role.parent` | Parent | දෙමාපියන් | பெற்றோர் |  |
| `auth.role.student` | Student | සිසුවා | மாணவர் |  |
| `auth.signed_in` | Signed in as {email} — {role}. | {email} ලෙස පුරනය වී ඇත — {role}. | {email} என உள்நுழைந்துள்ளீர்கள் — {role}. |  |
| `auth.signed_out` | Not signed in. This page needs a {role} sign-in. | පුරනය වී නැත. මෙම පිටුවට {role} පුරනය වීමක් අවශ්‍යයි. | உள்நுழையவில்லை. இந்தப் பக்கத்திற்கு ஒரு {role} உள்நுழைவு தேவை. |  |
| `auth.working` | Taking you to the sign-in page… | පුරනය වීමේ පිටුවට යමින්… | உள்நுழைவுப் பக்கத்திற்கு அழைத்துச் செல்கிறோம்… |  |
| `auth.failed` | Sign-in did not finish, so nothing is signed in. Please try again. | පුරනය වීම සම්පූර්ණ වූයේ නැත, එබැවින් කිසිවක් පුරනය වී නැත. නැවත උත්සාහ කරන්න. | உள்நுழைவு முடியவில்லை, எனவே எதுவும் உள்நுழையவில்லை. மீண்டும் முயலுங்கள். |  |
| `auth.expired` | Your sign-in has run out after 60 minutes. Please sign in again. | විනාඩි 60කට පසු ඔබගේ පුරනය වීම අවසන් විය. නැවත පුරනය වන්න. | 60 நிமிடங்களுக்குப் பிறகு உங்கள் உள்நுழைவு முடிந்துவிட்டது. மீண்டும் உள்நுழையுங்கள். |  |
| `auth.unauthorized` | The server did not accept your sign-in. Please sign in again. | සේවාදායකය ඔබගේ පුරනය වීම පිළිගත්තේ නැත. නැවත පුරනය වන්න. | சேவையகம் உங்கள் உள்நுழைவை ஏற்கவில்லை. மீண்டும் உள்நுழையுங்கள். |  |
| `auth.wrong_role` | This is a {actual} sign-in and this page is for a {expected}. Sign out and use the right account. | මෙය {actual} පුරනය වීමකි; මෙම පිටුව {expected} සඳහා ය. ඉවත් වී නිවැරදි ගිණුමෙන් පුරනය වන්න. | இது ஒரு {actual} உள்நுழைவு; இந்தப் பக்கம் {expected} க்கானது. வெளியேறி சரியான கணக்கைப் பயன்படுத்துங்கள். |  |
| `auth.not_configured` | Sign-in is not switched on in this build yet. | මෙම අනුවාදයේ පුරනය වීම තවම සක්‍රිය කර නැත. | இந்தப் பதிப்பில் உள்நுழைவு இன்னும் இயக்கப்படவில்லை. |  |
| `auth.entry.note` | Each page signs you in for itself. Open the page for your role. | සෑම පිටුවක්ම තම පිටුව සඳහාම ඔබව පුරනය කරයි. ඔබගේ භූමිකාවට අදාළ පිටුව විවෘත කරන්න. | ஒவ்வொரு பக்கமும் தனக்காகவே உங்களை உள்நுழைக்கிறது. உங்கள் பாத்திரத்துக்கான பக்கத்தைத் திறங்கள். |  |
| `auth.roles.label` | ID token for {role} | {role} සඳහා ID ටෝකනය | {role} க்கான ID டோக்கன் |  |
| `auth.roles.placeholder` | Paste an ID token | ID ටෝකනයක් අලවන්න | ஒரு ID டோக்கனை ஒட்டுங்கள் |  |
| `auth.roles.add` | Use these tokens | මෙම ටෝකන භාවිත කරන්න | இந்த டோக்கன்களைப் பயன்படுத்து |  |
| `auth.roles.clear` | Forget them | ඒවා අමතක කරන්න | அவற்றை மறந்துவிடு |  |
| `auth.roles.accepted` | Accepted for {roles}. | {roles} සඳහා පිළිගැනුණි. | {roles} க்கு ஏற்கப்பட்டது. |  |

**`auth.memory_note`**

- **EN:** Your sign-in is kept in this page's memory only, never on this device. A reload, or moving to another page, means signing in again.
- **SI:** ඔබගේ පුරනය වීම මෙම පිටුවේ මතකයේ පමණක් තබා ගනී; මෙම උපාංගයේ කිසිදා ගබඩා නොකෙරේ. පිටුව නැවත පූරණය කළ විට හෝ වෙනත් පිටුවකට ගිය විට නැවත පුරනය විය යුතුය.
  - Fix (si): 
- **TA:** உங்கள் உள்நுழைவு இந்தப் பக்கத்தின் நினைவில் மட்டுமே வைக்கப்படுகிறது; இந்தச் சாதனத்தில் ஒருபோதும் சேமிக்கப்படுவதில்லை. பக்கத்தை மீளேற்றினாலும், வேறு பக்கத்திற்குச் சென்றாலும் மீண்டும் உள்நுழைய வேண்டும்.
  - Fix (ta): 

**`auth.roles.help`**

- **EN:** A full run needs one token per role, and this browser holds one sign-in. Paste the other roles' ID tokens here; the demo-users script prints them. They are kept in memory for this run only.
- **SI:** සම්පූර්ණ ධාවනයකට සෑම භූමිකාවකටම ටෝකනයක් අවශ්‍යයි, නමුත් මෙම බ්‍රව්සරයේ ඇත්තේ එක් පුරනය වීමක් පමණි. අනෙක් භූමිකාවන්ගේ ID ටෝකන මෙහි අලවන්න; demo-users ස්ක්‍රිප්ටය ඒවා මුද්‍රණය කරයි. ඒවා මෙම ධාවනය සඳහා මතකයේ පමණක් තබා ගනී.
  - Fix (si): 
- **TA:** முழுத் தொகுப்பை இயக்க ஒவ்வொரு பாத்திரத்துக்கும் ஒரு டோக்கன் தேவை; இந்த உலாவியில் ஒரே உள்நுழைவு மட்டுமே உள்ளது. மற்ற பாத்திரங்களின் ID டோக்கன்களை இங்கே ஒட்டுங்கள்; demo-users ஸ்கிரிப்ட் அவற்றை அச்சிடுகிறது. அவை இந்த இயக்கத்துக்காக நினைவில் மட்டுமே வைக்கப்படும்.
  - Fix (ta): 

**`auth.roles.rejected`**

- **EN:** Not accepted for {roles}: a token must be an unexpired ID token whose own role matches the box it was pasted into.
- **SI:** {roles} සඳහා පිළිගත්තේ නැත: ටෝකනය කල් ඉකුත් නොවූ ID ටෝකනයක් විය යුතු අතර, එහි භූමිකාව එය අලවූ කොටුවට ගැළපිය යුතුය.
  - Fix (si): 
- **TA:** {roles} க்கு ஏற்கப்படவில்லை: டோக்கன் காலாவதியாகாத ID டோக்கனாக இருக்க வேண்டும், அதன் பாத்திரம் அது ஒட்டப்பட்ட பெட்டியுடன் பொருந்த வேண்டும்.
  - Fix (ta): 

---

### `footer.*` (5 keys)

| Key | English | Sinhala | Tamil | Flag |
|---|---|---|---|---|
| `footer.built_by` | Built for Sri Lankan classes, by a Sri Lankan student. | ශ්‍රී ලාංකික පන්ති සඳහා, ශ්‍රී ලාංකික ශිෂ්‍යයෙකු විසින්. | இலங்கை வகுப்புகளுக்காக, ஒரு இலங்கை மாணவரால். |  |
| `footer.author` | Nishen Madawa Abedeera · SLTC | නිශේන් මධව අබේදීර · SLTC | நிஷேன் மதவ அபேதீர · SLTC |  |
| `footer.license` | MIT licensed | MIT බලපත්‍රය | MIT உரிமம் |  |
| `footer.repo` | Source on GitHub | GitHub හි මූලාශ්‍රය | GitHub இல் மூலக் குறியீடு |  |
| `footer.demo_data` | Demo data only. All students and parents shown are fictional. | නිදර්ශන දත්ත පමණි. පෙන්වන සියලු සිසුන් සහ දෙමාපියන් ප්‍රබන්ධයකි. | மாதிரித் தரவு மட்டும். காட்டப்படும் அனைத்து மாணவர்களும் பெற்றோரும் கற்பனையானவர்கள். |  |

---

## Checklist

Tick a line when you have read every string in it. Stop wherever you like — the ticks say
where to pick up.

- [ ] **Priority 0** — the two Sinhala medicine words (30 seconds, and it is not a screen string)
- [ ] **Priority 1** — safety-critical strings (14 keys)
- [ ] **Priority 2** — terminology (4 words)
- [ ] `meta.*` (3)
- [ ] `skip.*` (1)
- [ ] `app.*` (2)
- [ ] `lang.*` (7)
- [ ] `hero.*` (2)
- [ ] `roles.*` (7)
- [ ] `rules.*` (7)
- [ ] `stamps.*` (5)
- [ ] `status.*` (4)
- [ ] `nav.*` (1)
- [ ] `teacher.*` (2)
- [ ] `chat.*` (15)
- [ ] `mic.*` (10)
- [ ] `ledger.*` (7)
- [ ] `month.*` (12)
- [ ] `audit.*` (22)
- [ ] `parent.*` (30)
- [ ] `student.*` (17)
- [ ] `redteam.*` (65)
- [ ] `auth.*` (23)
- [ ] `footer.*` (5)

Total: 261 keys — 14 in Priority 1, 247 in Priority 3, across 22 namespaces.
