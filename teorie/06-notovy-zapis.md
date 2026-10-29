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
3. **Dva hlasy na osnovu:** noty se stejným začátkem tvoří akord. Nota, která zní aspoň dobu
   přes další nástup v téže ruce (bas pod rozkladem, držený tón melodie), jde do 2. hlasu
   (horní osnova hlasy 1–2, dolní 5–6 jako v MuseScore), takže se nezkrátí. Pomlky 2. hlasu se
   netisknou a takt, kde 2. hlas nic nehraje, ho nemá. Jinak se nota přes začátek dalšího
   akordu zkrátí na něj. Mezery se vyplní pomlkami. Dřív (jeden hlas) export zkrátil 2,3 % not
   v úrovních Pokročilé a Mistr – právě držený bas, který tam aranžmá přidává.
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

Po přidání 2. hlasu (2026-10-29): celá knihovna 19 skladeb × 5 úrovní (95 souborů) – každý hlas
v každém taktu má délku taktu, počet not sedí, 982 taktů má 2. hlas; music21 na Ódě, Levels
a Fourth of July (15 souborů): počet not i délky hlasů bez chyby. Test: držený bas pod
rozkladem zůstane celou notou v hlase 6. Vizuálně (OpenSheetMusicDisplay v headless Chrome):
Óda, Pokročilé, takty 1–4 – bas celou notou ve 2. hlase, nad ním rozklad v osminách.

Vizuálně v OpenSheetMusicDisplay: Óda na radost, úroveň 2 = melodie 3 3 4 5 | 5 4 3 2 | …
se správným rytmem (čtvrťová s tečkou + osmina + půlová), levá ruka celé noty C | G | C | G.

## Omezení (shortcut)

- **Nejvýš dva hlasy na osnovu.** Dvě držené noty s různým začátkem přes sebe ve 2. hlase se
  pořád zkrátí na začátek té pozdější. V knihovně 21 not z 63 239 (0,03 %), proto 3. hlas
  nepřidáváme.
- **Šestnáctinová mřížka.** Trioly a složené takty (6/8) se zaokrouhlí na nejbližší
  šestnáctinu. Řešení: detekce triol (dělení doby na 3) a `<time-modification>`.
- Trámce (spojení osmin a šestnáctin) se nezapisují, dopočítá je notační program sám.
