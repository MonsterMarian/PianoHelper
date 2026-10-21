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
| [06-notovy-zapis.md](06-notovy-zapis.md) | export do notového zápisu (MusicXML) s prstokladem | `musicxml.js` |

## Jak to do sebe zapadá

```
video ──► noty (výška, začátek, konec, ruka podle barvy)            note_detector.py
            │
            ▼
      analýza: sledování dob (i proměnné tempo), takt, akordy, tónina analysis.js
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
      notový zápis: MusicXML s prstokladem                          musicxml.js
```

Všechno po analýze běží v prohlížeči, takže funguje i pro libovolný `.mid` soubor, nejen pro
převedená videa.

## Stav (co je hotové a ověřené)

- [x] Detekce klávesnice podle vzoru černých kláves; oktáva podle zvuku. Test: syntetické video
      se známými notami + 2 reálná videa různého stylu.
- [x] **Sledování dob s proměnným tempem** (dopředu + zpětný průchod), takt 3/4 / 4/4 podle
      indexů dob. Testy: 3/4 a 4/4 s chvěním ±15 ms, zrychlení 84 → 132 BPM s rubatem.
- [x] **Akordy přes Viterbi** s cenou změny podle metrické váhy doby; melodie váží méně, bas
      preferuje základ. Test: Óda na radost C | G | C | G i přes průchodné tóny.
- [x] Úrovně 1–5 s testy invariant (úroveň 1 hraje jednu notu naráz, levá ruka je pod melodií,
      rozpětí ruky ≤ oktáva…). **Úroveň 3 s vedením hlasů** (horní hlas skáče ≤ 4 půltóny).
- [x] Prstoklad: učebnicové výsledky pro stupnice C, G, D a F dur v obou rukou, dvě oktávy C dur,
      kvintakordy, pětiprstovou polohu a Ódu na radost.
- [x] Přehození noty do druhé ruky, když by akord přesáhl oktávu (a označení v UI).
- [x] **Export notového zápisu** (MusicXML) s prstokladem. 15 souborů ověřeno přes music21:
      délky taktů, výšky a počty not sedí.
- [x] Zvuk ověřen měřením signálu na výstupu přehrávače (headless Chrome, 30/30 vzorků).
- [x] **Režim „čekej na mě“**: čas se zastaví 4 ms před akordem, dokud hráč nezahraje jeho tóny
      (MIDI nebo klávesnice počítače); špatná klávesa svítí červeně, správné mají kroužek.

## Plán dalších zlepšení (seřazeno podle přínosu)

1. **Hlasy místo „nejvyšší noty“.** Melodie je teď nejvyšší tón pravé ruky. U obou
   testovaných videí to stačí (pravá ruka hraje skoro jednohlasně). Pro skladby, kde je
   melodie uprostřed nebo v levé ruce, by bylo potřeba rozdělit noty na hlasy
   (Chew & Wu 2004) a vybrat ten nejzpěvnější.
2. **Prstoklad z dat.** Pravidla dávají učebnicové výsledky na stupnicích a jednoduchých
   melodiích. U rychlých pasáží by pomohl statistický model z datasetu PIG
   (Nakamura et al. 2020). Dataset je ke stažení po odsouhlasení licence, to musí udělat
   uživatel.
3. **Druhý hlas a trioly v notovém zápisu** (viz 06-notovy-zapis.md).
4. Hodnocení hraní v režimu „čekej na mě“ (přesnost, zpoždění, nejčastější chyby po úsecích).
5. Volitelná transpozice do „bílé“ tóniny (C dur / a moll) pro úplné začátečníky.

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
