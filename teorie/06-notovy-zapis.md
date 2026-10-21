# 06 – Notový zápis (export MusicXML)

Tlačítko **Stáhnout noty (MusicXML)** v přehrávači uloží aktuální obtížnost jako notový zápis:
dvě osnovy (houslový a basový klíč), předznamenání, takt, tempo a **prstoklad nad notami**.
Soubor otevře MuseScore (zdarma), Finale, Dorico, Sibelius i online flat.io; odtud jde
vytisknout nebo exportovat do PDF či MIDI. Kód: `web/js/musicxml.js`.

## Postup

1. **Kvantizace:** čas noty se převede na pozici v dobách podle pole dob ze sledování
   (doba *i* + zlomek mezi dobou *i* a *i+1*), takže zápis sedí i při proměnném tempu.
   Zaokrouhluje se na šestnáctiny (4 dílky na dobu).
2. **Osnovy:** pravá ruka nahoře, levá dole (přehozené noty jsou v osnově ruky, která je hraje).
3. **Jeden hlas na osnovu:** noty se stejným začátkem tvoří akord. Když nota zní přes začátek
   dalšího akordu, zkrátí se na něj. Mezery se vyplní pomlkami.
4. **Takty a ligatury:** nota přes taktovou čáru se rozdělí a sváže ligaturou. Délky, které
   nejsou zapisovatelné jednou hodnotou (např. 5/16), se rozloží na zapisovatelné
   (čtvrťová + šestnáctina) spojené ligaturou.
5. **Pravopis:** předznamenání podle tóniny (Krumhansl–Kessler, z originálu, takže všechny
   úrovně mají stejné). V tóninách s béčky se černé klávesy píšou jako ♭ (B♭), jinak jako ♯.
6. **Prstoklad** (`<fingering>`) u první části každé noty.

## Ověření

Pro 3 skladby × 5 úrovní (15 souborů) se zápis načetl knihovnou `music21` a zkontrolovalo se:

- každý takt v obou osnovách má přesně délku taktu (0 chyb),
- počet a výšky not = noty v přehrávači (0 ztracených, 0 navíc),
- každá nota má prstoklad.

Vizuálně v OpenSheetMusicDisplay: Óda na radost, úroveň 2 = melodie 3 3 4 5 | 5 4 3 2 | …
se správným rytmem (čtvrťová s tečkou + osmina + půlová), levá ruka celé noty C | G | C | G.

## Omezení (shortcut)

- **Jeden hlas na osnovu.** Držená nota, pod kterou se pohybuje jiný hlas, se zkrátí. Řešení:
  druhý `<voice>` pro držené noty.
- **Šestnáctinová mřížka.** Trioly a složené takty (6/8) se zaokrouhlí na nejbližší
  šestnáctinu. Řešení: detekce triol (dělení doby na 3) a `<time-modification>`.
- Trámce (spojení osmin a šestnáctin) se nezapisují, dopočítá je notační program sám.
