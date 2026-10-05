---
id: jira-tworzenie-zgloszen
name: Tworzenie zgloszen w Jira
description: Zaklada dobrze sformulowane zadania (user story, bug, task) z opisem, kryteriami akceptacji i priorytetem
tags: [jira, zgloszenie, issue, task, story, bug, ticket, backlog]
---
# Tworzenie zgloszen w Jira
KIEDY: trzeba zalozyc zadanie/bug/user story w Jira

1. Ustal projekt (klucz, np. ABC) i typ (Task/Story/Bug/Epic).
2. Tytul konkretny i jednoznaczny: nie "poprawka", a "Logowanie: blad 500 przy pustym hasle".
3. Story: "Jako [rola] chce [cel], aby [korzysc]".
4. Kryteria akceptacji: lista sprawdzalnych warunkow (Given/When/Then).
5. Bug: kroki reprodukcji, wynik oczekiwany vs rzeczywisty, srodowisko.
6. Priorytet i etykiety (labels) wg konwencji projektu.
7. Uzyj jira_create_issue. Jesli nie znasz typu/priorytetu - najpierw jira_search po podobnych zadaniach.
