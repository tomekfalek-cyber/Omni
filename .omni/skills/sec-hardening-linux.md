---
id: sec-hardening-linux
name: Hardening Linuxa
description: Wzmacnianie hosta - SSH, firewall, uprawnienia, aktualizacje, sekrety
tags: [security, hardening, ssh, firewall, uprawnienia, aktualizacje, linux]
---
# Hardening Linuxa
KIEDY: chcesz zmniejszyc powierzchnie ataku swojego serwera

1. SSH: wylacz hasla (PasswordAuthentication no), root login (PermitRootLogin no), uzywaj kluczy.
2. Firewall: domyslnie blokuj, otworz tylko potrzebne porty (ufw/nftables).
3. Aktualizacje: regularne, zwlaszcza krytyczne.
4. Uprawnienia: minimalne (600 sekrety, 700 katalogi prywatne); bez swiat-pisalnych.
5. Sekrety: poza repo, zaszyfrowane, w zmiennych srodowiskowych.
6. Uslugi: wylacz nieuzywane (mniej kodu = mniej bledow).
7. Zmieniaj PO JEDNEJ rzeczy i SPRAWDZAJ, czy nie zablokowales sobie dostepu.
