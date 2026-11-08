-- =====================================================================
-- FLUXO ÉTNICO · banco de dados no Supabase (Postgres)
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run
-- Pode rodar de novo sem medo: tudo usa "if not exists" / "or replace".
-- =====================================================================

-- ---------- 1. Perfis (quem tem acesso e o que pode fazer) ----------
create table if not exists public.perfis (
  id          uuid primary key references auth.users(id) on delete cascade,
  numero      bigint generated always as identity unique,   -- número curto usado dentro do app
  nome        text not null,
  email       text not null,
  tel         text not null default '',
  cargo       text not null default '',
  setor       text not null default 'Portaria',
  so_setor    boolean not null default false,
  perfil      text not null default 'func' check (perfil in ('admin','func')),
  ativo       boolean not null default true,
  offline     boolean not null default true,                 -- pode abrir o sistema sem internet
  trocar_senha boolean not null default true,                -- precisa criar a própria senha no 1º acesso
  perms       jsonb not null default '{}'::jsonb,            -- {"entrada":true,"saida":true,...}
  criado_em   timestamptz not null default now()
);

-- ---------- 2. Registros (visitas, agendamentos, lembretes, despesas, ajustes, auditoria, configurações) ----------
-- Cada linha é um registro. O app grava só o que mudou e busca só o que é novo,
-- então dois aparelhos não apagam o trabalho um do outro.
create table if not exists public.registros (
  colecao       text not null,
  id            text not null,
  dados         jsonb not null,
  removido      boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id),
  primary key (colecao, id)
);
create index if not exists registros_atualizado_idx on public.registros (atualizado_em);

-- carimba hora do servidor e autor em toda gravação (o aparelho não decide isso)
create or replace function public.carimba_registro() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists carimba_registro on public.registros;
create trigger carimba_registro before insert or update on public.registros
  for each row execute function public.carimba_registro();

-- ---------- 3. Funções de permissão (rodam no servidor, não dá para burlar pelo navegador) ----------
create or replace function public.eh_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from public.perfis where id = auth.uid()), false)
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ativo and perfil = 'admin' from public.perfis where id = auth.uid()), false)
$$;

create or replace function public.tem_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ativo and (perfil = 'admin' or coalesce((perms ->> p)::boolean, false))
                   from public.perfis where id = auth.uid()), false)
$$;

-- quem pode LER cada coleção
create or replace function public.pode_ler(col text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.eh_ativo() then false
    when col in ('despesas','ajustes','audit','acessos','vendasConv','despConv') then public.eh_admin()   -- dinheiro e auditoria: só administrador
    when col in ('produtos','movEstoque') then public.tem_perm('conveniencia')                              -- conveniência: quem tem a permissão
    else true
  end
$$;

-- quem pode GRAVAR em cada coleção (e, nas configurações, em cada item)
create or replace function public.pode_gravar(col text, item text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.eh_ativo() then false
    when public.eh_admin() then true
    when col = 'visits'    then public.tem_perm('entrada') or public.tem_perm('saida') or public.tem_perm('ticket') or public.tem_perm('atividades_fluxo')
    when col = 'bookings'  then public.tem_perm('agenda_edit') or public.tem_perm('entrada')
    when col = 'marks'     then public.tem_perm('agenda_edit')
    when col = 'reminders' then public.tem_perm('lembretes_criar') or public.tem_perm('lembretes')
    when col in ('vendasConv','movEstoque') then public.tem_perm('conveniencia')                  -- vender e movimentar estoque
    when col in ('audit','acessos') then true                                       -- qualquer um registra (ver abaixo: só inserir)
    when col = 'meta' and item in ('quiosques','actStatus','grupos','seq')
         then public.tem_perm('atividades_edit') or public.tem_perm('atividades_fluxo') or public.tem_perm('entrada') or public.tem_perm('saida') or public.tem_perm('agenda_edit')
    else false                                                                        -- preços, catálogo, fotos, configurações, finanças: só administrador
  end
$$;

-- ---------- 4. Regras de acesso (RLS) ----------
alter table public.perfis    enable row level security;
alter table public.registros enable row level security;

drop policy if exists perfis_ler      on public.perfis;
drop policy if exists perfis_admin    on public.perfis;
create policy perfis_ler   on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_admin());
-- alterações em perfis acontecem pela função "usuarios" (service role) ou por um administrador logado
create policy perfis_admin on public.perfis for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists registros_ler       on public.registros;
drop policy if exists registros_inserir   on public.registros;
drop policy if exists registros_alterar   on public.registros;
create policy registros_ler     on public.registros for select to authenticated
  using (public.pode_ler(colecao));
create policy registros_inserir on public.registros for insert to authenticated
  with check (public.pode_gravar(colecao, id));
-- auditoria e acessos nunca são alterados depois de gravados (nem pelo administrador pelo app)
create policy registros_alterar on public.registros for update to authenticated
  using (public.pode_gravar(colecao, id) and colecao not in ('audit','acessos'))
  with check (public.pode_gravar(colecao, id) and colecao not in ('audit','acessos'));

-- ---------- 5. Primeiro acesso: o usuário conclui a troca de senha ----------
create or replace function public.concluir_troca_senha() returns void
language sql security definer set search_path = public as $$
  update public.perfis set trocar_senha = false where id = auth.uid()
$$;
revoke all on function public.concluir_troca_senha() from public, anon;
grant execute on function public.concluir_troca_senha() to authenticated;

-- as funções de permissão não precisam ficar expostas para visitantes sem login
revoke all on function public.eh_ativo(), public.eh_admin(), public.tem_perm(text),
                       public.pode_ler(text), public.pode_gravar(text, text) from public, anon;
grant execute on function public.eh_ativo(), public.eh_admin(), public.tem_perm(text),
                          public.pode_ler(text), public.pode_gravar(text, text) to authenticated;

-- ---------- 6. Fotos das atividades ficam em "registros" (coleção meta/fotos), sem bucket extra nesta fase ----------
-- (a fase seguinte pode mover as fotos para o Supabase Storage)

-- Pronto. Próximo passo: criar o primeiro administrador (arquivo primeiro-admin.sql).
