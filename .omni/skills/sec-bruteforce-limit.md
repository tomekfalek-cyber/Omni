---
id: sec-bruteforce-limit
name: Test odpornosci logowania na zgadywanie
description: "Sprawdzenie, czy WLASNE logowanie ma rate limit / lockout / MFA"
tags:
  - security
  - bruteforce
  - logowanie
  - audyt
---

# Test odpornosci logowania na zgadywanie
KIEDY: sprawdzenie odpornosci WLASNEGO formularza logowania na zgadywanie hasel.

TWARDE ZASADY: tylko systemy WLASNE albo z PISEMNA zgoda; atakowanie cudzych = ODMAWIAM. Najpierw inwentarz pasywny, potem testy aktywne. Zawsze podaj DOWOD (komenda + wynik) i ryzyko.

KROKI:
1. Ustal endpoint logowania (wlasna aplikacja).
2. Wyslij 10-20 prob z blednym haslem (NIE wiecej) i obserwuj: HTTP 429, blokada, opoznienie, captcha.
3. Sprawdz, czy jest MFA i limit per konto vs per IP.
4. Wnioski: wdrozyc rate limit (np. 5 prob/min), lockout wykladniczy, MFA, log nieudanych prob.
5. RAPORT: co testowane -> wynik (statusy) -> rekomendacja.
