# 03 – Ruce: která ruka hraje kterou notu

Kód: `web/js/hands.js`, barevné rozdělení v `note_detector.py` (`assign_hands`).

## 1. Z videa podle barvy

Videa barví ruce různě. Často mají **4 barvy**: každá ruka jednu pro bílé a jednu pro černé
klávesy (PianoGumi: levá červená/vínová, pravá tyrkysová/modrá). Někdy jsou odstíny obou rukou
skoro stejné: „give it back“ má na bílých klávesách žlutou s rozdílem odstínu jen 8°. Postup:

1. **Zvlášť bílé a zvlášť černé klávesy.** Na každém typu kláves má ruka jednu barvu.
2. **Barva v Lab** (vnímaná vzdálenost barev), jas s poloviční váhou. Do shlukování jdou jen syté
   noty a na bílých klávesách jen světlé, protože záblesky a stíny by shluky pokazily.
3. **2-means**, dva shluky se uznají, když jsou středy od sebe aspoň 4× dál než rozptyl uvnitř.
4. **Ruce se liší rejstříkem:** rozdělení platí, jen když se průměrná výška shluků liší aspoň
   o 5 půltónů. Když ne, je menší shluk zbytek efektu: pokud má pod 15 %, vyřadí se a dělí se
   znovu, jinak barvy ruce nerozlišují.
5. **Shluk s nižší průměrnou výškou = levá ruka.**
6. **Ostatní noty** (vyřazené, nebo typ kláves bez rozdílu barev) dostanou ruku podle not, které
   zní ±1 s okolo: blíž k průměru levé, nebo pravé.

Výsledek na 5 skladbách se 4 různými barevnými schématy: **0 křížení rukou a 0 akordů širších
než oktáva**. „give it back“ dřív 14 : 246 not, teď 107 : 153.

Pak dvě pojistky:
- **Záblesky:** víc než 10 not se stejným začátkem (hráč má 10 prstů) je efekt videa
  (závěrečný záblesk, přechod), zahodí se. Na playlistu Jujutsu Kaisen to bylo 20–70 not na video.
- **Akord jedné ruky širší než oktáva,** když druhá ruka nic nezačíná: krajní tóny přejdou do druhé
  ruky (`fix_hand_spans`, typicky závěrečný akord obarvený jednou barvou).

## 2. Bez barev (MIDI s jednou stopou, jednobarevné video)

Každá ruka má **těžiště** (průměrnou výšku posledních not, start: levá G2–C3 = 48,
pravá G4 = 67). Pro každý akord se zkusí všechna rozdělení „spodních *k* not levá, zbytek
pravá“. Vybere se rozdělení s nejmenší cenou:

- vzdálenost not od těžiště jejich ruky,
- +10 za každý půltón rozpětí ruky nad oktávu,
- +20 za každou notu nad 5 v jedné ruce,
- +20 když by se ruce křížily.

Těžiště se pak posune (40 % novým notám). Když se ruce přiblíží na méně než kvintu, roztlačí se.

## 3. Přehazování rukou (zjednodušení)

I když ruce známe, originál může mít v jedné ruce akord širší než oktáva nebo víc než 5 not
(v tutoriálech se to stává, třeba když video špatně obarví notu). `rebalanceHands`:

- v každém okamžiku zkontroluje noty, které ruka drží,
- když je rozpětí > 12 půltónů nebo > 5 not, krajní **nově začínající** notu (u pravé
  nejnižší, u levé nejvyšší) přesune do druhé ruky,
- jen pokud se druhé ruce vejde (rozpětí ≤ oktáva, ≤ 5 not).

Přesunuté noty mají `moved = true`. V přehrávači mají **čárkovaný okraj**, aby bylo vidět, že je
hraje „ta druhá“ ruka.

## 4. Jak s tím pracují úrovně

- Úroveň 1 hraje jen pravá ruka.
- Úroveň 2–3: levá ruka dostane bas pod melodií (strop = nejnižší tón melodie − malá tercie).
- Úroveň 5: oktávové zdvojení melodie se přidá jen tehdy, když se ruka vejde do oktávy.

## 5. Ukazatel polohy rukou

Z prstokladu se pro každou ruku spočítá **pětiprstová poloha**: palec je na bílé klávese
`bílá(nota) − (prst − 1)` u pravé ruky a `+ (prst − 1)` u levé (černá klávesa = bílá pod ní + ½).
Na klaviatuře je lišta přes 5 bílých kláves s čísly prstů (pravá 1–5 zleva, levá 5–1). Když se
do 1,2 s ruka přesouvá, nová poloha bliká čárkovaně pod lištou. Lišta se k nové poloze plynule
posune. Přepínač „Ruce“ (R).

V UI se dá kterákoli ruka hrát samostatně („Hraju já“). Ta druhá zní a je ztlumená. Typický postup
cvičení je pravá ruka zvlášť, levá zvlášť, pak obě.
