---
id: zarobek-bounty
name: Zarobek: bounty OSS i bug bounty
description: "Procedura: znajdz zlecenie (platformy z escrow), przygotuj (bounty_run), wykonaj (TDD), wypchnij PR (bounty_pr) - fakture wystawia wlasciciel"
tags:
  - zarobek
  - bounty
  - oss
  - bugbounty
  - algora
  - issuehunt
---

# Zarobek: bounty OSS i bug bounty
KIEDY: wlasciciel prosi o znalezienie/obsluge zlecenia z nagroda (bounty).

ZASADY: legalnie (wlasciciel wysyla PR/zgloszenie); bez lamania ToS; bug bounty tylko w zakresie programu (regula 19/33). Nie obiecuj zarobku.

GDZIE SZUKAC (z escrow = wypłata zablokowana przed startem - najbezpieczniejsze):
- Algora: https://algora.io/explore (bounties z escrow)
- IssueHunt: https://issuehunt.io (bounties)
- Gitcoin: https://gitcoin.co (bounties/granty)
- Bug bounty: HackerOne https://hackerone.com / Bugcrowd https://bugcrowd.com (tylko programy w zakresie)
- GitHub: narzedzie bounty_finder (filtr wiarygodnosci) - uwaga, label:bounty to glownie farmy.

KROKI:
1. Znajdz zlecenie (bounty_finder albo platforma z escrow). Odrzuc farmy: 0 gwiazdek, repo utworzone 'na noc', brak escrow.
2. Zgloszenie: WLaSCICIEL klika Claim/Apply (my nie mamy konta).
3. Przygotowanie: bounty_run {url} -> klonuje repo + zapisuje ISSUE.md.
4. Praca: przeczytaj ISSUE.md i kod (code_map/file_read), zaplanuj, zaimplementuj + TESTY (TDD), uruchom.
5. Wyslanie: bounty_pr {dir,title,body} (wymaga GITHUB_TOKEN i zgody) -> fork + push + PR. Bez tokenu: przygotuj komendy i opis PR do wklejenia.
6. Review: odpowiedz na uwagi maintainera, popraw (kolejne TDD).
7. Wyplata: WLASCICIEL odbiera na platformie (jego konto).

RAPORT dla wlasciciela: link, co zrobione, dowod (testy OK), jak wyslac, ryzyko (bez gwarancji kwoty).
