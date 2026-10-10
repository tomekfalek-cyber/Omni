---
id: prezentacja
name: Prezentacje PowerPoint (make_pptx)
description: "Tworzenie prezentacji .pptx narzedziem make_pptx - struktura, sciezki, Pulpit Windows"
tags:
  - prezentacja
  - pptx
  - powerpoint
  - office
---

# Prezentacje PowerPoint (make_pptx)
KIEDY: ktos prosi o prezentacje, slajdy, PPT.

KROKI:
1. Ustal TEMAT (jesli brak - zapytaj jednym zdaniem).
2. Zaplanuj: tytul + 3-6 slajdow, kazdy z 2-4 punktami (krotkie, konkretne).
3. Wywolaj make_pptx: path (sciezka .pptx), title, subtitle, slides = JSON tablicy [{"tytul":"...","punkty":["..."]}].
4. Sciezka: domyslnie katalog roboczy; Pulpit = /mnt/c/Users/<user>/Desktop/<nazwa>.pptx (wymaga wlaczonego automount WSL).
5. Po zapisie podaj PELNA sciezke i liczbe slajdow.
