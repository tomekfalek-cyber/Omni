---
id: sys-zmiana-configu
name: Bezpieczna zmiana konfiguracji
description: inspect - kopia - zmiana - verify dla plikow konfiguracyjnych i uslug
tags: [konfiguracja, config, zmiana, usluga, systemd, restart, verify, backup]
---
# Bezpieczna zmiana konfiguracji
KIEDY: zmiana pliku konfiguracyjnego, ustawien uslugi, zmiennej srodowiskowej

1. INSPECT: najpierw ODCZYTAJ obecny plik (file_read) i sprawdz stan uslugi.
2. KOPIA: zapisz kopie pliku przed zmiana (file_hash do porownania).
3. PLAN: powiedz dokladnie, co i gdzie zmieniasz.
4. CHANGE: zmien minimalnie (nie nadpisuj calosci, gdy mozna edytowac punktowo).
5. VERIFY: zrestartuj usluge i SPRAWDZ, ze dziala (curl/ps/log). Przy bledzie cofnij do kopii.
