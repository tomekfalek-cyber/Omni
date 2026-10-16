---
id: zarobek-bounty
name: "Zarobek: bounty OSS i bug bounty"
description: "Procedura: znajdz zlecenie, przygotuj (bounty_run), wykonaj (TDD), wypchnij PR (bounty_pr); stan platform sprawdzony 2026-10-16"
tags:
  - zarobek
  - bounty
  - oss
  - bugbounty
  - hackerone
  - bugcrowd
---

# Zarobek: bounty OSS i bug bounty
KIEDY: wlasciciel prosi o znalezienie/obsluge zlecenia z nagroda (bounty).

ZASADY: legalnie; bez lamania ToS; bug bounty TYLKO w zakresie programu (regula 19/33). Nie obiecuj zarobku. Nie podawaj danych bankowych/portfela botowi - wyplata idzie na konto wlasciciela na platformie.

STAN PLATFORM (sprawdzone na zywo 2026-10-16):
- HackerOne: https://hackerone.com  -> DZIALA (bug bounty, bezpieczenstwo; wymaga umiejetnosci sec).
- Bugcrowd: https://www.bugcrowd.com -> DZIALA (bug bounty, bezpieczenstwo/pentesty).
- GitHub label:bounty -> glownie FARM, uzywaj narzedzia bounty_finder (filtr: >15 gwiazdek, >30 dni, bez 'bounty' w nazwie repo).
- Algora (algora.io) -> ZMIENIONE: platforma REKRUTACYJNA (zatrudnianie), NIE bounties.
- IssueHunt (issuehunt.io) -> ZMIENIONE: program ujawniania podatnosci / bug bounty (security).
- Gitcoin (gitcoin.co) -> ZMIENIONE: baza wiedzy / granty public goods, NIE klasyczne bounty.
- Polar (polar.sh) -> NIE bounty: billing dla firm AI.
- Bountysource -> niedostepne (blad SSL / projekt zamkniety).
WNIOSEK: darmowy 'OSS bounty za poprawke kodu' prawie zniknal. Realne kanaly: bug bounty (security) albo zwykle zlecenia (freelance: Upwork/Fiverr - konto + weryfikacja).

KROKI:
1. Znajdz zlecenie (bounty_finder albo platforma). Odrzuc farmy (0 gwiazdek, repo 'na noc', brak escrow).
2. Zgloszenie: WLASCICIEL klika Claim/Apply na platformie (jego konto; logowanie zwykle przez GitHub).
3. Przygotowanie: bounty_run {url} -> klonuje repo + zapisuje ISSUE.md.
4. Praca: przeczytaj ISSUE.md i kod (code_map/file_read), zaplanuj, zaimplementuj + TESTY (TDD), uruchom.
5. Wyslanie: bounty_pr {dir,title,body} (wymaga GITHUB_TOKEN i zgody) -> fork + push + PR.
6. Review: odpowiedz na uwagi maintainera, popraw (kolejne TDD).
7. Wyplata: WLASCICIEL odbiera na platformie (jego konto i jego metoda wyplaty).

RAPORT: link, co zrobione, dowod (testy OK), jak wyslac, ryzyko (bez gwarancji kwoty).
