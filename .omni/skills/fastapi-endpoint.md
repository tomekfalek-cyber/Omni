---
id: fastapi-endpoint
name: Endpoint FastAPI
description: Dodanie endpointu API w Pythonie (FastAPI) z walidacja, obsluga bledow i testem
tags: [fastapi, python, api, endpoint, rest]
---
# Endpoint FastAPI
KIEDY: dodanie endpointu API w Pythonie (FastAPI)

1. Sprawdz strukture projektu (code_map) i istniejace konwencje.
2. Zdefiniuj model Pydantic (wejscie/wyjscie) z typami i walidacja.
3. Dodaj funkcje async z dekoratorem @app.get/@app.post, zwracaj model.
4. Obsluz bledy: HTTPException z kodem i komunikatem.
5. Napisz test (pytest + TestClient) i URUCHOM go.
6. Uruchom serwer i sprawdz realnie: curl -sS http://127.0.0.1:PORT/...
