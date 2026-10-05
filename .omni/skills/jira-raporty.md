---
id: jira-raporty
name: Raporty z Jira
description: Profesjonalny raport (status sprintu, postep, ryzyka, velocity) na podstawie danych Jira
tags: [jira, raport, report, status, sprint, velocity, postep, ryzyko]
---
# Raporty z Jira
KIEDY: trzeba zrobic raport (sprint/tydzien/miesiac) z danych Jira

1. Ustal zakres: projekt/sprint/okres i JQL.
2. Zbierz dane: jira_report (liczby) + jira_search (szczegoly).
3. Struktura raportu:
   - Podsumowanie (1-2 zdania: na czym stoimy).
   - Metryki: zrobione / w toku / do zrobienia + % ukonczenia.
   - Podzial wg osoby/typu/priorytetu.
   - Ryzyka i blokery (co grozi terminowi).
   - Rekomendacje i nastepne kroki.
4. Kazda liczba musi pochodzic z Jira (nie zgaduj). Podaj JQL, ktory uzyles.
5. Format: naglowki + tabele/listy. Bez lania wody.
