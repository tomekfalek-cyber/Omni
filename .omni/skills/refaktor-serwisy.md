---
id: refaktor-serwisy
name: Refaktor do warstw
description: Rozbicie duzego pliku lub funkcji na moduly i serwisy bez zmiany zachowania
tags: [refaktor, architektura, moduly, serwisy]
---
# Refaktor do warstw
KIEDY: rozbicie duzego pliku/funkcji na moduly i serwisy

1. Najpierw mapuj zaleznosci (code_map + grep uzyc).
2. Ustal granice: HTTP / logika / dane.
3. Zmiany MALE, po jednym module, uruchamiajac testy po kazdym kroku.
4. Nie zmieniaj zachowania - tylko strukture.
5. Na koncu uruchom pelny zestaw testow i typecheck.
