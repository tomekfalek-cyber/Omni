---
id: sec-narzedzia-bez-roota
name: Narzedzia pentest bez roota
description: "Jak zdobyc nmap/hashcat/john/tcpdump na WLASNYM systemie bez uprawnien roota"
tags:
  - security
  - narzedzia
  - instalacja
  - pip
---

# Narzedzia pentest bez roota
KIEDY: potrzebujesz nmap/hashcat/john/tcpdump/sqlmap na WLASNYM systemie, a nie masz roota.

ZASADY: instaluj tylko legalne, otwarte narzedzia; do WLASNYCH testow.

KROKI:
1. Sprawdz: command -v nmap john hashcat tcpdump.
2. Bez roota: pip install --user <pkg> albo pipx; pobierz binarke do ~/bin (np. statyczny nmap).
3. tcpdump/tshark: zwykle wymagaja roota/CAP_NET_RAW - bez tego uzyj ss/netstat.
4. sqlmap: pip install --user sqlmap; john/hashcat: portowe binarki lub pip (jesli sa).
5. Weryfikacja: <tool> --version (dowod, ze dziala).
6. Zapisz sposob uruchomienia (sciezka, komenda) w pamieci srodowiska, by nie szukac ponownie.
