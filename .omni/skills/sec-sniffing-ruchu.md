---
id: sec-sniffing-ruchu
name: Analiza ruchu sieciowego (wlasny segment)
description: "Przechwycenie i analiza ruchu na WLASNEJ sieci - wykrywanie niezaszyfrowanych danych, DNS, TLS"
tags:
  - security
  - siec
  - sniffing
  - tcpdump
---

# Analiza ruchu sieciowego (wlasny segment)
KIEDY: diagnoza lub audyt WLASNEJ sieci (co leci nieszyfrowane, jakie polaczenia).

TWARDE ZASADY: tylko systemy WLASNE albo z PISEMNA zgoda; atakowanie cudzych = ODMAWIAM. Najpierw inwentarz pasywny, potem testy aktywne. Zawsze podaj DOWOD (komenda + wynik) i ryzyko.

KROKI:
1. Interfejsy: ip a (wybierz wlasciwy).
2. Jesli jest tcpdump/tshark: tcpdump -i any -c 50 -nn (krotka probka).
3. Brak narzedzi: uzyj ss -tunap (stan polaczen) albo python/scapy, jesli dostepne.
4. Filtr: host/port, np. tcpdump -i any port 80 (HTTP = jawny tekst).
5. Analiza: szukaj naglowkow Authorization/Cookie (HTTP), zapytan DNS, SNI TLS.
6. Wnioski: co jest nieszyfrowane -> wdrozyc TLS/HTTPS, HSTS.
7. UWAGA: tcpdump/tshark zwykle wymaga roota/CAP_NET_RAW; nie podsłuchuj cudzego ruchu.
