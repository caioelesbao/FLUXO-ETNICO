# Publicar o Fluxo Étnico (Vercel + Supabase)

Faça na ordem. Tudo que pede login é com **a sua conta** (eu não tenho acesso a elas).
Tempo estimado: 30 a 40 minutos na primeira vez.

## O que já está pronto aqui
| Pasta/arquivo | Para quê |
|---|---|
| `supabase/schema.sql` | Cria as tabelas e as regras de quem pode ler/gravar o quê (no servidor) |
| `supabase/primeiro-admin.sql` | Dá acesso de administrador ao primeiro usuário |
| `supabase/functions/usuarios/` | Função segura que cadastra membros da equipe (aba Equipe) |
| `build.js` | Monta a pasta `dist/` que vai para a Vercel |
| `vercel.json`, `sw.template.js` | Cabeçalhos de segurança e abertura do sistema sem internet |

## Parte 1 · Supabase (banco e login)
1. Entre em **supabase.com** → *New project*. Nome: `fluxo-etnico`. Região: **South America (São Paulo)**. Guarde a senha do banco.
2. Menu **SQL Editor** → *New query* → cole o conteúdo de `supabase/schema.sql` → **Run**. Deve aparecer "Success".
3. Menu **Authentication → Sign In / Providers**: deixe *Email* ligado e **desligue "Allow new users to sign up"** (só o administrador cria contas).
4. Menu **Authentication → Users → Add user → Create new user**: e-mail e senha forte do dono, marque **Auto Confirm User**.
5. **SQL Editor**: abra `supabase/primeiro-admin.sql`, troque o e-mail (e o nome), **Run**.
6. Copie 2 valores em **Project Settings → API**: *Project URL* e a chave **anon public**. (Nunca use a `service_role` no site.)
7. Publique a função da equipe (no Terminal, dentro da pasta `publicar`):
   ```bash
   cd "/Volumes/SSD RHEMA/CAIO/SISTEMA FLUXO ETNICO/publicar"
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase functions deploy usuarios
   ```
   (`SEU_PROJECT_REF` é o trecho antes de `.supabase.co` na URL do projeto.)

## Parte 2 · Montar o site
1. Copie `.env.example` para `.env` (mesma pasta) e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY`.
2. Rode:
   ```bash
   node build.js
   ```
   A última linha deve dizer **NUVEM ligada em https://…supabase.co**. Se disser "MODO DEMONSTRAÇÃO", o `.env` não foi lido.

## Parte 3 · Vercel (endereço na internet)
```bash
cd dist
npx vercel login
npx vercel --prod
```
Responda: *Set up and deploy?* **Y** · *Link to existing project?* **N** · nome `fluxo-etnico` · *directory* `./` · demais perguntas: Enter.
A Vercel mostra o endereço (`https://fluxo-etnico-….vercel.app`).

**Proteção do endereço** (Vercel → projeto → *Settings → Deployment Protection*):
- *Vercel Authentication* (grátis): só quem tem login na sua equipe da Vercel abre o site.
- *Password Protection* (a senha única no link): exige plano pago da Vercel (Pro + complemento). Se não quiser pagar agora, use a opção acima.

Com a nuvem ligada **não existe mais admin/admin**: o site só deixa entrar quem foi cadastrado no Supabase. A proteção da Vercel é uma camada extra.

## Atualizar depois
Mudou o sistema? `node build.js` e depois, dentro de `dist`, `npx vercel --prod` de novo.

## Como o sistema se comporta (resumo)
- **Cada aparelho guarda tudo localmente** e funciona sem internet. Quando a internet volta, envia só o que mudou e busca o que os outros aparelhos fizeram (a cada 15 s e ao reconectar).
- **Permissões no servidor**: funcionário nunca recebe finanças/auditoria, e o banco recusa gravações sem permissão, mesmo que alguém mexa no navegador.
- **Entrar sem internet** só vale para quem já entrou naquele aparelho antes e está com "Entra sem internet" ligado.
- **Código do ticket repetido** (dois aparelhos offline gerando FE-0010): o que chegar primeiro mantém o número; o outro recebe o próximo número livre.

## Limites desta fase (combinar antes de usar de verdade)
1. **Plano grátis do Supabase** pausa o projeto após 7 dias sem uso e não tem cópia diária automática. Para uso real, plano **Pro** (cópias diárias) ou baixar cópia pela aba Configurações todo dia.
2. **Impressora térmica** ainda é por PDF/impressão do navegador; impressão direta exige o app de computador (próxima fase).
3. **Fotos das atividades** ficam no próprio banco (vale para poucas fotos). Se forem muitas, passam para o Supabase Storage.
4. **CPF e telefone** são dados pessoais (LGPD): mantenha só administradores com acesso ao painel do Supabase e use senhas fortes.
5. **"Esqueci minha senha"** é pelo administrador (Equipe → Editar acessos → nova senha). Recuperação por e-mail exige configurar envio de e-mail no Supabase.
