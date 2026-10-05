---
id: sys-porty-procesy
name: Porty i procesy
description: Ustal co nasluchuje na porcie i ktory proces obciaza maszyne (net_summary, proc_inspect)
tags: [port, proces, procesy, netstat, ss, nasluchuje, cpu, ram, pid, eaddrinuse]
---
# Porty i procesy
KIEDY: co zajmuje port, co obciaza CPU, EADDRINUSE, ktory proces

1. net_summary -> lista nasluchujacych portow.
2. proc_inspect z filtrem (nazwa procesu) -> PID, CPU%, RAM%, czas.
3. Dopasuj port do procesu (PID). Sprawdz, czy dziala jedna czy DWIE kopie uslugi.
4. Przy EADDRINUSE: jeden port = jeden proces; znajdz i usun duplikat.
