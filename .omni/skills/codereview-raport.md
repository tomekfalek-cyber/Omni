---
id: codereview-raport
name: Audyt i raport z repozytorium
description: Analiza repozytorium/kodu i profesjonalny raport - mocne strony, ryzyka z dowodami, ocena, priorytetowe poprawki
tags: [audyt, raport, code review, analiza, jakosc, refaktor, ocena, repozytorium, review]
---
# Audyt i raport z repozytorium
KIEDY: trzeba ocenic repozytorium/kod i napisac raport z sugestiami poprawek

1. Zmierz: repo_audit (rozmiary, najwieksze pliki, testy, TODO, puste catch) + code_map (struktura, symbole).
2. PRZECZYTAJ najwazniejsze pliki (najwieksze, rdzen logiki, punkty wejscia) - nie oceniaj po nazwach.
3. Ocen wg wymiarow: architektura, utrzymywalnosc, testy, obsluga bledow, bezpieczenstwo, wydajnosc.
4. KAZDA ocene poprzyj DOWODEM: plik:linia albo konkretna liczba. Nie pisz 'wydaje sie', 'prawdopodobnie'.
5. Struktura raportu:
   - Czym jest projekt (2-3 zdania).
   - Mocne strony (konkretnie, z dowodami).
   - Slabosci/ryzyka (z dowodami + waga: niska/srednia/wysoka).
   - Tabela ocen 1-10 wg wymiarow.
   - Werdykt w jednym zdaniu.
   - Priorytetowe poprawki (1-2-3: co najpierw i dlaczego).
6. Ton szczery: mow wprost, co dobre i co slabe. Bez pochlebstw i bez krytykanctwa.
7. Na koniec zaproponuj konkretne nastepne kroki (np. testy, podzial na moduly).
8. Jesli uzytkownik chce, zapisz raport do pliku .md (file_write) i podaj sciezke.
