---
id: kod-produkcyjny
name: Standard kodu produkcyjnego
description: "Lista kontrolna profesjonalnego kodu - sekrety, obsluga bledow, paginacja, limity, testy, bezpieczne domyslne"
tags:
  - kod
  - jakosc
  - produkcja
  - standard
  - review
---

# Standard kodu produkcyjnego
KIEDY: piszesz lub oceniasz kod, ktory ma dzialac niezawodnie (nie tylko demo).

LISTA KONTROLNA (kazdy punkt sprawdz przed oddaniem):
1. SEKRETY: klucze/tokeny TYLKO z ENV (os.environ / process.env). Zero sekretow w kodzie, repo i logach. Dolacz .env.example.
2. API: NIE wymyslaj endpointow, pol ani parametrow. Brak pewnosci = sprawdz dokumentacje (web_fetch/web_search) albo napisz wprost 'do weryfikacji w docs'. Zla nazwa pola = cichy blad.
3. BLEDY: bez golego 'except:'. Lap konkretne wyjatki, loguj kontekst, zwracaj sensowny komunikat. Nie ukrywaj bledow.
4. LIMITY: obsluguj 429 z naglowkiem Retry-After + backoff (wykladniczy z jitterem). Nie wal w petli bez przerwy.
5. AUTORYZACJA: tokeny wygasaja - odswiezaj na 401 (refresh/relogin). Sprawdz wymagane zakresy (scopes).
6. PAGINACJA: listy API sa stronicowane - iteruj po stronach, nie bierz tylko pierwszej.
7. WALIDACJA: sprawdzaj wejscie i odpowiedzi (wymagane pola, typy, zakresy). Nie ufaj slepo danym z zewnatrz.
8. BEZPIECZNE DOMYSLNE: akcje zmieniajace dane (zapis/wysylka/platnosc) domyslnie w trybie dry-run; realna akcja tylko za jawna flaga.
9. CZYTELNOSC: male funkcje, jasne nazwy, brak duplikacji; konfiguracja na gorze; docstring naglowkowy.
10. TESTY: wydziel logike czysta i przetestuj (unittest/pytest). Uruchom kod i testy przed oddaniem - 'dziala' bez uruchomienia to nie dowod.
11. IDEMPOTENCJA I WZNOWIENIE: dlugie petle musza przezyc blad pojedynczego elementu i dac sie zatrzymac (graceful shutdown).
12. ZGODNOSC: sprawdz regulamin/ToS i limity dostawcy, zwlaszcza dla automatyzacji kont i platnosci.
