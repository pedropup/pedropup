#!/usr/bin/env bash
# Instala a tela "Pendencias por responsavel" no PMO (https://pmo.efekty.com.br).
# So front-end: copia 2 arquivos para js/views/ e acrescenta 1 linha (a rota) em js/app.js.
# Faz copia de seguranca do app.js antes, nao mexe em banco nem em outros sistemas, e pode ser
# rodado de novo sem duplicar nada. Se nao tiver certeza de onde o PMO esta, para sem mudar nada.
#
# Uso (no terminal do servidor, como root):
#   curl -fsSL https://raw.githubusercontent.com/pedropup/pedropup/claude/claude-rc-2twp8u/pmo/instalar-pendencias.sh | bash
set -euo pipefail

BASE="${PMO_FILES_URL:-https://raw.githubusercontent.com/pedropup/pedropup/claude/claude-rc-2twp8u/pmo}"
SITE="${PMO_URL:-https://pmo.efekty.com.br}"
ROOTS="${PMO_SEARCH_ROOTS:-/opt /srv /var/www /root /home}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LINE="  people: { title: 'Pendências por responsável', group: 'Execução', load: () => import('./views/people.js') },"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nNAO CONSEGUI INSTALAR: %s\nNada foi alterado depois deste ponto. Copie tudo o que apareceu acima e mande para o Claude.\n' "$*"; exit 1; }

say "1/4 Baixando a tela nova"
curl -fsSL "$BASE/people.js" -o "$TMP/people.js" || fail "nao baixei people.js"
curl -fsSL "$BASE/people-model.js" -o "$TMP/people-model.js" || fail "nao baixei people-model.js"
grep -q "Pendencias por responsavel" "$TMP/people.js" || fail "people.js veio diferente do esperado"
grep -q "export function workload" "$TMP/people-model.js" || fail "people-model.js veio diferente do esperado"
echo "ok"

# Acrescenta a rota logo abaixo da linha de "areas" (so se ainda nao existir). Mantem dono e permissao do arquivo.
patch_app() {
  local f="$1"
  grep -q "views/people.js" "$f" && { echo "  rota ja existia em $f"; return 0; }
  grep -q "views/areas.js" "$f" || return 1
  cp -p "$f" "$f.bak-pendencias-$STAMP"
  awk -v line="$LINE" '{ print } /views\/areas\.js/ && !done { print line; done = 1 }' "$f" > "$TMP/app.js.new"
  grep -q "views/people.js" "$TMP/app.js.new" || return 1
  cat "$TMP/app.js.new" > "$f"
  echo "  rota acrescentada em $f (copia: $f.bak-pendencias-$STAMP)"
}

install_dir() { # $1 = pasta js/ do front do PMO
  local js="$1"
  cp "$TMP/people.js" "$TMP/people-model.js" "$js/views/"
  chown --reference="$js/views/areas.js" "$js/views/people.js" "$js/views/people-model.js" 2>/dev/null || true
  chmod --reference="$js/views/areas.js" "$js/views/people.js" "$js/views/people-model.js" 2>/dev/null || true
  patch_app "$js/app.js" || fail "nao consegui acrescentar a rota em $js/app.js"
  echo "  arquivos copiados para $js/views/"
}

is_pmo_js() { [ -f "$1/app.js" ] && [ -f "$1/views/areas.js" ] && grep -q "Efekty PMO" "$1/app.js"; }

say "2/4 Procurando o PMO no servidor"
found=0
# a) pastas no proprio servidor (codigo-fonte ou arquivos publicados)
while IFS= read -r f; do
  js="$(dirname "$(dirname "$f")")"
  case "$js" in *node_modules*|*bak*|*/.git/*) continue ;; esac
  if is_pmo_js "$js"; then echo "pasta: $js"; install_dir "$js"; found=$((found + 1)); fi
done < <(find $ROOTS -xdev -type f -name areas.js -path '*/js/views/*' 2>/dev/null | sort -u)

# b) conteineres Docker do PMO (os de outros sistemas ficam de fora)
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null || true); do
    case "$c" in supabase*|money-insight*|money_insight*|erp*|ctl*|controller*|traefik*|easypanel*) continue ;; esac
    paths="$(docker exec "$c" sh -c "find / -xdev -type f -name areas.js -path '*/js/views/*' 2>/dev/null | grep -v node_modules" 2>/dev/null || true)"
    for f in $paths; do
      js="$(dirname "$(dirname "$f")")"
      docker exec "$c" grep -q "Efekty PMO" "$js/app.js" 2>/dev/null || continue
      if docker exec "$c" grep -q "views/people.js" "$js/app.js" 2>/dev/null && docker exec "$c" test -f "$js/views/people.js"; then
        echo "conteiner $c:$js ja esta com a tela"; found=$((found + 1)); continue
      fi
      echo "conteiner $c: $js"
      mkdir -p "$TMP/c"
      docker cp "$c:$js/app.js" "$TMP/c/app.js"
      cp "$TMP/c/app.js" "$TMP/c/app.js.orig"
      patch_app "$TMP/c/app.js" || fail "nao consegui acrescentar a rota no app.js do conteiner $c"
      docker cp "$TMP/c/app.js.orig" "$c:$js/app.js.bak-pendencias-$STAMP"
      docker cp "$TMP/people.js" "$c:$js/views/people.js"
      docker cp "$TMP/people-model.js" "$c:$js/views/people-model.js"
      docker cp "$TMP/c/app.js" "$c:$js/app.js"
      found=$((found + 1))
    done
  done
fi

if [ "$found" -eq 0 ]; then
  echo "Nao achei o PMO. O que existe no servidor:"
  ls -la /opt 2>/dev/null || true
  command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}  {{.Image}}' || true
  fail "nao achei a pasta do PMO"
fi

say "3/4 Conferindo no site"
ok=1
curl -fsS "$SITE/js/views/people.js?v=$STAMP" 2>/dev/null | grep -q "Pendencias por responsavel" && echo "tela nova: no ar" || { echo "tela nova: o site ainda nao mostra"; ok=0; }
curl -fsS "$SITE/js/app.js?v=$STAMP" 2>/dev/null | grep -q "views/people.js" && echo "item no menu: no ar" || { echo "item no menu: o site ainda nao mostra"; ok=0; }

say "4/4 Resultado"
if [ "$ok" -eq 1 ]; then
  echo "PRONTO. Abra $SITE, entre, e veja Execucao > Pendencias por responsavel."
  echo "Se nao aparecer de primeira, recarregue a pagina."
else
  echo "Os arquivos foram instalados em $found lugar(es), mas o site ainda nao mostra a tela."
  echo "Pode ser que o PMO precise reiniciar ou ser publicado de novo. Copie tudo acima e mande para o Claude."
fi
