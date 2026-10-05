---
id: crud-rest
name: CRUD REST
description: Operacje create/read/update/delete na zasobie z walidacja i testami
tags: [crud, rest, api, endpoint]
---
# CRUD REST
KIEDY: operacje create/read/update/delete na zasobie

1. Zdefiniuj model zasobu i schematy (create/update/read).
2. Warstwa danych (repository) oddzielona od HTTP.
3. Endpointy: POST /z, GET /z, GET /z/{id}, PATCH /z/{id}, DELETE /z/{id}.
4. Walidacja wejscia + kody odpowiedzi (201/200/204/404/422).
5. Testy: happy path, brak zasobu, bledne dane. URUCHOM je.
