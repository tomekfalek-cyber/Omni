---
id: cli-argparse
name: Odporne CLI (argparse)
description: Pisanie CLI w Pythonie tak, by radzily sobie z argumentami zaczynajacymi sie od minusa i blednym wejsciem
tags: [cli, argparse, python, argumenty, opcje, minus, walidacja]
---
# Odporne CLI (argparse)
KIEDY: piszesz program z linii komend w Pythonie (argumenty, opcje)

1. Pamietaj: argumenty zaczynajace sie od '-' sa traktowane jak OPCJE. Wyrazenie typu '-5+3' NIE zadziala jako zwykly argument.
2. Rozwiazania: parser.add_argument('wyrazenie', nargs=argparse.REMAINDER) albo przyjmowanie po '--', albo wczytanie ze stdin.
3. Waliduj wejscie: zle dane -> czytelny komunikat i kod wyjscia (systemexit 2), nie traceback.
4. Dla wyrazen matematycznych: lacz argumenty w jeden string przed obliczeniem.
5. Zawsze dodaj --help z opisem i przykladem uzycia.
