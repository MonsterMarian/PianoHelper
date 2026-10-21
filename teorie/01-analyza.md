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
  době *n* a proloží se přímka t = fáze + n·T. Okno se postupně rozšiřuje (20 s, 40 s, …
  celá skladba), aby se při malé chybě periody nástupy nepřiřadily ke špatné době.
  Bez tohoto kroku chyba 0,5 ms na dobu za 5 minut naroste na půl doby.

## 2. Doba a takt

- **Doba** = k × tatum (k ∈ 1, 2, 3, 4, 6, 8). Rozhoduje soudržnost **přízvuků**: více not
  naráz, dlouhé noty a basové tóny (pod C4) váží víc. Tempo mezi 50 a 200 BPM s preferencí
  kolem 100 BPM.
- **Fáze doby** se vybírá diskrétně: ze všech posunů po tatumech ten, na který padne nejvíc
  váhy přízvuků. Zachytí to i synkopy, např. tresillo 3 + 3 + 2.
- **Takt 3/4 nebo 4/4:** pro obě možnosti se najde první doba a spočítá se, o kolik víc váhy
  na ni padá než při rovnoměrném rozložení (`podíl · m − 1`). Nejsilnější vodítko jsou
  **změny harmonie** (změna základního tónu akordu), protože ty padají nejčastěji na první
  dobu. Při nejasném výsledku se volí 4/4.

## 3. Akordy

Pro každou dobu se spočítá **profil tónů**: kolik sekund zněla každá z 12 tříd výšky
(C, C♯, … H). Pak se porovná se šablonami:

| typ | intervaly od základu | příklad |
|---|---|---|
| dur | 0 4 7 | C = C E G |
| moll | 0 3 7 | Am = A C E |
| dominantní septakord | 0 4 7 10 | G7 = G H D F |
| velký septakord | 0 4 7 11 | Cmaj7 |
| mollový septakord | 0 3 7 10 | Am7 |
| zmenšený | 0 3 6 | Hdim |
| sus4 | 0 5 7 | Csus4 = C F G |
| „power chord“ | 0 7 | C5 |

Skóre = (energie tónů akordu − 0,6 × energie ostatních tónů) / celkem. Bonus dostane akord,
jehož základ je nejnižší tón (bas obvykle hraje základ); malá penalizace padá za každý chybějící
tón akordu. Doba bez jasného akordu prodlouží předchozí. Stejné sousední akordy se sloučí.

## 4. Tónina

Profil tónů celé skladby se koreluje s profily Krumhansl–Kessler pro všech 24 tónin
(12 dur + 12 moll). V UI se zobrazuje jen jako informace (např. „E moll · 88 BPM · 4/4“).

## Omezení

- Jedna mřížka pro celou skladbu: přesné pro videa z MIDI, ne pro rubato a živé nahrávky.
- Trioly v osminovém rytmu se do mřížky nevejdou. Neodmítnou se, jen se nepočítají do odhadu.
- Akordy jsou po dobách, takže rychlejší harmonický rytmus (2 akordy v jedné době) splyne.

## Testy

`tests/theory.test.mjs`: 3/4 valčík 90 BPM (doba, takt, první doba), 4/4 se 120 BPM
a náhodným chvěním ±15 ms (jako snímky videa), rozpoznání C, Am, G7, Em a tóniny C dur.
