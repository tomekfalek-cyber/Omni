---
id: sys-ekspozycja-sieci
name: Ekspozycja sieciowa
description: Sprawdz co jest wystawione na zewnatrz (tunele, nasluch 0.0.0.0, ochrona haslem)
tags: [bezpieczenstwo, siec, ekspozycja, tunel, ngrok, cloudflared, publiczny, firewall]
---
# Ekspozycja sieciowa
KIEDY: czy cos jest wystawione, bezpieczenstwo, tunel, publiczny dostep

1. net_summary -> nasluch na 0.0.0.0 (publiczny) vs 127.0.0.1 (lokalny).
2. Sprawdz tunele (ngrok/cloudflared) i uslugi systemd, ktore je uruchamiaja.
3. Ustal, co jest za haslem, a co otwarte (API bez sesji -> 401?).
4. Zglos ekspozycje i ryzyko. NIE wylaczaj niczego bez zgody uzytkownika.
