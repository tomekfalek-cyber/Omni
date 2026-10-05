---
id: sec-recon-lokalny
name: Rekonesans lokalny (wlasny system)
description: Inwentaryzacja wlasnego hosta - porty, uslugi, uzytkownicy, uprawnienia
tags: [security, recon, rekonesans, porty, uslugi, pentest, audyt]
---
# Rekonesans lokalny
KIEDY: poznajesz powierzchnie ataku WLASNEGO systemu (audyt/pentest za zgoda)

1. Porty i uslugi: net_summary (ss -tuln) - co nasluchuje i na jakim interfejsie (0.0.0.0 = publiczne).
2. Procesy: proc_inspect - ktore uslugi dzialaja i jako kto.
3. Uzytkownicy i sudo: /etc/passwd, getent group sudo, sudo -l.
4. Wersje kluczowych uslug (ssh, http) - stare = znane CVE.
5. Uprawnienia: pliki swiat-pisalne (find / -perm -o+w), pliki SUID.
6. Zapisz inwentarz; oznacz rzeczy publicznie wystawione.
UWAGA: tylko wlasny system / pisemna zgoda. Nigdy cudze.
