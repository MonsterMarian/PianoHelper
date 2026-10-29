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
  Kratší nota (staccato, šestnáctiny) stačí, když po záblesku sousedé zhasnou a ona ještě svítí;
  kratší než `min_note_duration` se zahodí. Opakovaný akord nezhasne, proto nota končí i dalším
  úhozem **téže** klávesy – záblesk sousední noty drženou notu neukončí (dřív ji usekl)
  a rychle opakované tóny se nepřekrývají. Krátká nota se bere jen na klávese, která před
  úhozem nesvítila (jinak by záblesk souseda rozdělil drženou notu). Levels po opravách
  (review 2026-10-29): 2524 → 2631 not (+107 krátkých), noty přesahující další úhoz téže
  klávesy 702 → 0; všech 18 Synthesia videí beze změny počtu not. Bílá klávesa se měří jen
  v části, nad kterou nedopadají černé noty. Pozor na hranice: černá klávesa, která začíná o pixel
  vedle hranice bílé, se dřív nevyřízla a H5 pak svítilo i od noty A♯5 a obdélníku na hranici
  H5/C6 – z toho bylo 36 falešných C6. Teď se černá odřízne podle toho, na které straně středu
  bílé leží. Kontrola proti zvuku: 98,1 % → 99,3 % not zní, falešných 49 → 17.

## Výsledky

| video | styl | klávesy | not | čas |
|---|---|---|---|---|
| Fourth of July (UVnXmLGu4cI) | černé pozadí, popisky pod klávesami, 2 barvy | E2–D6, vzor 100 % | 734, ruce L 172 / R 557 | ~30 s / 5,5 min videa |
| Ma Meilleure Ennemie (SFyKbYbpHkc) | obrázek na pozadí, poloprůhledná klávesnice, krátké noty s písmenem | A2–F♯6, vzor 100 % | 1138 | ~40 s / 2,5 min |
| Avicii – Levels, Pianella (PSolYNrEiWc) | natočené piano s rukama, vinětace, záblesky | A0–C8, vzor 100 % | ≈ 2500; kontrola proti zvuku: 99 % not zní | ~1 min / 3,5 min |
| syntetické (test) | známé noty | E2–D6 | 12/12, začátky ±1 snímek, ruce 12/12 | 1 s |

## Omezení

- Potřebuje klávesnici ve videu, která se barví, nebo noty dopadající na linii (i u natočeného
  piana). Videa bez padajících not převádí `--audio` (basic-pitch), což je méně přesné.
- Záblesky: krátký úhoz vedle držené noty, která svítí slaběji, ji pořád rozdělí na dvě
  (při kontrole 0,15 s po úhozu svítí držená nota víc než zhaslý soused).
- Záblesky: dvě sousední půltónové noty naráz se poznají jako jedna; bílá klávesa mezi dvěma
  černými notami těsně po sobě občas vyjde navíc (< 1 % not). Pravidlo „bílá mezi dvěma
  hranými černými musí svítit víc než ony“ jsme zkusili a zahodili: záblesk samotné noty A
  rozsvítí i G♯ a A♯, takže by mazalo skutečná A (83 skutečných not za 1 falešnou). Větší
  tolerance pro sousední půltóny (aby šly dva sousední tóny naráz) nepomůže: záře saturuje
  sousedy na stejný jas, tolerance 8 / 15 / 30 = přesnost 92 / 82 / 71 % místo 99 %.
- Rychlost = rychlost dekódování videa (~3,5 ms/snímek při 480p).
- Pokud video celou dobu nemá zvuk, oktáva zůstane odhadem. Dá se zadat ručně
  `--start-note E2` (nejlevější bílá klávesa).
