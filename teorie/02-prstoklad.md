# 02 – Prstoklad

Cíl: u každé noty ukázat, kterým prstem ji hrát (1 = palec, 2 = ukazováček, 3 = prostředníček,
4 = prsteníček, 5 = malíček), a to **co nejjednodušeji**. Ruka má zůstat v jedné poloze, palec
má podkládat jen tam, kde je to nutné. Kód: `web/js/fingering.js`.

## Pravidla, která učí klavíristé

1. **Pětiprstová poloha.** Pět sousedních bílých kláves = pět prstů (C D E F G = 1 2 3 4 5).
   Dokud se melodie vejde do polohy, ruka se nehýbe.
2. **Podklad palce a překládání.** Ve stupnici nahoru se palec podsune pod 3. nebo 4. prst
   (C dur: 1 2 3 **1** 2 3 4 5). Dolů se 3. nebo 4. prst překládá přes palec.
3. **Palec ani malíček na černé klávese, pokud to jde.** Palec je krátký, na černé klávese
   táhne ruku dopředu. Proto F dur hraje B čtvrtým prstem: 1 2 3 **4** 1 2 3 4.
4. **Kvintakord:** pravá 1-3-5, levá 5-3-1. Oktáva 1-5.
5. **Stejný prst na dvou různých klávesách po sobě** přeruší legato. Je dovolený jen po pauze
   nebo při skoku.
6. **4. a 5. prst jsou slabší**, ale v poloze se používají normálně.
7. **Levá ruka je zrcadlo pravé:** stupnice nahoru 5 4 3 2 1 3 2 1.

## Model: ceny a nejlevnější cesta

Každý prstoklad dostane **cenu** (čím vyšší, tím nepohodlnější) a algoritmus hledá posloupnost
prstů s nejnižší celkovou cenou. Pravidla a tabulka rozpětí jsou podle Parncutta et al. (1997).

### Tabulka rozpětí (pravá ruka, v půltónech)

| prsty | MinPrac | MinComf | MinRel | MaxRel | MaxComf | MaxPrac |
|---|---|---|---|---|---|---|
| 1-2 | −5 | −3 | 1 | 5 | 8 | 10 |
| 1-3 | −4 | −2 | 3 | 7 | 10 | 12 |
| 1-4 | −3 | −1 | 5 | 9 | 12 | 14 |
| 1-5 | −1 | 1 | 7 | 10 | 13 | 15 |
| 2-3 | 1 | 1 | 1 | 2 | 3 | 5 |
| 2-4 | 1 | 1 | 3 | 4 | 5 | 7 |
| 2-5 | 2 | 2 | 5 | 6 | 8 | 10 |
| 3-4 | 1 | 1 | 1 | 2 | 2 | 4 |
| 3-5 | 1 | 1 | 3 | 4 | 5 | 7 |
| 4-5 | 1 | 1 | 1 | 2 | 3 | 5 |

*Rel* = uvolněná ruka, *Comf* = ještě pohodlné, *Prac* = fyzicky možné. Záporné hodnoty =
palec pod/přes prst.

### Pravidla (body)

| # | pravidlo | cena |
|---|---|---|
| 1 | natažení mimo Comf | 2 za půltón |
| 2 | malé rozpětí pod Rel (ne při podkladu palce) | 1 (palec) / 2 za půltón |
| 3 | velké rozpětí nad Rel | 1 (palec) / 2 za půltón |
| 4 | změna polohy (1. a 3. nota mimo Comf) | 1, plná změna s podkladem 2 |
| 5 | velikost změny polohy | 1 za půltón |
| 6 | slabý prst 4 nebo 5 | 0,5 |
| 7 | 3-4-5 po sobě | 0,5 |
| 8 | 3 → 4 | 0,5 |
| 9 | 4 na černé hned vedle 3 na bílé | 1 |
| 10 | palec na černé (+2 když soused je bílý) | 1 + 2 + 2 |
| 11 | malíček na černé vedle bílé | 2 |
| 12 | podklad palce: stejná úroveň / palec na černé | 0,5 + 1 / 0,5 + 3 |
| – | stejný prst na jiné klávese | 10 + vzdálenost |
| – | mimo MaxPrac / MinPrac (nehratelné) | 50 |

### Kde se model liší od Parncutta (a proč)

Původní váhy byly ověřené na krátkých melodiích. Na stupnicích ale vybíraly nesmysly, proto jsou
upravené. Každá změna má test v `tests/theory.test.mjs`:

- **Pravidlo 2 neplatí pro podklad palce** (Jacobs 2001). Podklad není „stísněná ruka“; jeho
  cenu nese pravidlo 12 a natažení. Bez toho bylo „1 1 2 1 2“ levnější než „1 2 3 1 2“.
- **Pravidla 6, 7 a 8 na polovinu.** Jinak model raději překládal, než aby použil 4. a 5.
  prst, a Ódu na radost hrál s překládáním místo v poloze C.
- **Každý podklad +0,5.** Při jinak stejné ceně vyhraje varianta s méně podklady
  (F dur 1234 1234 místo 2123 1231).
- **Stejný prst na jiné klávese = 10 + vzdálenost.** Parncutt tento případ vůbec nezná
  (předpokládá legato). Bez penalizace by model jezdil palcem po sousedních klávesách.
- **Malíček na krajní notě akordu se nepočítá jako slabý prst**, aby vyhrálo 1-3-5 nad 1-2-4.
- **Pauza dává ruce čas.** Když mezi notami je pauza, cena přechodu se násobí
  `max(0,15; 1 − pauza / 0,8 s)`. Po pauze se ruka smí volně přesunout.

## Algoritmus

1. Noty jedné ruky se seskupí do **událostí** (noty začínající do 35 ms od sebe = akord).
2. Pro akord s *k* notami jsou možné prstoklady všechny rostoucí *k*-tice prstů
   (C(5, k), nejvýš 10). Cena akordu = pravidla 1–3 pro dvojice uvnitř + pravidla 6 a 10.
3. **Přechod** mezi událostmi: každá nota nové události se porovná s notou předchozí události
   hranou stejným prstem (když existuje), jinak s nejbližší výškou. Ceny se zprůměrují.
4. **Viterbi 2. řádu:** stav = (prstoklad předchozí události, prstoklad aktuální). Díky tomu jdou
   započítat pravidla pro tři noty (4, 5, 7). Složitost O(n · 10³), pro 1 000 událostí
   do 50 ms.
5. **Levá ruka** = výšky se zrcadlí (p → −p), barva klávesy se bere z původní výšky.

## Ověření

| vstup | výsledek | učebnice |
|---|---|---|
| C dur nahoru, PR | 1 2 3 1 2 3 4 5 | ✔ |
| C dur dolů, PR | 5 4 3 2 1 3 2 1 | ✔ |
| C dur nahoru, LR | 5 4 3 2 1 3 2 1 | ✔ |
| G dur, D dur, PR | 1 2 3 1 2 3 4 5 | ✔ |
| F dur, PR | 1 2 3 4 1 2 3 4 | ✔ |
| C dur 2 oktávy | 1 2 3 1 2 3 4 1 2 3 1 2 3 4 5 | ✔ |
| C E G | PR 1 3 5 / LR 5 3 1 | ✔ |
| Óda na radost | 3 3 4 5 5 4 3 2 1 1 2 3 3 2 2 | ✔ |

## Omezení a plán

- Pravidla neznají **tempo**. U rychlých opakovaných tónů pianisté střídají prsty (3-2-1);
  model nechá stejný prst, což je pro začátečníka jednodušší.
- Nepočítá s **výměnou prstu na držené klávese** (tichá výměna) ani s glissandem.
- Další krok: dotrénovat váhy na datasetu PIG (150 skladeb s prstoklady od pianistů)
  a měřit shodu.
