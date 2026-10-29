# 05 – Detekce not z videa

Kód: `note_detector.py`, `audio_octave.py`, test `tests/test_detector.py`.

## Proč se to přepisovalo

Původní detektor bral jako znějící notu cokoli barevného v pásu **55 % výšky obrazu nad
klávesnicí**. Nota tedy „zněla“ po celou dobu pádu: průměrná délka vycházela 3,3 s a začátky byly
posunuté o dobu pádu. Klávesnici navíc hledal pevným prahem, takže chytal pruh s popisky
kláves místo kláves.

## Jak to funguje teď

1. **Medián 30 snímků** (5–90 % délky videa): padající noty, záblesky i ruce zmizí a zůstane
   čistá klávesnice. Čte se sekvenčně, protože skok na snímek (seek) trvá u některých souborů
   přes 1 s.
2. **Pás bílých kláves** = nejdelší blok světlých řádků; **pás černých** = řádky nad ním,
   kde je světlo i tma.
3. **Bílé klávesy dvěma metodami,** použije se ta, které líp sedí vzor černých kláves:
   - A) dělicí čáry mezi bílými klávesami,
   - B) mřížka z poloh černých kláves (5 mezer mezi černými = 1 oktáva = 7 bílých), když jsou
     dělicí čáry skoro neviditelné (PianoGumi: 255 → 240).

   **Hranice bílých kláves (A)** = tmavé dělicí čáry. Šířka klávesy se bere z autokorelace
   (s kontrolou 1/2, 1/3 a 1/4 periody, protože neceločíselná šířka 26,7 px dá nejvyšší vrchol
   u trojnásobku 80 px). Chybějící hranice se
   doplní do pravidelné mřížky.
4. **Které C je C:** za každou bílou klávesou se zjistí, jestli po ní následuje černá. Vzor
   „2 černé, mezera, 3 černé, mezera“ jednoznačně určí název každé klávesy. Shoda vzoru se
   vypisuje (100 % u obou testovaných videí).
5. **Oktáva** se z obrazu určit nedá. Odhad: střed klávesnice nejblíž E4. Pak se ověří
   **podle zvuku** (`audio_octave.py`): pro posun −2…+2 oktávy se změří, jak při nástupech
   not vzroste energie na jejich harmonických (1.–6., váhy 0,8^k). O oktávu výš chybí liché
   harmonické, o oktávu níž chybí základní tón. Test: uměle posunuté noty ±12 metoda na obou
   videích vrátí zpět.
6. **Každý snímek:** průměrná barva každé klávesy (bílá pod černými, černá uprostřed).
   **Rozsvícená** = barva se liší od **klouzavého mediánu** (±8 s) o víc než 40. Klouzavý
   medián zvládne poloprůhlednou klávesnici i měnící se pozadí. Když se „rozsvítí“ přes
   polovinu kláves, jde o prolínačku nebo titulek, ne o noty.
7. **Záloha:** když se klávesy nebarví, čte se pruh těsně nad klávesnicí (linie dopadu).
8. **Noty** = souvislé úseky rozsvícení. Mezera i jeden snímek = nová nota, proto se čte každý
   snímek: opakované tóny mají mezeru 1–3 snímky. Začátky akordu do 1,5 snímku se sjednotí.
9. **Ruce podle barvy** (viz [03-ruce.md](03-ruce.md)).
10. **Snímky bez klávesnice** (úvodní karta, titulky, přechod): když se většina kláves liší od
    mediánového snímku, dosadí se do snímku klidová klávesnice. Jinak by se je klouzavý medián
    naučil jako „pozadí“ a změny textu by vypadaly jako noty; úvod navíc přepínal detektor do
    režimu „ruce zakrývají klávesy“. Climax☆JUMPING (6 s úvod + závěrečná karta): 32 falešných
    not → 0, kontrola proti zvuku 91,7 % → 100 %.

### Natočené piano s rukama (Pianella apod.)

Skutečné piano snímané shora, ruce hrají, noty padají na zářící linku a při dopadu bliknou.

- **Klávesnice:** linka nad klávesami je jasnější než šedavé bílé klávesy. Mediánový filtr přes
  ~1/60 výšky obrazu ji smaže, takže se jako pás bílých kláves najdou klávesy. Obraz tmavne ke
  krajům (vinětace), proto se sloupce před hledáním kláves zesvětlí podle obálky jasu bílých
  kláves (nejvýš 4×).
- **Poznání:** u Synthesie se linka nad klávesou mění 2–3× víc než klávesa (poměr změn
  klávesy / linky 0,30–0,52 u všech 18 Synthesia videí v knihovně). Když se klávesy mění víc
  než linka, ale nejvýš 4× víc (Levels: 1,23), zakrývají je ruce a noty se čtou ze záblesků nad
  klávesnicí. Linka, která se skoro nemění (statický filc nad klávesami, noty dopadají na něj),
  záblesky nemá – tam se čtou klávesy. Dřív takové video dalo 0 not.
- **Záblesk** při dopadu rozsvítí i 2 sousední klávesy na každou stranu, ale jen na 3 snímky.
  Nota = skok jasu (začátek) + klávesa, která svítí ještě 0,15 s potom a víc než oba sousedé.
  Opakovaný akord nezhasne, proto nota končí i dalším úhozem **téže** klávesy – záblesk
  sousední noty, který potom svítí víc, drženou notu neukončí (dřív ji usekl) a rychle
  opakované tóny se nepřekrývají (Levels: 702 → 0 přesahů). Bílá klávesa se měří jen v části,
  nad kterou nedopadají černé noty. Pozor na hranice: černá klávesa, která začíná o pixel
  vedle hranice bílé, se dřív nevyřízla a H5 pak svítilo i od noty A♯5 a obdélníku na hranici
  H5/C6 – z toho bylo 36 falešných C6. Teď se černá odřízne podle toho, na které straně středu
  bílé leží. Kontrola proti zvuku: 98,1 % → 99,3 % not zní, falešných 49 → 17.

### Kontrola proti zvuku (`tools/eval_detekce.py`)

Zvuková stopa videa se převede na noty knihovnou **basic-pitch** (na Pythonu 3.14 nejde, proto
zvlášť v `output/venv-bp` s Pythonem 3.10; postup v hlavičce nástroje) a noty z obrazu se s nimi
spárují podle výšky a začátku (±50 ms, po odečtení posunu obrazu proti zvuku). Vychází přesnost
(kolik detekovaných not je ve zvuku) a úplnost (kolik not ze zvuku detekce našla) – **po notách**.
basic-pitch sám chybuje, takže čísla slouží hlavně k porovnání dvou verzí na stejném videu.

| video | posun obrazu | přesnost | úplnost |
|---|---|---|---|
| Fourth of July (Synthesia, kontrola nástroje) | −96 ms | 99,2 % | 59,4 % (EASY verze nehraje vše, co je slyšet) |
| Levels, natočené piano | −130 ms | 59,1 % | 64,0 % |

Co tím vyšlo na Levels (2026-10-29): dvě pravidla, která jsme přidali podle hrubší metriky
(nárůst energie na harmonických), detekci **zhoršila** a jsou pryč:

- záloha pro krátké noty (klávesa svítí jen pár snímků po záblesku): 65 not, ve zvuku 5,
- sloučení držené noty se „širokým“ zábleskem souseda: ze 133 zahozených úhozů 91 ve zvuku je
  (úplnost 64,3 % → 60,4 %).

Parametry záblesků (0,15 s po úhozu, jas +100, skok +30) jsou na plató: mřížka 0,1–0,2 s × 80–120
× 20–40 dá F1 nejvýš 0,615 proti 0,614; 0,2 s je výrazně horší (0,47).

## Výsledky

| video | styl | klávesy | not | čas |
|---|---|---|---|---|
| Fourth of July (UVnXmLGu4cI) | černé pozadí, popisky pod klávesami, 2 barvy | E2–D6, vzor 100 % | 734, ruce L 172 / R 557 | ~30 s / 5,5 min videa |
| Ma Meilleure Ennemie (SFyKbYbpHkc) | obrázek na pozadí, poloprůhledná klávesnice, krátké noty s písmenem | A2–F♯6, vzor 100 % | 1138 | ~40 s / 2,5 min |
| Avicii – Levels, Pianella (PSolYNrEiWc) | natočené piano s rukama, vinětace, záblesky | A0–C8, vzor 100 % | 2524; proti zvuku (basic-pitch) přesnost 59 %, úplnost 64 % | ~1 min / 3,5 min |
| syntetické (test) | známé noty | E2–D6 | 12/12, začátky ±1 snímek, ruce 12/12 | 1 s |

## Omezení

- Potřebuje klávesnici ve videu, která se barví, nebo noty dopadající na linii (i u natočeného
  piana). Videa bez padajících not převádí `--audio` (basic-pitch), což je méně přesné.
- Záblesky: noty kratší než ~0,15 s se nenajdou (po záblesku už nesvítí). Pokus je dohledat
  přidával hlavně falešné noty (viz kontrola proti zvuku).
- Záblesky: držená nota, kterou rozsvítí záblesk souseda a pak svítí nejvíc, se rozdělí na dvě.
  Z obrazu to od opakovaného úhozu odlišit nejde a zvuk říká, že většina takových úhozů je
  skutečná, proto se nic neslučuje.
- Záblesky: dvě sousední půltónové noty naráz se poznají jako jedna. Změřeno na Levels
  (2026-10-29): 294 kandidátů (úhoz, který svítí, ale soused o půltón uhozený naráz svítí víc)
  ve zvuku „zní“ stejně často jako tatáž chvíle posunutá o 3 půltóny (46 % / 45 %; přijaté
  noty 58 % / 35 %), takže to nejsou ztracené noty; jen 29 kandidátů s velkým rozdílem jasu
  ukazuje signál (45 % / 24 %, ~1 % not) – na pravidlo z jednoho videa málo (měřeno ještě
  hrubší metrikou, s basic-pitch to stojí za přeměření); bílá klávesa mezi dvěma
  černými notami těsně po sobě občas vyjde navíc (< 1 % not). Pravidlo „bílá mezi dvěma
  hranými černými musí svítit víc než ony“ jsme zkusili a zahodili: záblesk samotné noty A
  rozsvítí i G♯ a A♯, takže by mazalo skutečná A (83 skutečných not za 1 falešnou). Větší
  tolerance pro sousední půltóny (aby šly dva sousední tóny naráz) nepomůže: záře saturuje
  sousedy na stejný jas, tolerance 8 / 15 / 30 = přesnost 92 / 82 / 71 % místo 99 %.
- Rychlost = rychlost dekódování videa (~3,5 ms/snímek při 480p).
- Pokud video celou dobu nemá zvuk, oktáva zůstane odhadem. Dá se zadat ručně
  `--start-note E2` (nejlevější bílá klávesa).
