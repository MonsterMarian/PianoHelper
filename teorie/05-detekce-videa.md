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
3. **Hranice bílých kláves** = tmavé dělicí čáry. Šířka klávesy se bere z autokorelace
   (s kontrolou poloviční periody, protože šířky se střídají 30/31 px). Chybějící hranice se
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

## Výsledky

| video | styl | klávesy | not | čas |
|---|---|---|---|---|
| Fourth of July (UVnXmLGu4cI) | černé pozadí, popisky pod klávesami, 2 barvy | E2–D6, vzor 100 % | 734, ruce L 172 / R 557 | ~30 s / 5,5 min videa |
| Ma Meilleure Ennemie (SFyKbYbpHkc) | obrázek na pozadí, poloprůhledná klávesnice, krátké noty s písmenem | A2–F♯6, vzor 100 % | 1138 | ~40 s / 2,5 min |
| syntetické (test) | známé noty | E2–D6 | 12/12, začátky ±1 snímek, ruce 12/12 | 1 s |

## Omezení

- Potřebuje klávesnici ve videu, která se barví (nebo noty dopadající na linii). Videa reálného
  piána převádí `--audio` (basic-pitch), což je méně přesné.
- Rychlost = rychlost dekódování videa (~3,5 ms/snímek při 480p).
- Pokud video celou dobu nemá zvuk, oktáva zůstane odhadem. Dá se zadat ručně
  `--start-note E2` (nejlevější bílá klávesa).
