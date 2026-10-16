---
id: sec-privesc-linux
name: Audyt eskalacji uprawnien (Linux)
description: "Sprawdzenie sciezek podniesienia uprawnien na WLASNYM hoscie Linux - SUID, crony, sudo, capabilities"
tags:
  - security
  - linux
  - privesc
  - audyt
---

# Audyt eskalacji uprawnien (Linux)
KIEDY: audyt eskalacji uprawnien na wlasnym hoscie (np. po kontrolowanym dostepie w testach).

TWARDE ZASADY: tylko systemy WLASNE albo z PISEMNA zgoda; atakowanie cudzych = ODMAWIAM. Najpierw inwentarz pasywny, potem testy aktywne. Zawsze podaj DOWOD (komenda + wynik) i ryzyko.

KROKI:
1. Tozsamosc: id; whoami; sudo -l (co wolno bez/ z haslem).
2. SUID/SGID: find / -perm -4000 -type f 2>/dev/null (podejrzane binarki).
3. Crony: cat /etc/crontab; ls -l /etc/cron.*; crontab -l.
4. Zapisywalne krytyczne: ls -l /etc/passwd /etc/shadow; szukaj plikow zadan z prawem zapisu.
5. Capabilities: getcap -r / 2>/dev/null.
6. Uslugi i PATH: systemctl list-units --type=service; echo $PATH (zapisywalne katalogi w PATH?).
7. Wersje: uname -a (podatne jadro), przestarzale pakiety.
8. RAPORT: wektor -> dowod (komenda+wynik) -> ryzyko -> naprawa (least privilege, chmod, sudoers, wygaszenie).
