---
id: jira-analiza-tablicy
name: Analiza tablicy Jira
description: Analiza boardu/sprintu - WIP, bottleneck, zadania zablokowane i rozklad pracy
tags: [jira, board, tablica, sprint, analiza, wip, bottleneck, kanban, scrum]
---
# Analiza tablicy Jira
KIEDY: trzeba przeanalizowac tablice/sprint (co sie dzieje, gdzie sa problemy)

1. Ustal board (jira_boards) i aktywny sprint (jira_sprints, state=active).
2. Pobierz zadania sprintu: jira_search z "sprint in openSprints() AND project = ABC".
3. Rozklad po statusie i osobie (jira_report) - gdzie praca sie pietrzy.
4. Szukaj sygnalow problemu: zadania dlugo w "In Progress", brak ruchu, blokery, nieprzypisane.
5. Wnioski: 3-5 konkretnych obserwacji + rekomendacja (bez ogolnikow).
