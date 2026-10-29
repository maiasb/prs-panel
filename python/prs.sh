#!/usr/bin/env bash
# prs [init] [porta]  sobe o painel em segundo plano e abre o navegador
# prs stop     derruba o painel
# prs status   mostra se está rodando
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ESTADO="${XDG_STATE_HOME:-$HOME/.local/state}/painel-prs"
PIDFILE="$ESTADO/pid"; PORTFILE="$ESTADO/porta"; LOG="$ESTADO/painel.log"
mkdir -p "$ESTADO"

rodando() {
  local pid; pid=$(cat "$PIDFILE" 2>/dev/null) || return 1
  [ -n "$pid" ] && tr '\0' ' ' 2>/dev/null < "/proc/$pid/cmdline" | grep -q painel.py
}

case "${1:-start}" in
  stop)
    if rodando; then
      kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE" "$PORTFILE" && echo "Painel encerrado."
    else
      rm -f "$PIDFILE" "$PORTFILE"; echo "O painel não está rodando."
    fi ;;
  status)
    if rodando; then echo "Rodando em http://127.0.0.1:$(cat "$PORTFILE") (pid $(cat "$PIDFILE"))"
    else echo "Parado."; fi ;;
  start|init|[0-9]*)
    PORTA=8765; for a in "$@"; do [[ "$a" =~ ^[0-9]+$ ]] && PORTA="$a"; done
    if rodando; then
      URL="http://127.0.0.1:$(cat "$PORTFILE")"
      echo "Já está rodando em $URL"; xdg-open "$URL" >/dev/null 2>&1 || true; exit 0
    fi
    setsid nohup python3 "$DIR/painel.py" "$PORTA" >"$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"; echo "$PORTA" > "$PORTFILE"
    sleep 1
    if rodando; then echo "Painel em http://127.0.0.1:$PORTA (rodando em segundo plano; 'prs stop' para encerrar)"
    else rm -f "$PIDFILE" "$PORTFILE"; echo "Falhou ao subir:"; tail -5 "$LOG"; exit 1; fi ;;
  *) echo "uso: prs [init] [porta] | prs stop | prs status"; exit 1 ;;
esac
