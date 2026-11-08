// Edge Function "usuarios": cria, altera e desativa contas da equipe.
// Precisa existir no servidor porque criar conta exige a chave de serviço (service role),
// que NUNCA pode ir para o navegador. Só administradores ativos conseguem chamar.
//
// Publicar:  supabase functions deploy usuarios
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // quem está chamando? (o token do próprio usuário logado)
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const quem = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u } = await quem.auth.getUser();
  if (!u?.user) return json({ erro: "Sessão inválida. Entre de novo." }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: eu } = await admin.from("perfis").select("perfil, ativo").eq("id", u.user.id).single();
  if (!eu || !eu.ativo || eu.perfil !== "admin") return json({ erro: "Só administradores podem gerenciar a equipe." }, 403);

  let b: any;
  try { b = await req.json(); } catch { return json({ erro: "Pedido inválido." }, 400); }

  const campos = (p: any) => ({
    nome: String(p.nome || "").trim(),
    tel: String(p.tel || ""),
    cargo: String(p.cargo || "").trim(),
    setor: String(p.setor || "Portaria"),
    so_setor: !!p.soSetor,
    perfil: p.perfil === "admin" ? "admin" : "func",
    ativo: p.ativo !== false,
    offline: p.offline !== false,
    perms: p.perfil === "admin" ? {} : (p.perms && typeof p.perms === "object" ? p.perms : {}),
  });

  if (b.acao === "criar") {
    const email = String(b.email || "").trim().toLowerCase();
    const senha = String(b.senha || "");
    if (!email || senha.length < 8) return json({ erro: "Informe o e-mail e uma senha de pelo menos 8 caracteres." }, 400);
    const c = campos(b);
    if (!c.nome) return json({ erro: "Informe o nome." }, 400);
    const { data: novo, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
    if (error || !novo.user) return json({ erro: error?.message?.includes("already") ? "Este e-mail já está cadastrado." : (error?.message || "Não foi possível criar a conta.") }, 400);
    const { error: e2 } = await admin.from("perfis").insert({ id: novo.user.id, email, trocar_senha: b.trocar !== false, ...c });
    if (e2) { await admin.auth.admin.deleteUser(novo.user.id); return json({ erro: e2.message }, 400); }
    return json({ ok: true, id: novo.user.id });
  }

  if (b.acao === "atualizar") {
    const id = String(b.id || "");
    if (!id) return json({ erro: "Falta indicar a pessoa." }, 400);
    const c = campos(b);
    if (id === u.user.id && (c.perfil !== "admin" || !c.ativo))
      return json({ erro: "Você não pode tirar o seu próprio acesso de administrador nem se desativar." }, 400);
    const mudanca: Record<string, unknown> = { ...c };
    if (b.senha) {
      if (String(b.senha).length < 8) return json({ erro: "A nova senha precisa ter pelo menos 8 caracteres." }, 400);
      mudanca.trocar_senha = b.trocar !== false;
    }
    const { error } = await admin.from("perfis").update(mudanca).eq("id", id);
    if (error) return json({ erro: error.message }, 400);
    const auth: Record<string, unknown> = { ban_duration: c.ativo ? "none" : "876000h" }; // desativado = sem entrar nunca mais
    if (b.senha) auth.password = String(b.senha);
    const { error: e3 } = await admin.auth.admin.updateUserById(id, auth);
    if (e3) return json({ erro: e3.message }, 400);
    return json({ ok: true });
  }

  return json({ erro: "Ação desconhecida." }, 400);
});
