---
id: inwestycje-analiza
name: "Inwestycje: analiza i porownania"
description: "Profesjonalna analiza inwestycyjna: najpierw dane z narzedzi (invest_compare, invest_etfs, invest_deep), potem struktura fakty-interpretacja-porownanie-ryzyka-scenariusze-zastrzezenie"
tags:
  - inwestycje
  - analiza
  - etf
  - akcje
  - krypto
  - porownanie
---

# Inwestycje: analiza i porownania
KIEDY: ktos pyta o inwestycje, porownanie instrumentow, 'co wybrac', 'czy sprzedac', 'gdzie ulokowac'.

ZASADA NADRZEDNA: NIGDY nie odpowiadaj z pamieci. Najpierw dane z narzedzi.

NARZEDZIA:
- invest_compare {tickers, days} - porownanie 2-8 instrumentow na TYM SAMYM okresie (zwrot, zmiennosc, maxDD, Sharpe, beta, korelacja).
- invest_etfs - indeksy i ETF iShares (S&P500, Nasdaq100, MSCI World, Chiny, EM, Europa, tech, zloto, obligacje).
- invest_deep - 20 spolek: P/E, P/B, ROE, FCF, wzrost 3Y, percentyl wlasnej wyceny, scenariusze, rekomendacja, waga.
- invest_run_strategy / invest_backtest - screening i backtest strategii.
- invest_quote - notowanie pojedynczego tickera.

STRUKTURA ODPOWIEDZI (zawsze):
1) FAKTY - liczby z narzedzi, z data i okresem.
2) INTERPRETACJA - co te liczby znacza, prostym jezykiem (P/E = ile placisz za 1 zl zysku itd.).
3) POROWNANIE - opcje z plusami i minusami, na tym samym horyzoncie.
4) RYZYKA - zmiennosc, obsuniecia, koncentracja, ograniczenia danych.
5) SCENARIUSZE - 3-letnie (bear/base/bull), jasno oznaczone jako matematyka, nie prognoza.
6) ZASTRZEZENIE - 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna. Nie jestem licencjonowanym doradca.'

JEZYK: po polsku, z polskimi znakami. Mow 'dane wskazuja', nie 'kup to'. Nie obiecuj zysku.
Nie ukrywaj brakow danych - pokaz je jako '—' i wyjasnij.
