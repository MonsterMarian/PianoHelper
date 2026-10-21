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
| – | stejný prst na jiné klávese: legato | 10 + vzdálenost |
| – | … oddělené tóny (pauza *g*) | 1 + 0,3·vzdálenost + 5·max(0; 1 − g/0,6 s) |
| – | … akord → akord (posun celého tvaru) | 1 + 0,3·vzdálenost |
| – | souzvuk jinak než podle učebnice | 2 (trojzvuk) / 1 (dvojzvuk) |
| – | mimo MaxPrac / MinPrac (nehratelné) | 50 |

### Pravidla pro černé a bílé klávesy (rešerše)

- Palec a malíček patří na bílé klávesy, dlouhé prsty 2–3–4 na černé
  ([Yamaha](https://hub.yamaha.com/keyboards/k-how-to/the-basics-of-piano-keyboard-fingering/),
  [pianoscales.org](https://www.pianoscales.org/fingerings.html)). V modelu palec na černé v melodii
  5 bodů, malíček na černé 1 bod.
- **Výjimka: akordy a oktávy.** Tam je palec na černé běžný (kvintakord B♭ dur), proto jen 1 bod.
- **Malíček na začátek, konec nebo obrat** pasáže
  ([R. Kelley](https://robertkelleyphd.com/home/arpfing.htm)). Krajní tón tam s malíčkem nic nestojí.
- Podklad palce je nejpřirozenější z černé klávesy na bílou; z bílé na bílou (E→F v C dur)
  stojí víc (2 + 0,5 bodu).

Test: **všech 12 durových stupnic v obou rukou**. Palec smí být jen na tónech, kde ho mají
učebnice (ABRSM), a nikdy na černé. Výsledek: 24/24 (1 oktáva).

## Kde se model liší od Parncutta (a proč)

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
- **Stejný prst na jiné klávese je drahý jen při legatu.** Krátké akordy s pauzou (staccato
  doprovod) se hrají tak, že ruka drží tvar a přesune se celá. U Ma Meilleure Ennemie původní
  cena (10 bodů vždy) vedla k 4-2-1 na E-G-H, aby se ruka nemusela hnout. Klavírista ale hraje
  5-3-1 a ruku posune. U jednotlivých tónů s krátkou pauzou se pořád vyplatí spíš vyměnit prst
  a nechat ruku na místě (pro začátečníka jednodušší). Po pauze delší než 0,6 s je přesun volný.
- **Učebnicové prstoklady souzvuků** (Alfred, Bastien, Faber):

  | souzvuk | pravá | levá |
  |---|---|---|
  | kvintakord (tercie + tercie) | 1-3-5 | 5-3-1 |
  | sextakord, 1. obrat (tercie + kvarta) | 1-2-5 | 5-3-1 |
  | kvartsextakord, 2. obrat (kvarta + tercie) | 1-3-5 | 5-2-1 |
  | kvinta až oktáva | 1-5 | 5-1 |

  V zrcadlených souřadnicích levé ruky je to jedna tabulka. Jiný prstoklad stojí 2 body (trojzvuk)
  nebo 1 bod (dvojzvuk), takže se použije jen tehdy, když ho vynutí okolí.
- **Pauza dává ruce čas.** Když mezi notami je pauza, cena přechodu se násobí
  `max(0,15; 1 − pauza / 0,8 s)`. Po pauze se ruka smí volně přesunout.

- **Skok větší než kvinta = přesun ruky.** Ruka se při skoku přenese celá, takže se nepočítá
  natažení prstů, ale jen přesun: cena `min(Parncutt; 3 + 0,15·vzdálenost)`.
- **Rozklady akordů (úroveň 4)** mají v levé ruce měkkou nápovědu 5-2-1-2 (jiný prstoklad stojí
  málo, ne zákaz).

## Audit na reálných skladbách

`audit2.mjs` projde 18 skladeb × 5 úrovní (51 647 událostí) a počítá chyby, které by učitel
opravil. Před a po úpravách výše:

| chyba | před | po |
|---|---|---|
| palec na černé v krokové melodii | 311 | 260 |
| stejný prst legato na jiné klávese | 200 | 97 |
| křížení prstů bez palce | 43 | 0 |
| rozpětí přes mez ruky | 53 | 3 |

Zbylé „palce na černé“ jsou hlavně v rychlých pasážích s mnoha černými (B♭ moll apod.), kde to
učebnice také připouští; zbylé „stejné prsty“ jsou přechody mezi rozklady.

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
| Ma Meilleure Ennemie, LR: Em – Hm/D – Am/C (staccato) | 5-3-1, 5-3-1, 5-3-1 (posun ruky) | ✔ |
| obraty v PR: E-G-C / G-C-E, v LR: G-C-E | 1-2-5 / 1-3-5, 5-2-1 | ✔ |

## Omezení a plán

- Pravidla neznají **tempo**. U rychlých opakovaných tónů pianisté střídají prsty (3-2-1);
  model nechá stejný prst, což je pro začátečníka jednodušší.
- Nepočítá s **výměnou prstu na držené klávese** (tichá výměna) ani s glissandem.
- Další krok: dotrénovat váhy na datasetu PIG (150 skladeb s prstoklady od pianistů)
  a měřit shodu.
