# Teorie a plán: obtížnosti a prstoklad

Tahle složka vysvětluje hudební teorii a algoritmy, na kterých stojí body 2 (verze skladby
různé obtížnosti) a 4 (rady, kterým prstem hrát). Kód je ve `web/js/`, testy v `tests/`.

| Dokument | O čem je | Kód |
|---|---|---|
| [01-analyza.md](01-analyza.md) | tempo, doby, takt, akordy, tónina | `analysis.js` |
| [02-prstoklad.md](02-prstoklad.md) | pravidla prstokladu a jejich výpočet | `fingering.js` |
| [03-ruce.md](03-ruce.md) | rozdělení not mezi ruce, přehazování rukou | `hands.js` |
| [04-aranzovani.md](04-aranzovani.md) | jak vznikají úrovně 1–5 | `arrange.js` |
| [05-detekce-videa.md](05-detekce-videa.md) | jak se noty čtou z videa | `note_detector.py`, `audio_octave.py` |

## Jak to do sebe zapadá

```
video ──► noty (výška, začátek, konec, ruka podle barvy)            note_detector.py
            │
            ▼
      analýza: mřížka dob, takt, akordy, tónina                    analysis.js
            │
            ▼
      úroveň 1–5: melodie / bas / kvinty / originál / ozdoby        arrange.js
            │
            ▼
      ruce: dorovnání (nota do druhé ruky, když je akord moc široký) hands.js
            │
            ▼
      prstoklad: dynamické programování nad pravidly                fingering.js
            │
            ▼
      přehrávač: padající noty, písmena, prsty, smyčka, tempo        render.js, audio.js
```

Všechno po analýze běží v prohlížeči, takže funguje i pro libovolný `.mid` soubor, nejen pro
převedená videa.

## Stav (co je hotové a ověřené)

- [x] Detekce klávesnice podle vzoru černých kláves; oktáva podle zvuku. Test: syntetické video
      se známými notami + 2 reálná videa různého stylu.
- [x] Mřížka dob: perioda, fáze, takt 3/4 nebo 4/4. Testy: syntetické 3/4 a 4/4 s chvěním ±15 ms;
      na reálných videích drift pod 5 ms za 5 minut.
- [x] Akordy po dobách (8 typů) a tónina (Krumhansl–Kessler).
- [x] Úrovně 1–5 s testy invariant (úroveň 1 hraje jednu notu naráz, levá ruka je pod melodií,
      rozpětí ruky ≤ oktáva…).
- [x] Prstoklad: učebnicové výsledky pro stupnice C, G, D a F dur v obou rukou, dvě oktávy C dur,
      kvintakordy, pětiprstovou polohu a Ódu na radost.
- [x] Přehození noty do druhé ruky, když by akord přesáhl oktávu (a označení v UI).

## Plán dalších zlepšení (seřazeno podle přínosu)

1. **Proměnné tempo.** Mřížka je teď jedna pro celou skladbu, což stačí pro videa vyrobená
   z MIDI (Synthesia). U živě nahraných videí by bylo potřeba sledovat doby lokálně
   (např. dynamické programování podle Ellise 2007).
2. **Hlasy místo „nejvyšší noty“.** Melodie je teď nejvyšší tón pravé ruky. Lepší je rozdělit
   pravou ruku na hlasy (Chew & Wu 2004) a vybrat ten nejzpěvnější.
3. **Obraty akordů v levé ruce (úroveň 3).** Teď hraje základ + kvintu. Plynulejší je vést
   hlasy nejkratší cestou (voice leading) a volit obraty.
4. **Prstoklad z dat.** Pravidla dávají učebnicové výsledky na stupnicích a jednoduchých
   melodiích. U rychlých pasáží by pomohl statistický model natrénovaný na datasetu PIG
   (Nakamura et al. 2020), kde jsou prstoklady od pianistů.
5. **Kvantizace pro notový zápis.** Mřížka dob je hotová, takže lze noty zaokrouhlit a vyrobit
   MusicXML pro MuseScore.

## Zdroje

- Parncutt, Sloboda, Clarke, Raekallio, Desain (1997): *An ergonomic model of keyboard fingering
  for melodic fragments*. Music Perception 14(4).
- Jacobs (2001): *Refinements to the ergonomic model for keyboard fingering of Parncutt et al.*
  Music Perception 18(4).
- Al Kasimi, Nichols, Raphael (2007): *A simple algorithm for automatic generation of
  polyphonic piano fingerings*. ISMIR.
- Nakamura, Saito, Yoshii (2020): *Statistical learning and estimation of piano fingering*.
  Information Sciences 517 (dataset PIG).
- Krumhansl & Kessler (1982): tonální profily; Temperley (2001): *The Cognition of Basic
  Musical Structures*.
- Uitdenbogerd & Zobel (1999): *Melodic matching techniques for large music databases*
  (algoritmus „skyline“).
- Ellis (2007): *Beat tracking by dynamic programming*. J. New Music Research 36(1).
