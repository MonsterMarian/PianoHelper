# 04 – Aranžování: úrovně obtížnosti 1–5

Kód: `web/js/arrange.js`. Vstup = noty skladby (s rukama), výstup = noty pro danou úroveň
s rukou a prstem.

Hlavní myšlenka: **každá verze zní jako originál.** Snazší verze jsou jen *podmnožina* not
originálu (stejné tóny ve stejném čase, nic vymyšleného), těžší verze jsou *celý originál +
přidané noty*. Melodie a bas zůstávají nejdéle, ubírá se nejdřív to ostatní (vnitřní hlasy,
ozdoby, zdvojení) – stejně jako u statistické redukce klavírních partů (Nakamura a kol. 2018,
[arXiv:1808.05006](https://arxiv.org/abs/1808.05006)) i u ručních úprav „easy piano“
([Songscription](https://www.songscription.ai/blog/simplify-sheet-music-guide): melodie zůstane,
akordy v pravé ruce na jeden tón, levá ruka na basový tón, pryč ozdoby).

### Žebřík verzí

| krok | pravá ruka | levá ruka | vztah k originálu |
|---|---|---|---|
| Začátečník | hlavní tóny melodie: jeden na dobu, u rychlých skladeb na půl taktu (≥ 0,6 s od sebe) | nic | podmnožina |
| Snadné | celá melodie (bez ozdob) | původní basový tón na takt / změnu akordu | podmnožina |
| Střední | celá melodie | levá ruka z originálu: nástupy aspoň ½ doby od sebe, nejvýš 2 tóny (bas + horní) | podmnožina |
| Skoro originál | originál bez ozdob a šestnáctin (nástupy ≥ ⅓ doby od sebe), akordy nejvýš 3 tóny (melodie + 2 nejbližší) | totéž (bas + 2 nejbližší) | podmnožina |
| **Originál** | jak ve videu | jak ve videu | — |
| Pokročilé | + tón akordu (tercie/sexta) pod dlouhé tóny melodie | držený bas zůstane, přidá se rozklad 5-2-1-2 | nadmnožina |
| Mistr | jako Pokročilé + oktávy pod melodií | jako Pokročilé | nadmnožina |

### Kde je originál

Pět tlačítek je **okno do žebříku** podle obtížnosti originálu. Když je originál sám těžký,
nemá smysl nad něj vymýšlet ještě těžší verzi – pro učení je potřeba víc kroků dolů.

| obtížnost originálu (p90 D) | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| < 10 (EASY tutoriály) | Začátečník | Snadné | **Originál** | Pokročilé | Mistr |
| 10–14 | Začátečník | Snadné | Střední | **Originál** | Pokročilé |
| ≥ 14 (plný cover, např. Levels) | Začátečník | Snadné | Střední | Skoro originál | **Originál** |

**Obtížnost D** (podle Nakamury: součet za obě ruce v 1s oknech): každý nástup = 1, každý další
tón akordu = 0,5, přesun ruky o víc než kvartu = (vzdálenost − 5) / 7. Bere se 90. percentil
oken. V knihovně: Óda na radost 3, EASY tutoriály Jujutsu Kaisen 5–9, Levels (Pianella) 18.

Přehrávač si pamatuje **krok** (např. „Originál“), ne číslo – po přepnutí na těžší skladbu
zůstane originál originálem. Tlačítko s originálem má dole rumělkovou linku.

Při stavbě Pokročilé a Mistr jdou nejdřív rozložené akordy v levé ruce, pak doplňky pravé ruky,
a ty jen nad levou rukou, aby se ruce nesrazily.

## Kroky

### Melodie („skyline“)

1. V každém nástupu pravé ruky se vezme **nejvyšší tón**. Melodie bývá nahoře; tento postup
   (Uitdenbogerd & Zobel 1999) je jednoduchý a u popových tutoriálů funguje dobře.
2. **Vnitřní hlas pryč:** tón, který začne pod ještě znějícím vyšším tónem melodie, je doprovod.
3. **Ozdoby pryč:** tón kratší než ¼ doby, po kterém do ¼ doby následuje sousední tón
   (o 1–2 půltóny), je příraz nebo trylek.
4. **Legato:** tón drží do dalšího tónu melodie, nejdéle však původní délku. Rytmus se tedy
   nemění, jen zmizí mezery mezi tóny.

### Bas (Snadné)

Podle mřížky z [01-analyza.md](01-analyza.md) a akordů:

- sloty = začátky taktů (a začátek akordu, pokud trvá ≥ 2 doby; kratší změna uprostřed taktu
  se vynechá). Doby jsou časy ze sledování dob, takže bas sedí i při změně tempa,
- tón = **nejnižší původní tón levé ruky, který v okně začíná** (s jeho původním začátkem),
  takže zůstane basová linka i obraty. Když v okně žádný nezačíná, nepřidá se nic – dřív se
  doplňoval základ akordu, ale to už nebyl tón originálu,
- strop = nejnižší tón melodie v daném úseku − 3 půltóny, aby se ruce nesrazily.

### Držení basu (Snadné)

Každý tón levé ruky drží až do dalšího tónu levé ruky (nejdéle takt, nejdéle do konce
skladby). Přeskočená krátká změna akordu uprostřed taktu tak nenechá díru: v notách jsou celé
noty, žádné pomlky.

### Ozdoby (Pokročilé a Mistr)

- **Oktávy:** pod tón melodie delší než ~1 doba se přidá tón o oktávu níž, pokud pod ním
  v pravé ruce nic není a ruka se vejde do oktávy.
- **Rozložené akordy:** k drženému basovému tónu levé ruky (≥ 2 doby, patří do akordu) se
  přidá osminový vzor *kvinta – oktáva – kvinta* (prsty 2-1-2), bas drží malíček celou délku.
  Původní tón tedy zůstane, jen se k němu přidá pohyb. Tóny nad melodii se vynechají.

### Nakonec pro každou úroveň

1. dorovnání rukou ([03-ruce.md](03-ruce.md)),
2. prstoklad ([02-prstoklad.md](02-prstoklad.md)).

## Proč takhle (didaktika)

- Začátečník se nejdřív učí melodii jednou rukou, pak přidá **jeden tón** v levé ruce
  na těžkou dobu. To je klasický postup učebnic (Bastien, Alfred).
- Kvinta v levé ruce je další krok: dva prsty, pevný tvar, harmonicky „neutrální“.
- Pokročilá verze přidává techniku (oktávy, rozklady), ale melodie i harmonie zůstávají.

## Ověření

`tests/theory.test.mjs`:

- **slib úrovní** na Ódě, umělé skladbě a husté skladbě (šestnáctiny v obou rukou): pod
  originálem je každý tón i v originálu (výška + začátek), nad originálem je celý originál;
  každá snazší úroveň má nejvýš tolik not jako originál a aspoň tolik jako úroveň pod ní;
  Óda a umělá skladba mají originál na 3, hustá skladba na 5,
- Začátečník = přesně hlavní tóny melodie, vždy jedna nota naráz, ≥ 0,9 s od sebe při 120 BPM,
- Snadné: levá ruka vždy nejvýš 1 nota a celá pod melodií, v C dur hraje C,
- Snadné při změně tempa (rubato): bas sedí na skutečné době a každý takt má bas,
- Óda na radost, Snadné: v každém taktu jeden bas, drží celý takt,
- Pokročilé a Mistr: všechny noty pravé ruky originálu zůstanou, přidané noty jsou označené
  a žádná ruka nepřesáhne oktávu.

## Plán

- Vícehlasá analýza místo skyline (melodie v levé ruce nebo uprostřed).
- Volitelná transpozice do „bílé“ tóniny (C dur / a moll) pro úplné začátečníky.
- Zjednodušení rytmu (synkopy na dobu) pro Začátečníka.
- Melodie, která je v originálu jen v levé ruce, se do snadných verzí nedostane (skyline bere
  pravou ruku).
