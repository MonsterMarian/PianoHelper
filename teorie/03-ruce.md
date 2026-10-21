# 03 – Ruce: která ruka hraje kterou notu

Kód: `web/js/hands.js`, barevné rozdělení v `note_detector.py` (`assign_hands`).

## 1. Z videa podle barvy

Synthesia a většina tutoriálů barví ruce různě (např. modrá pravá, oranžová levá). Detektor u každé
noty zaznamená barvu rozsvícené klávesy. Odstín (hue) je úhel na barevném kole, proto se shlukuje
**2-means na kružnici** (průměr se počítá z vektorů cos/sin, aby červená 350° a 10° byla
u sebe). Ruce se rozliší, když:

- shluky jsou od sebe aspoň 25°,
- menší shluk má aspoň 5 % not.

Levá ruka = shluk s nižší průměrnou výškou. Odstín se nemění mezi bílou a černou klávesou
(světlejší a tmavší varianta stejné barvy), takže to funguje i pro videa se čtyřmi barvami.

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

V UI se dá kterákoli ruka ztlumit (noty zešednou). Typický postup cvičení je pravá ruka
zvlášť, levá zvlášť, pak obě.
