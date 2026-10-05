---
id: sec-kryptografia
name: Kryptografia w praktyce
description: Hashowanie, szyfrowanie i podpisy - poprawne uzycie bez typowych bledow
tags: [security, kryptografia, hashe, szyfrowanie, podpis, aes, rsa, tls]
---
# Kryptografia w praktyce
KIEDY: hashowanie, szyfrowanie, weryfikacja integralnosci

1. Integralnosc: SHA-256 (file_hash) do porownania plikow.
2. Hasla: bcrypt/argon2/scrypt + sola (nie szybkie hashe).
3. Szyfrowanie symetryczne: AES-GCM (authenticated); nie ECB.
4. Asymetryczne: RSA/Ed25519 dla podpisow i wymiany kluczy.
5. TLS: wazny certyfikat, TLS 1.2+, bez samopodpisanych na produkcji.
6. Nie wymyslaj wlasnej kryptografii - uzywaj sprawdzonych bibliotek.
7. Klucze: losowe (crypto), nie z hasel.
