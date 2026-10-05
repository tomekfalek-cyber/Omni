---
id: sec-audyt-web
name: Audyt bezpieczenstwa aplikacji web
description: Testy bezpieczenstwa WLASNEJ aplikacji (OWASP: naglowki, wstrzykniecia, dostep)
tags: [security, web, owasp, xss, sqli, naglowki, audyt, http]
---
# Audyt bezpieczenstwa aplikacji web
KIEDY: testujesz bezpieczenstwo WLASNEJ aplikacji (za zgoda)

1. Naglowki: curl -I - CSP, HSTS, X-Content-Type-Options, X-Frame-Options.
2. Uwierzytelnianie: hashowanie hasel, wygasanie sesji, rate-limit.
3. Wstrzykniecia: testuj wejscia (SQL/command) na WLASNYM srodowisku testowym.
4. Kontrola dostepu: czy zmiana ID daje dostep do cudzych zasobow (IDOR).
5. Bledy: komunikaty bez stack trace i wersji.
6. HTTPS: wymuszony, wazny certyfikat, bez mieszanej tresci.
UWAGA: tylko wlasna aplikacja / pisemna zgoda.
