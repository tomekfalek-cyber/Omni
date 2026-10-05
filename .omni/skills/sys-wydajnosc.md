---
id: sys-wydajnosc
name: Diagnoza wydajnosci
description: Co obciaza CPU RAM lub dysk i jak to znalezc (proc_inspect, wolne miejsce)
tags: [wydajnosc, cpu, ram, dysk, wolne, obciazenie, pamiec, swap]
---
# Diagnoza wydajnosci
KIEDY: maszyna wolna, brak pamieci, wysokie CPU, malo miejsca

1. proc_inspect (sort po CPU) -> top procesy.
2. Wolna pamiec i swap (free -m). Sprawdz, czy swap jest zajety.
3. Miejsce na dysku (df -h) dla katalogu roboczego.
4. Wskaz winowajce (PID, nazwa) i konkretna propozycje (ograniczenie, restart, czyszczenie).
