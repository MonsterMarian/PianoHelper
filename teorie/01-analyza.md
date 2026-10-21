# 01 – Analýza: doby, takt, akordy, tónina

Než jde skladbu zjednodušit, je potřeba vědět, **kde jsou doby a takty** (kam dát basový tón)
a **jaký akord zrovna zní** (jaký tón dát do levé ruky). Kód: `web/js/analysis.js`.

## Pojmy

- **Doba (beat)** – pulz, do kterého se tleská. Tempo 120 BPM = doba trvá 0,5 s.
- **Takt** – skupina dob, první je přízvučná. 4/4 = 4 doby, 3/4 = 3 doby (valčík).
- **Tatum** – nejkratší pravidelná mřížka, na kterou padají všechny noty (typicky osminy
  nebo šestnáctiny).
- **Akord** – souzvuk tónů. Kvintakord = základ + tercie + kvinta: C dur = C E G,
  a moll = A C E. Dur má velkou tercii (4 půltóny), moll malou (3).

## 1. Tatum (mřížka)

Každý nástup noty v čase *t* si představíme jako bod na kružnici s obvodem *T*
(úhel 2π·t/T). Když *T* odpovídá mřížce skladby, body se shluknou na jednom místě a jejich
průměrný vektor je dlouhý (blízko 1). Délka vektoru je **soudržnost**.

- Hledá se na prvních ~30 s (krátké okno = široký vrchol, stačí krok 2 ms).
- Násobky mřížky (2T, 3T…) mají také vysokou soudržnost. Bere se proto **nejdelší perioda**
  se soudržností ≥ 85 % maxima.
- Periodu pak zpřesní **metoda nejmenších čtverců**: každý nástup se přiřadí nejbližší
  době *n* a proloží se přímka t = fáze + n·T (okno se rozšiřuje 20 s → 30 s, aby se při
  malé chybě periody nástupy nepřiřadily ke špatné době). Zbytek skladby už řeší sledování
  dob (oddíl 3), takže změna tempa nevadí.

## 2. Doba (start sledování)

- **Doba** = k × tatum (k ∈ 1, 2, 3, 4, 6, 8). Rozhoduje soudržnost **přízvuků**: více not
  naráz, dlouhé noty a basové tóny (čím hlubší, tím silnější) váží víc. Tempo mezi 50
  a 200 BPM s preferencí kolem 100 BPM.
- **Fáze doby** se vybírá diskrétně: ze všech posunů po tatumech ten, na který padne nejvíc
  váhy přízvuků. Zachytí to i synkopy, např. tresillo 3 + 3 + 2.
- Obojí se počítá jen ze začátku skladby. Je to start pro sledování, tempo se pak smí měnit.

## 3. Sledování dob (proměnné tempo)

Mřížka není jedna perioda, ale **pole časů dob**. Funguje podobně jako fázový závěs (PLL):

1. předpověď = poslední doba + aktuální perioda;
2. přízvuky v okně ±20 % periody se zprůměrují (váha × Gauss podle vzdálenosti);
3. doba se k nim posune o 80 % odchylky a perioda se upraví o 25 % odchylky (meze ×1,8);
4. když v okně nic není (pauza), doba se jen předpoví.

Osminy (±50 % periody) a trioly (±33 %) leží mimo okno, takže dobu nestrhnou.

**Zpětný průchod:** start je odhadnutý z prvních ~30 s. Když se tempo mění už tam, prvních pár
dob je nepřesných. Proto se od 8. doby, kde je sledování ustálené, projde sledovačem pozpátku
k začátku skladby.

## 4. Takt a první doba

Přízvuky a **změny harmonie** (změna základního tónu akordu) se sečtou po dobách (podle indexu
doby, ne času, takže to funguje i při změně tempa). Pro 3/4 a 4/4 se najde posun, na který
připadá nejvíc váhy, a porovná se převaha nad rovnoměrným rozložením (`podíl · m − 1`).
Při nejasném výsledku se volí 4/4. Doby se pak zarovnají tak, aby `beats[0]` byla první doba
taktu.

## 5. Akordy

Pro každou dobu se spočítá **profil tónů**: kolik sekund zněla každá z 12 tříd výšky
(C, C♯, … H). Pravá ruka váží 0,6, protože melodie obsahuje průchodné tóny a harmonii nesou
doprovod a bas. Profil se porovná se šablonami:

| typ | intervaly od základu | příklad | apriorně |
|---|---|---|---|
| dur | 0 4 7 | C = C E G | +0,1 |
| moll | 0 3 7 | Am = A C E | +0,1 |
| dominantní septakord | 0 4 7 10 | G7 = G H D F | 0 |
| velký septakord | 0 4 7 11 | Cmaj7 | 0 |
| mollový septakord | 0 3 7 10 | Am7 | 0 |
| zmenšený | 0 3 6 | Hdim | −0,15 |
| sus4 | 0 5 7 | Csus4 = C F G | −0,15 |
| „power chord“ | 0 7 | C5 | −0,05 |

Skóre = (energie tónů akordu − 0,6 × energie ostatních) / celkem + apriorní váha
− 0,12 za každý chybějící tón. K tomu **bas**: je-li základem +0,3, tercie 0, kvinta −0,1,
mimo akord −0,2. sus4 a dim mají zápornou váhu, protože v jednoduché hudbě jde skoro vždy
o průchodný tón. Csus4 jinak „vysvětlí“ C s průchodným F i G bas s F v melodii.

**Viterbi přes doby:** akord se nevybírá pro každou dobu zvlášť. Hledá se posloupnost
s nejvyšším součtem skóre minus ceny změn. Cena změny podle metrické váhy doby:
**první doba taktu 0,15, půlka taktu 0,3, ostatní 0,6** (bez známého metra 0,45). Průchodný
tón melodie tak akord nezmění, skutečná změna ano. Ticho řetěz přeruší.

Ověření: Óda na radost má po taktech C | G | C | G … i přes průchodné tóny F, E, D v melodii
(test). Na reálných videích zmizelo „cukání“ (C → Csus4 → C), např. Ma Meilleure Ennemie
se drží cyklu Em – Bm – Am – Bm.

## 6. Tónina

Profil tónů celé skladby se koreluje s profily Krumhansl–Kessler pro všech 24 tónin
(12 dur + 12 moll). V UI se zobrazuje jen jako informace (např. „E moll · 88 BPM · 4/4“).

## Omezení

- Náhlá změna tempa o víc než ~20 % mezi dvěma dobami (fermata, generálka) sledovač
  na pár dob ztratí, pak se znovu chytí.
- Trioly v osminovém rytmu se do mřížky nevejdou. Neodmítnou se, jen se nepočítají do odhadu.
- Akordy jsou po dobách, takže rychlejší harmonický rytmus (2 akordy v jedné době) splyne.
- Takt jen 3/4 nebo 4/4. Složené takty (6/8, 12/8) se dělením doby na třetiny do zápisu
  zatím nepřevedou (viz 06-notovy-zapis.md).

## Testy

`tests/theory.test.mjs`: 3/4 valčík 90 BPM (doba, takt, první doba), 4/4 se 120 BPM
a náhodným chvěním ±15 ms (jako snímky videa), **zrychlení 84 → 132 BPM s rubatem ±4 %**
(≥ 95 % dob do 30 ms, všechny první doby taktů), akordy Ódy na radost po taktech,
rozpoznání C, Am, G7, Em a tóniny C dur.
