-- =====================================================================
-- PRIMEIRO ADMINISTRADOR
-- 1) No Supabase: Authentication > Users > Add user > Create new user
--      e-mail: o e-mail do dono (ex.: caio@fluxoetnico.com)   senha: uma senha forte
--      marque "Auto Confirm User".
-- 2) Troque o e-mail abaixo (nos dois lugares) e o nome, depois rode no SQL Editor.
-- Os demais membros são cadastrados dentro do próprio sistema (aba Equipe).
-- =====================================================================
insert into public.perfis (id, nome, email, cargo, setor, perfil, ativo, offline, trocar_senha, perms)
select id, 'Caio', email, 'Gerente', 'Administração', 'admin', true, true, false, '{}'::jsonb
from auth.users
where email = 'caio@fluxoetnico.com'
on conflict (id) do update set perfil = 'admin', ativo = true;
