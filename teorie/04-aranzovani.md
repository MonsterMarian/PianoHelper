# 04 – Aranžování: úrovně obtížnosti 1–5

Kód: `web/js/arrange.js`. Vstup = noty skladby (s rukama), výstup = noty pro danou úroveň
s rukou a prstem.

Hlavní myšlenka: **čím je verze snazší, tím méně not se hraje naráz a tím méně se ruka
pohybuje. Melodie (to, co si člověk zpívá) ale zůstává.**

| úroveň | pravá ruka | levá ruka | pro koho |
|---|---|---|---|
| 1 Melodie | jen melodie | nic | první seznámení, nácvik melodie |
| 2 Snadné | melodie | 1 basový tón na takt (a při změně akordu delší než 2 doby) | začátečník, obě ruce |
| 3 Střední | melodie | základ + kvinta na každou půlku taktu (ve 3/4 na takt) | mírně pokročilý |
| 4 Originál | jak ve videu | jak ve videu | — |
| 5 Pokročilé | + oktávy pod dlouhými tóny melodie | držené basy → rozložené akordy v osminách | pokročilý |

## Kroky

### Melodie („skyline“)

1. V každém nástupu pravé ruky se vezme **nejvyšší tón**. Melodie bývá nahoře; tento postup
   (Uitdenbogerd & Zobel 1999) je jednoduchý a u popových tutoriálů funguje dobře.
2. **Vnitřní hlas pryč:** tón, který začne pod ještě znějícím vyšším tónem melodie, je doprovod.
3. **Ozdoby pryč:** tón kratší než ¼ doby, po kterém do ¼ doby následuje sousední tón
   (o 1–2 půltóny), je příraz nebo trylek.
4. **Legato:** tón drží do dalšího tónu melodie, nejdéle však původní délku. Rytmus se tedy
   nemění, jen zmizí mezery mezi tóny.

### Bas (úroveň 2)

Podle mřížky z [01-analyza.md](01-analyza.md) a akordů:

- sloty = začátky taktů (a začátek akordu, pokud trvá ≥ 2 doby; kratší změna uprostřed taktu
  se vynechá),
- tón = **nejnižší původní tón levé ruky**, pokud patří do akordu (zachová se basová linka
  i obraty), jinak **základ akordu** v rozsahu C2–B3,
- strop = nejnižší tón melodie v daném úseku − 3 půltóny, aby se ruce nesrazily.

### Kvinty (úroveň 3)

Jako úroveň 2, ale slot je půlka taktu a k basu přibude kvinta (+7 půltónů), pokud nepřekročí
strop. Kvinta (bez tercie) zní dobře u dur i moll a v ruce je to pořád stejný tvar
(prsty 5 + 1 nebo 5 + 2), což je pro začátečníka ideální.

### Ozdoby (úroveň 5)

- **Oktávy:** pod tón melodie delší než ~1 doba se přidá tón o oktávu níž, pokud pod ním
  v pravé ruce nic není a ruka se vejde do oktávy.
- **Rozložené akordy:** držený basový tón levé ruky (≥ 2 doby, patří do akordu) se nahradí
  osminovým vzorem *základ – kvinta – oktáva – kvinta*, tzv. Albertiho/„pop“ bas.
  Tóny nad melodii se vynechají.

### Nakonec pro každou úroveň

1. dorovnání rukou ([03-ruce.md](03-ruce.md)),
2. prstoklad ([02-prstoklad.md](02-prstoklad.md)).

## Proč takhle (didaktika)

- Začátečník se nejdřív učí melodii jednou rukou, pak přidá **jeden tón** v levé ruce
  na těžkou dobu. To je klasický postup učebnic (Bastien, Alfred).
- Kvinta v levé ruce je další krok: dva prsty, pevný tvar, harmonicky „neutrální“.
- Pokročilá verze přidává techniku (oktávy, rozklady), ale melodie i harmonie zůstávají.

## Ověření

`tests/theory.test.mjs` na umělé skladbě (melodie + druhý hlas + výplňové tóny + akordy):

- úroveň 1 = přesně melodie, vždy jedna nota naráz, všechny noty mají prst,
- úroveň 2: levá ruka vždy nejvýš 1 nota, úroveň 3 nejvýš 2; levá ruka je celá pod melodií;
  pro akord C dur hraje C (úroveň 2) a C + G (úroveň 3),
- úroveň 4 = originál beze změny,
- úroveň 5 obsahuje všechny noty pravé ruky originálu, přidané noty jsou označené
  a žádná ruka nepřesáhne oktávu.

Reálná videa (Fourth of July, Ma Meilleure Ennemie): úroveň 1 má 1/3 až 1/2 počtu not
originálu, úroveň 2 přidá ~1 tón na takt. Výpočet všech úrovní trvá pod 0,6 s.

## Plán

- Vícehlasá analýza místo skyline (melodie v levé ruce nebo uprostřed).
- Úroveň 3 s obraty akordů a vedením hlasů (minimální pohyb ruky).
- Volitelná transpozice do „bílé“ tóniny (C dur / a moll) pro úplné začátečníky.
- Zjednodušení rytmu (synkopy na dobu) pro úroveň 1.
