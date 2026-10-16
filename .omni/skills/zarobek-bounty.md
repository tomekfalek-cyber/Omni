---
id: zarobek-bounty
name: Zarobek: bounty OSS i bug bounty
description: "Procedura: znajdz zlecenie z nagroda, wykonaj prace (patch+testy), przygotuj PR/raport do wyslania przez wlasciciela"
tags:
  - zarobek
  - bounty
  - oss
  - bugbounty
---

# Zarobek: bounty OSS i bug bounty
KIEDY: wlasciciel prosi o znalezienie/obsluge zlecenia z nagroda (bounty).

ZASADY: legalnie (wlasciciel wysyla PR/zgloszenie); bez lamania ToS; bug bounty tylko w zakresie programu (regula 19/33). Nie obiecuj zarobku.

KROKI:
1. Uzyj bounty_finder (opcjonalnie keywords) - lista otwartych issues z label bounty.
2. Ocen wykonalnosc: jezyk, rozmiar, jasnosc wymagan, czy sa testy. Wybierz 1-2 najlepsze.
3. Przeczytaj kod (file_read/code_map) i napisz PATCH + testy (TDD).
4. Przygotuj OPIS PR: co zmieniono, dlaczego, jak przetestowano (dowody).
5. RAPORT dla wlasciciela: link, co zrobione, jak wyslac, jakiej nagrody oczekiwac (bez gwarancji).
