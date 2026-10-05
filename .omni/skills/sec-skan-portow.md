---
id: sec-skan-portow
name: Skanowanie portow i uslug
description: Skanowanie portow WLASNEGO hosta i identyfikacja uslug/wersji
tags: [security, skan, porty, uslugi, nmap, recon, audyt]
---
# Skanowanie portow i uslug
KIEDY: inwentaryzacja otwartych portow na WLASNYM hoscie

1. Lokalnie: net_summary (ss -tuln) - najszybsze, bez ruchu sieciowego.
2. Dla wlasnego hosta w sieci: skan przez python3 (socket) lub nmap, jesli jest.
3. Dla kazdego portu: usluga, wersja, interfejs (local vs public).
4. Priorytet: porty na 0.0.0.0 (publiczne) i stare wersje.
5. Zaplanuj zamkniecie/zabezpieczenie niepotrzebnych.
UWAGA: skanuj tylko wlasne hosty / sieci z zgoda. Cudze - nielegalne.
