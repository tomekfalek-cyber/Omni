---
id: sec-analiza-logow
name: Analiza logow pod katem wlamania
description: Wykrywanie prob wlamania i anomalii (nieudane logowania, sudo, procesy)
tags: [security, logi, wlamanie, intrusion, ssh, sudo, detekcja, forensics]
---
# Analiza logow pod katem wlamania
KIEDY: podejrzewasz nieautoryzowany dostep albo sprawdzasz bezpieczenstwo

1. Nieudane SSH: log_tail /var/log/auth.log - 'Failed password', 'Invalid user' (duzo = brute-force).
2. Udane logowania: 'Accepted' - czy znasz wszystkie (IP, czas).
3. Sudo: komendy nieznane uzytkownikowi.
4. Nowe konta/crony: /etc/passwd, crontab -l, /etc/cron*.
5. Procesy: proc_inspect - podejrzane nazwy/sciezki, wysokie CPU.
6. Siec: net_summary - nieoczekiwane polaczenia wychodzace.
7. Timeline: powiaz zdarzenia czasowo. Zglos fakty, nie domysly.
