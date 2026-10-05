---
id: sec-forensyka
name: Podstawy forensyki
description: Zabezpieczenie i analiza sladow po incydencie (procesy, siec, pliki, hashe)
tags: [security, forensyka, incydent, dowody, hashe, procesy, siec, timeline]
---
# Podstawy forensyki
KIEDY: po incydencie - zebrac slady, nie zatrzec

1. NIE zmieniaj systemu wiecej niz trzeba - kazda komenda moze zatrzec slad.
2. Zbierz: procesy (proc_inspect), polaczenia (net_summary), zalogowanych (who).
3. Hashe kluczowych plikow (file_hash) - do wykrycia zmian.
4. Logi: skopiuj, nie edytuj; odnotuj czasy.
5. Uslugi i crony - wektory utrzymania dostepu.
6. Timeline (co, kiedy). Fakty i hipotezy osobno.
7. Przy powaznym incydencie: odetnij siec, ale NIE wylaczaj maszyny (traci sie pamiec).
