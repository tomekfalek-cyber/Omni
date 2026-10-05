---
id: jwt-auth
name: Uwierzytelnianie JWT
description: Logowanie i ochrona endpointow tokenem JWT (hash hasel, weryfikacja, testy)
tags: [jwt, auth, token, bezpieczenstwo]
---
# Uwierzytelnianie JWT
KIEDY: logowanie i ochrona endpointow tokenem JWT

1. Hashuj hasla (bcrypt/argon2) - nigdy plaintext.
2. Endpoint /login zwraca token (HS256, sekret z env, exp).
3. Zaleznosc weryfikujaca token z naglowka Authorization.
4. Chronione endpointy wymagaja tej zaleznosci.
5. Testy: brak tokenu=401, zly token=401, poprawny=200. URUCHOM je.
6. Sekret trzymaj w env, nigdy w kodzie.
