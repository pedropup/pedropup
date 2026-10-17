#!/usr/bin/env bash
# Instala o filtro de responsavel no Command Center do PMO (https://pmo.efekty.com.br).
# So front-end: atualiza js/views/command-center.js e copia js/views/people.js e people-model.js.
# Tambem tira do menu o item "Pendencias por responsavel" da versao anterior (os links antigos
# continuam funcionando: caem no Command Center ja filtrado).
# Seguro: faz copia de cada arquivo antes de mudar; so troca o command-center.js se ele for
# exatamente a versao conhecida (sha256 abaixo); pode rodar de novo sem duplicar nada; se nao tiver
# certeza de onde o PMO esta, para sem mudar nada. Nao mexe em banco nem em outros sistemas.
#
# Uso (no terminal do servidor, como root):
#   curl -fsSL https://raw.githubusercontent.com/pedropup/pedropup/claude/claude-rc-2twp8u/pmo/instalar-pendencias.sh | bash
set -euo pipefail

BASE="${PMO_FILES_URL:-https://raw.githubusercontent.com/pedropup/pedropup/claude/claude-rc-2twp8u/pmo}"
SITE="${PMO_URL:-https://pmo.efekty.com.br}"
ROOTS="${PMO_SEARCH_ROOTS:-/opt /srv /var/www /root /home}"
CC_ORIGINAL_SHA="${PMO_CC_SHA:-eeef9b1aafb6db1d53f96c40ec6ee820f921027bed949f21872b98ddf88af315}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nNAO CONSEGUI INSTALAR: %s\nCopie tudo o que apareceu acima e mande para o Claude.\n' "$*"; exit 1; }
backup() { [ -f "$1" ] && cp -p "$1" "$1.bak-pendencias-$STAMP" && echo "  copia de seguranca: $1.bak-pendencias-$STAMP"; }

say "1/4 Baixando os arquivos"
mkdir -p "$TMP/new"
for f in people.js people-model.js command-center.js; do curl -fsSL "$BASE/$f" -o "$TMP/new/$f" || fail "nao baixei $f"; done
grep -q "Pendencias por responsavel" "$TMP/new/people.js" || fail "people.js veio diferente do esperado"
grep -q "export function workload" "$TMP/new/people-model.js" || fail "people-model.js veio diferente do esperado"
grep -q "function personFilter" "$TMP/new/command-center.js" || fail "command-center.js veio diferente do esperado"
echo "ok"

# Instala numa pasta js/ do front do PMO. Devolve 0 se instalou ou ja estava instalado.
install_dir() {
  local js="$1" v="$1/views"
  # command-center.js: so troca a versao conhecida
  if grep -q "function personFilter" "$v/command-center.js"; then
    if ! cmp -s "$TMP/new/command-center.js" "$v/command-center.js"; then backup "$v/command-center.js"; cat "$TMP/new/command-center.js" > "$v/command-center.js"; echo "  command-center.js atualizado"; else echo "  command-center.js ja estava atualizado"; fi
  else
    local sha; sha="$(sha256sum "$v/command-center.js" | cut -d' ' -f1)"
    [ "$sha" = "$CC_ORIGINAL_SHA" ] || fail "o command-center.js em $v e uma versao que eu nao conheco (sha256 $sha). Nao troquei para nao apagar mudancas de outra pessoa."
    backup "$v/command-center.js"; cat "$TMP/new/command-center.js" > "$v/command-center.js"; echo "  filtro de responsavel colocado no command-center.js"
  fi
  for f in people.js people-model.js; do
    if [ -f "$v/$f" ] && cmp -s "$TMP/new/$f" "$v/$f"; then continue; fi
    backup "$v/$f" || true
    cp "$TMP/new/$f" "$v/$f"
    chown --reference="$v/areas.js" "$v/$f" 2>/dev/null || true
    chmod --reference="$v/areas.js" "$v/$f" 2>/dev/null || true
    echo "  $f copiado"
  done
  # tira o item de menu da versao anterior, se existir
  if grep -q "views/people.js" "$js/app.js"; then
    backup "$js/app.js"
    grep -v "views/people.js" "$js/app.js" > "$TMP/app.js.new"
    cat "$TMP/app.js.new" > "$js/app.js"
    echo "  item separado tirado do menu (agora o filtro fica no Command Center)"
  fi
}

is_pmo_js() { [ -f "$1/app.js" ] && [ -f "$1/views/areas.js" ] && [ -f "$1/views/command-center.js" ] && grep -q "Efekty PMO" "$1/app.js"; }

say "2/4 Procurando o PMO no servidor"
found=0
# a) pastas no proprio servidor
while IFS= read -r f; do
  js="$(dirname "$(dirname "$f")")"
  case "$js" in *node_modules*|*bak*|*/.git/*) continue ;; esac
  if is_pmo_js "$js"; then echo "pasta: $js"; install_dir "$js"; found=$((found + 1)); fi
done < <(find $ROOTS -xdev -type f -name areas.js -path '*/js/views/*' 2>/dev/null | sort -u)

# b) conteineres Docker do PMO (os de outros sistemas ficam de fora): copia para fora, instala, devolve
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null || true); do
    case "$c" in supabase*|money-insight*|money_insight*|erp*|ctl*|controller*|traefik*|easypanel*) continue ;; esac
    paths="$(docker exec "$c" sh -c "find / -xdev -type f -name areas.js -path '*/js/views/*' 2>/dev/null | grep -v node_modules" 2>/dev/null || true)"
    for f in $paths; do
      js="$(dirname "$(dirname "$f")")"
      docker exec "$c" grep -q "Efekty PMO" "$js/app.js" 2>/dev/null || continue
      echo "conteiner $c: $js"
      w="$TMP/c-$c"; rm -rf "$w"; mkdir -p "$w/views"
      docker cp "$c:$js/app.js" "$w/app.js"
      for x in areas.js command-center.js people.js people-model.js; do docker cp "$c:$js/views/$x" "$w/views/$x" 2>/dev/null || true; done
      install_dir "$w"
      for x in "$w"/app.js.bak-* "$w"/views/*.bak-*; do [ -e "$x" ] && docker cp "$x" "$c:$js/${x#"$w"/}"; done
      docker cp "$w/app.js" "$c:$js/app.js"
      for x in command-center.js people.js people-model.js; do docker cp "$w/views/$x" "$c:$js/views/$x"; done
      found=$((found + 1))
    done
  done
fi

if [ "$found" -eq 0 ]; then
  echo "Nao achei o PMO. O que existe no servidor:"
  ls -la /opt 2>/dev/null || true
  command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}  {{.Image}}' 2>/dev/null || true
  fail "nao achei a pasta do PMO"
fi

say "3/4 Conferindo no site"
ok=1
curl -fsS "$SITE/js/views/command-center.js?v=$STAMP" 2>/dev/null | grep -q "function personFilter" && echo "filtro no Command Center: no ar" || { echo "filtro no Command Center: o site ainda nao mostra"; ok=0; }
curl -fsS "$SITE/js/views/people.js?v=$STAMP" 2>/dev/null | grep -q "ctx.embedded" && echo "visao por pessoa: no ar" || { echo "visao por pessoa: o site ainda nao mostra"; ok=0; }
curl -fsS "$SITE/js/app.js?v=$STAMP" 2>/dev/null | grep -q "views/people.js" && { echo "menu: o item antigo ainda aparece"; ok=0; } || echo "menu: sem o item duplicado"

say "4/4 Resultado"
if [ "$ok" -eq 1 ]; then
  echo "PRONTO. Abra $SITE, recarregue a pagina (Ctrl+F5) e use o filtro 'Responsavel' no topo do Command Center."
else
  echo "Os arquivos foram instalados em $found lugar(es), mas o site ainda nao mostra tudo."
  echo "Pode ser que o PMO precise reiniciar ou ser publicado de novo. Copie tudo acima e mande para o Claude."
fi
