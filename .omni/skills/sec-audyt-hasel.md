---
id: sec-audyt-hasel
name: Audyt sily hasel (wlasne hashe)
description: "Sprawdzenie polityki hasel na WLASNYCH hashach - lamanie slownikowe w celach audytu"
tags:
  - security
  - hasla
  - hashcat
  - audyt
---

# Audyt sily hasel (wlasne hashe)
KIEDY: ocena polityki hasel WLASNYCH uzytkownikow (czy latwo je zlamac).

TWARDE ZASADY: tylko systemy WLASNE albo z PISEMNA zgoda; atakowanie cudzych = ODMAWIAM. Najpierw inwentarz pasywny, potem testy aktywne. Zawsze podaj DOWOD (komenda + wynik) i ryzyko.

KROKI:
1. Zbierz hashe WLASNE (np. /etc/shadow gdy masz root, albo kontrolowany zestaw testowy).
2. Jesli john/hashcat: john --wordlist=list.txt hash; hashcat -m 0 hash list.txt.
3. Brak narzedzi: python + mala lista (top-100) - test na wlasnym hashu, by ocenic polityke.
4. Miara: ile hasel lamie sie < 1 min (slabe), ile wcale (mocne).
5. Rekomendacje: dlugosc >= 12, zakaz slownikowych, MFA, rate limit, menedzer hasel.
6. NIE przechowuj i nie publikuj zlamanych hasel.
