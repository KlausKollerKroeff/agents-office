# Regras de lançamento de agentes

## PROIBIDO
- Nunca criar arquivos `.sh` temporários em `.tmp/` para lançar agentes
- Nunca usar `printf '%s' <base64> | base64 --decode | osascript -` — o shell expande variáveis no base64 antes do decode
- Nunca passar comandos inline com shell escaping manual — é frágil

## COMO O SERVIDOR ABRE O TERMINAL (implementação correta)
O `server.js` usa a função `openTerminalTab(title, command)` que:
1. Monta o AppleScript em memória (string JS)
2. Salva em um arquivo `.scpt` temporário em `os.tmpdir()` (ex: `/tmp/agent-office-1234.scpt`)
3. Executa `osascript '/tmp/agent-office-1234.scpt'`
4. Deleta o arquivo `.scpt` depois

Isso evita TODOS os problemas de shell quoting e injeção.

## Exemplo do AppleScript gerado
```applescript
tell application "Terminal"
    if not (exists window 1) then do script ""
    activate
    do script "cd '/Users/.../agent-office' && claude -r meu-agente" in window 1
    set custom title of front window to "Nome do Agente"
    set title displays custom title of front window to true
end tell
```

## Motivo dos erros anteriores
- `.tmp/launch-XXXX.sh` → arquivos deletados antes da execução
- `base64 | osascript -` → shell expande `$VAR` dentro do base64 antes do decode
- Solução: arquivo `.scpt` temporário em `/tmp/` — criado e deletado atomicamente

## Nunca modificar a função openTerminalTab sem testar

## Garantia de delegação
- Sempre delegate trabalho aos agentes da equipe (Luca, Ellie, Mateo, Yoda). Nunca faça o trabalho você mesmo, mesmo para mudanças simples. Isso é obrigatório em todas as tarefas.