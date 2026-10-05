---
id: sys-logi-diagnoza
name: Diagnoza logow
description: Znajdz przyczyne bledu w logach serwera lub uslugi (log_tail, grep po bledach)
tags: [logi, log, blad, error, diagnoza, serwer, systemd]
---
# Diagnoza logow
KIEDY: cos sie psuje, serwer nie odpowiada, trzeba znalezc blad w logu

1. Ustal plik logu (np. /home/openclaw/omni/gateway.log albo journalctl dla uslugi systemd).
2. Uzyj log_tail (lines=80), potem zawez do bledow (grep: error, blad, exception, traceback, 500, fail).
3. Znajdz pierwsza PRAWDZIWA przyczyne, nie objaw. Sprawdz czas wystapienia.
4. Powiaz z procesem/portem (proc_inspect, net_summary). Sprawdz, czy usluga zyje (systemctl --user status).
5. Podaj przyczyne + konkretna poprawke. Po zmianie SPRAWDZ, ze blad znikl.
