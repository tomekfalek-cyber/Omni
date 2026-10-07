---
id: bot-allegro
name: Bot Allegro (API REST)
description: "Wzorce i pulapki integracji z Allegro REST API - OAuth2, zakresy, oferty, EAN, zmiana ceny, limity"
tags:
  - allegro
  - api
  - e-commerce
  - bot
  - integracja
---

# Bot Allegro (API REST)
KIEDY: budujesz bota/integracje z Allegro (oferty, ceny, zamowienia, repricing).

ZASADY I PULAPKI (zweryfikuj szczegoly w developer.allegro.pl):
1. OAUTH2: token z https://allegro.pl/auth/oauth/token. 'client_credentials' daje TYLKO kontekst aplikacji - do zarzadzania wlasnymi ofertami potrzebujesz przeplywu z uzytkownikiem i zakresu typu allegro:api:offers:write.
2. NAGLOWKI: Accept: application/vnd.allegro.public.v1+json. Sandbox: BASE_URL https://api.allegro.pl.allegrosandbox.pl (testuj tam najpierw).
3. LISTA OFERT: GET /sale/offers jest STRONICOWANA (limit/offset) i zwraca OGRANICZONE pola - czesto BEZ 'ean'. Po szczegoly (EAN, stan) idz do GET /sale/offers/{offerId}. Nie zakladaj, ze ean jest na liscie.
4. ZMIANA CENY: Allegro uzywa m.in. WZORCA COMMAND dla modyfikacji. Nie wysylaj pojedynczego pola na slepo przez PUT - sprawdz w docs wymagane pola / metode (PUT pelna reprezentacja vs komenda). Zly payload = 422 albo nadpisanie oferty.
5. WYSTEPOWANIE KONKURENCJI: GET /offers/listing zwraca tez TWOJE oferty - filtruj po seller.id, inaczej 'podcinasz' sam siebie.
6. LIMITY: Allegro limituje API - obsluguj 429/Retry-After i backoff; nie odpalaj ciastej petli.
7. TOKENY: wygasaja - odswiezaj na 401. Loguj kontekst bledow (offerId, status).
8. BEZPIECZENSTWO I TOZSAMOSC: nie podejmuj akcji w imieniu wielu kont bez zgody; respektuj ToS Allegro dot. automatyzacji.
9. DOMYSLNIE DRY-RUN: repricer wlaczaj najpierw bez realnych zmian, z logiem 'co bym zmienil'.
