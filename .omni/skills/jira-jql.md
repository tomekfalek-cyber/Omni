---
id: jira-jql
name: Zapytania JQL
description: Budowanie poprawnych zapytan JQL (projekt, status, osoba, sprint, data, tekst)
tags: [jira, jql, zapytanie, query, filtr, search, sprint, status]
---
# Zapytania JQL
KIEDY: trzeba znalezc/filtrowac zadania w Jira

1. Podstawy: "project = ABC", "status = \"In Progress\"", "assignee = currentUser()".
2. Sprint: "sprint in openSprints()" (aktywny), "sprint = 123" (konkretny).
3. Czas: "created >= -7d", "updated >= startOfWeek()", "duedate < now()".
4. Typ/priorytet: "issuetype = Bug", "priority in (High, Highest)".
5. Tekst: "text ~ \"logowanie\"".
6. Laczenie: AND / OR / NOT + nawiasy do grupowania.
7. Zawsze dodaj "order by" (np. "order by priority DESC, updated DESC").
8. Uruchom przez jira_search; przy bledzie skladni uprosc zapytanie i sprawdzaj fragmentami.
