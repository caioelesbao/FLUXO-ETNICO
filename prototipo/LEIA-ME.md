# Fluxo Étnico — protótipo navegável

Abra `index.html` (duplo clique) ou sirva a pasta com qualquer servidor local.

## Entrar (modo demonstração)
- Administrador: usuário `admin`, senha `admin` (conta simples de demonstração: troque antes de usar de verdade)
- Administrador: `caio@fluxoetnico.com`
- Funcionária: `maria@fluxoetnico.com`
- A senha de exemplo aparece na própria tela de entrada enquanto o **Modo demonstração** estiver ligado
  (Configurações → Acesso e segurança). Desligue antes de usar de verdade.
- Membro novo (aba Equipe) recebe uma senha provisória e cria a própria no primeiro acesso.
- Saída automática após 20 minutos sem mexer. 5 senhas erradas bloqueiam o e-mail por 1 minuto.

## Onde ficam os dados
Neste aparelho, no banco do navegador (IndexedDB `fluxo-etnico`):
- `kv/estado`: tudo o que foi registrado (visitas, compras, tickets, agendamentos, atividades, equipe, finanças, lembretes, configurações).
- `backups`: as últimas 10 cópias automáticas e manuais.
- O histórico fictício de 1 ano **não** é gravado: é gerado de novo a cada abertura (Configurações → Dados de exemplo).
- As senhas nunca são guardadas em texto: só o resultado da derivação (PBKDF2-SHA256, 120 mil voltas, sal único por pessoa).

## Cópia de segurança (Configurações → Armazenamento)
Fazer cópia agora · Baixar cópia (arquivo .json, inclui os acessos da equipe: guarde em lugar seguro) ·
Restaurar de arquivo ou de uma cópia automática (antes de restaurar, o sistema cria uma cópia dos dados atuais) ·
Apagar todos os dados deste aparelho.

## O que muda no sistema real
O protótipo grava no navegador. No sistema real as mesmas operações passam a gravar no banco do servidor local da portaria
(SQLite) e a fila de envio sincroniza com a nuvem. As funções `snapshot()`, `aplicaSnapshot()`, `salvaTudo()` e o objeto `DB`
são o ponto de troca; as telas não mudam.


## Publicação (Vercel + Supabase)
Este mesmo código vira o sistema real: com `config.js` preenchido (feito pelo `publicar/build.js`) ele usa login e dados do Supabase; vazio, continua neste modo demonstração. Passo a passo em `publicar/PUBLICAR.md`.
