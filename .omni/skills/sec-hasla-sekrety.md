---
id: sec-hasla-sekrety
name: Higiena hasel i sekretow
description: Bezpieczne przechowywanie i rotacja kluczy, hasel i tokenow
tags: [security, hasla, sekrety, klucze, tokeny, rotacja, hashowanie]
---
# Higiena hasel i sekretow
KIEDY: przechowywanie/rotacja kluczy, hasel, tokenow

1. Sekrety NIGDY w kodzie ani publicznym repo (historia git tez). Sprawdz: git log -p | grep -i token.
2. Trzymaj w zaszyfrowanym magazynie albo zmiennych srodowiskowych.
3. Hasla: dlugie (12+), unikalne, menedzer hasel, bez reuzycia.
4. Rotacja: okresowo ORAZ po kazdym podejrzeniu wycieku.
5. Hashowanie hasel: bcrypt/argon2 z sola; NIGDY plaintext ani samo MD5/SHA1.
6. Zakres minimalny tokenow.
7. Wyciek: UNIEWAZNIJ sekret natychmiast (zmiana > ukrywanie).
