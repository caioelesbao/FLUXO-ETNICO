/* =============== NUVEM (Supabase): login real, dados compartilhados e envio sem pressa ===============
   Só liga quando config.js traz a URL e a chave pública do projeto Supabase. Sem isso o sistema segue em
   modo demonstração, 100% no aparelho, como antes.
   Como funciona: o aparelho continua gravando tudo localmente (funciona sem internet). Em segundo plano,
   este arquivo (1) busca o que mudou na nuvem, (2) envia o que mudou aqui. Cada registro é uma linha no banco,
   então dois aparelhos não apagam o trabalho um do outro. As regras de quem pode ler/gravar o quê ficam no banco (RLS). */
const NUVEM = (() => {
  const FE = window.FE_CONFIG || {};
  const ativo = !!(FE.url && FE.anon && window.supabase);
  const DOMINIO = '@usuarios.fluxoetnico.app';
  const ARR = ['visits', 'bookings', 'reminders', 'despesas', 'ajustes', 'marks', 'audit', 'acessos', 'produtos', 'vendasConv', 'movEstoque', 'despConv']; // listas guardadas, uma linha por item
  const SO_ADMIN = ['despesas', 'ajustes', 'audit', 'acessos', 'vendasConv', 'despConv'];
  const NOVO_NA_FRENTE = ['visits', 'reminders', 'audit', 'acessos', 'vendasConv', 'movEstoque'];
  const PERM_ESCRITA = { visits: ['entrada', 'saida', 'ticket', 'atividades_fluxo'], bookings: ['agenda_edit', 'entrada'], reminders: ['lembretes_criar', 'lembretes'], marks: ['agenda_edit'], vendasConv: ['conveniencia'], movEstoque: ['conveniencia'] };
  const META_OPERADOR = ['quiosques', 'actStatus', 'grupos', 'seq'];
  const META_PERM = ['atividades_edit', 'atividades_fluxo', 'entrada', 'saida', 'agenda_edit'];
  const N = { ativo, sb: null, env: {}, cursor: null, adminOk: true, ocupado: false, aviso: '', ultimaSync: null, _senha: null, _t: null, _lastPend: -1 };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const canon = v => v === undefined ? 'null' : v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  const hash = s => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = (((a << 5) + a) ^ c) | 0; b = (((b << 5) + b) + c * 31) | 0; } return (a >>> 0).toString(36) + (b >>> 0).toString(36) + s.length; };
  const ehRede = e => !!e && (e instanceof TypeError || /failed to fetch|networkerror|load failed|network request|fetch/i.test(e.message || '') || (e.status === 0));
  N.emailDe = u => { u = String(u || '').trim().toLowerCase(); return u.includes('@') ? u : u + DOMINIO; };
  N.emailVisivel = e => String(e || '').replace(DOMINIO, '');
  const chave = (col, id) => col + '|' + id;
  const keyArr = (col, x) => col === 'visits' ? x.code : (x._id || (x._id = uid()));

  /* ---------- o que é meta (configurações e contadores): um valor por linha ---------- */
  const META = {
    cfg: { get: () => S.cfg, set: d => { S.cfg = d; } },
    catalogo: { get: () => CATALOGO, set: d => { if (Array.isArray(d) && d.length) { CATALOGO.length = 0; CATALOGO.push(...d); } } },
    quiosques: { get: () => S.quiosques, set: d => { if (Array.isArray(d)) S.quiosques = d; } },
    grupos: { get: () => S.grupos, set: d => { S.grupos = d || {}; } },
    actStatus: { get: () => S.actStatus, set: d => { S.actStatus = d || {}; } },
    pinPos: { get: () => S.pinPos, set: d => { S.pinPos = d || {}; try { localStorage.setItem('fe-pins', JSON.stringify(S.pinPos)); } catch (e) {} } },
    pontos: { get: () => PONTOS.filter(p => p.custom), set: d => { for (let i = PONTOS.length - 1; i >= 0; i--) if (PONTOS[i].custom) PONTOS.splice(i, 1); (d || []).forEach(p => PONTOS.push(p)); } },
    fotos: { get: () => FOTOS_CUSTOM, set: d => { Object.keys(FOTOS_CUSTOM).forEach(k => delete FOTOS_CUSTOM[k]); Object.assign(FOTOS, FOTOS_BASE); Object.entries(d || {}).forEach(([k, v]) => { FOTOS_CUSTOM[k] = v; if (v === null) delete FOTOS[k]; else FOTOS[k] = v; }); } },
    seq: { get: () => ({ v: S.seq }), set: d => { if (d && typeof d.v === 'number') S.seq = Math.max(S.seq, d.v); } },
  };

  /* ---------- permissões (espelho do que o banco confere; o banco é quem manda) ---------- */
  const podeLer = col => SO_ADMIN.includes(col) ? isAdmin() : (col === 'produtos' || col === 'movEstoque') ? can('conveniencia') : true;
  const podeGravar = (col, item) => {
    if (isAdmin()) return true;
    if (col === 'audit' || col === 'acessos') return true;
    if (col === 'meta') return META_OPERADOR.includes(item) && META_PERM.some(can);
    return (PERM_ESCRITA[col] || []).some(can);
  };

  /* ---------- estado de sincronização guardado no aparelho (junto dos dados, no mesmo banco) ---------- */
  async function carregaEstado() {
    try { const r = DB.ok ? await DB.get('nuvem') : JSON.parse(localStorage.getItem('fe-nuvem') || 'null'); if (r) { N.env = r.env || {}; N.cursor = r.cursor || null; N.adminOk = r.adminOk !== false; } } catch (e) {}
  }
  async function salvaEstado() {
    const r = { env: N.env, cursor: N.cursor, adminOk: N.adminOk };
    try { if (DB.ok) await DB.set('nuvem', r); else localStorage.setItem('fe-nuvem', JSON.stringify(r)); } catch (e) {}
  }

  /* ---------- começo: zera os dados de exemplo e carrega o que o aparelho já guardava ---------- */
  N.preBoot = async () => {
    const hist = (() => { try { return localStorage.getItem('fe-hist') === '1'; } catch (e) { return false; } })(); // histórico fictício: só neste aparelho, nunca vai para a nuvem
    if (!hist) limparHistorico();
    const soH = a => (a || []).filter(x => x.h);
    Object.assign(S, { visits: soH(S.visits), bookings: soH(S.bookings), reminders: [], despesas: soH(S.despesas), ajustes: soH(S.ajustes), marks: [], team: [], audit: [], acessos: [], demo: false, seq: 0, nextId: 1, semHist: !hist });
    S.quiosques.forEach(q => { q.s = 'Livre'; });
    S.uidSeq = 1e6 + Math.floor(Math.random() * 9e8); // faixa própria deste aparelho: evita número repetido entre aparelhos
    N.sb = supabase.createClient(FE.url, FE.anon, { auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage } });
    await carregaEstado();
  };
  N.depoisDoSnapshot = () => { S.demo = false; S.semHist = (() => { try { return localStorage.getItem('fe-hist') !== '1'; } catch (e) { return true; } })(); S.uidSeq = Math.max(S.uidSeq, 1e6 + Math.floor(Math.random() * 9e8)); };

  /* ---------- perfil (conta + permissões) ---------- */
  function mapPerfil(p, antigo) {
    const perms = mkPerms([]); if (p.perfil !== 'admin') Object.keys(perms).forEach(k => { perms[k] = !!(p.perms || {})[k]; });
    const m = { id: p.numero, uid: p.id, nome: p.nome, email: N.emailVisivel(p.email), tel: p.tel || '', cargo: p.cargo || '', setor: p.setor || 'Portaria', soSetor: !!p.so_setor, perfil: p.perfil, ativo: !!p.ativo, offline: !!p.offline, mustChange: !!p.trocar_senha, fraca: false, perms };
    if (antigo && antigo.hash && !m.mustChange) Object.assign(m, { salt: antigo.salt, hash: antigo.hash, alg: antigo.alg }); // senha só para entrar sem internet, nunca sai deste aparelho
    return m;
  }
  function poeNaEquipe(m) { const i = S.team.findIndex(x => x.uid === m.uid || x.id === m.id); if (i >= 0) S.team[i] = m; else S.team.push(m); }
  // administrador recebe a equipe inteira; os outros recebem só a si mesmos e mantêm no aparelho quem já entrou aqui (para entrar sem internet)
  function mesclaEquipe(linhas) {
    const novos = linhas.map(p => mapPerfil(p, S.team.find(x => x.uid === p.id)));
    const souAdmin = novos.some(x => x.id === S.userId && x.perfil === 'admin');
    S.team = [...novos, ...(souAdmin ? [] : S.team.filter(x => !novos.some(n => n.uid === x.uid)))];
  }
  async function buscaPerfis() {
    const { data, error } = await N.sb.from('perfis').select('*').order('numero');
    if (error) throw error;
    mesclaEquipe(data); return data;
  }

  /* ---------- entrar ---------- */
  N.login = async (typed, senha) => {
    const email = N.emailDe(typed);
    if (!navigator.onLine || !S.online) { // sem internet: só quem já entrou aqui antes e tem permissão
      const m = S.team.find(x => x.email && N.emailDe(x.email) === email && x.ativo);
      if (m && m.offline && await confereSenha(m, senha)) { N._senha = senha; return { ok: m }; }
      return { erro: m && m.offline ? 'E-mail ou senha incorretos.' : 'Sem internet. O seu acesso só funciona com internet ou depois de já ter entrado neste aparelho.' };
    }
    const { data, error } = await N.sb.auth.signInWithPassword({ email, password: senha });
    if (error) {
      if (ehRede(error)) { S.online = false; return N.login(typed, senha); }
      return { erro: /invalid|credentials/i.test(error.message) ? 'E-mail ou senha incorretos.' : /banned|disabled/i.test(error.message) ? 'Este acesso está desativado. Fale com o administrador.' : 'Não foi possível entrar agora. Tente de novo.' };
    }
    const { data: p, error: e2 } = await N.sb.from('perfis').select('*').eq('id', data.user.id).maybeSingle();
    if (e2 || !p) { await N.sb.auth.signOut(); return { erro: 'Esta conta ainda não tem acesso ao sistema. Fale com o administrador.' }; }
    if (!p.ativo) { await N.sb.auth.signOut(); return { erro: 'Este acesso está desativado. Fale com o administrador.' }; }
    const m = mapPerfil(p, S.team.find(x => x.uid === p.id));
    if (m.offline && !m.mustChange) Object.assign(m, await hashSenha(senha));
    poeNaEquipe(m); N._senha = senha;
    return { ok: m };
  };
  N.trocaSenha = async (id, nova) => {
    const m = S.team.find(x => x.id === id), er = $('#tr-err');
    const { error } = await N.sb.auth.updateUser({ password: nova });
    if (error) { er.textContent = /same|different/i.test(error.message) ? 'Escolha uma senha diferente da provisória.' : 'Não foi possível salvar a senha agora. Tente de novo.'; return; }
    const { error: e2 } = await N.sb.rpc('concluir_troca_senha');
    if (e2) { er.textContent = 'A senha foi salva, mas não deu para concluir o primeiro acesso. Tente entrar de novo.'; return; }
    m.mustChange = false; if (m.offline) Object.assign(m, await hashSenha(nova)); N._senha = nova;
    registraAcesso(m.nome + ' criou a própria senha', true); entrar(id);
  };
  // reabrir a aba: só continua se a sessão do navegador ainda vale e a conta existe neste aparelho
  N.restaura = async () => {
    const id = lerSessao(); if (!id) return null;
    const { data } = await N.sb.auth.getSession();
    if (!data.session && navigator.onLine) return null;
    return id;
  };
  N.aoEntrar = async () => {
    const adm = isAdmin();
    if (adm && !N.adminOk) { N.cursor = null; N.adminOk = true; }
    if (!adm) { // aparelho compartilhado: quem não é administrador não guarda dinheiro nem auditoria (só o que ainda não foi enviado fica)
      SO_ADMIN.forEach(c => {
        const manter = (S[c] || []).filter(x => N.env[chave(c, keyArr(c, x))] !== hash(canon(x)));
        Object.keys(N.env).forEach(k => { if (k.startsWith(c + '|')) delete N.env[k]; });
        S[c] = manter;
      });
      N.adminOk = false;
    }
    N.agenda(); N.sincroniza(); iniciaTimer();
  };
  N.aoSair = async () => {
    try { if (navigator.onLine) await Promise.race([N.sincroniza(), new Promise(r => setTimeout(r, 4000))]); } catch (e) {}
    N._senha = null; try { await N.sb.auth.signOut(); } catch (e) {}
  };

  /* ---------- diferenças entre o que está aqui e o que já foi enviado ---------- */
  function diff() {
    const up = [], vivos = new Set();
    ARR.forEach(col => {
      if (!podeLer(col) || !podeGravar(col)) return;
      (S[col] || []).forEach(x => { if (x.h) return; const k = chave(col, keyArr(col, x)); vivos.add(k); const h = hash(canon(x)); if (N.env[k] !== h) up.push({ col, id: k.slice(col.length + 1), dados: x, h, k }); });
    });
    Object.keys(META).forEach(id => {
      if (!podeGravar('meta', id)) return; const k = chave('meta', id); vivos.add(k);
      const v = META[id].get(), h = hash(canon(v)); if (N.env[k] !== h) up.push({ col: 'meta', id, dados: v, h, k });
    });
    const del = Object.keys(N.env).filter(k => { const col = k.split('|')[0]; return ARR.includes(col) && !['audit', 'acessos'].includes(col) && podeLer(col) && podeGravar(col) && !vivos.has(k); });
    return { up, del };
  }
  N.contaPend = () => { try { const d = diff(); return d.up.length + d.del.length; } catch (e) { return 0; } };

  /* ---------- trazer da nuvem ---------- */
  async function pull() {
    let off = 0, maxT = N.cursor, mudou = false;
    for (;;) {
      let q = N.sb.from('registros').select('colecao,id,dados,removido,atualizado_em').order('atualizado_em').order('colecao').order('id').range(off, off + 999);
      if (N.cursor) q = q.gte('atualizado_em', N.cursor);
      const { data, error } = await q; if (error) throw error;
      data.forEach(r => { if (aplica(r)) mudou = true; if (!maxT || r.atualizado_em > maxT) maxT = r.atualizado_em; });
      if (data.length < 1000) break; off += 1000;
    }
    if (maxT) N.cursor = new Date(new Date(maxT).getTime() - 5000).toISOString(); // folga de 5 s: um pedido lento não fica para trás
    return mudou;
  }
  function aplica(r) {
    const { colecao: col, id } = r, k = chave(col, id);
    if (col === 'meta') {
      const m = META[id]; if (!m) return false;
      if (N.env[k] !== undefined && N.env[k] !== hash(canon(m.get()))) return false; // alteração local ainda não enviada vence
      if (N.env[k] === hash(canon(r.dados))) return false;
      m.set(r.dados); N.env[k] = hash(canon(m.get())); return true;
    }
    if (!ARR.includes(col) || !podeLer(col)) return false;
    const lista = S[col] || (S[col] = []), i = lista.findIndex(x => keyArr(col, x) === id), loc = i >= 0 ? lista[i] : null;
    if (r.removido) { if (loc) { if (N.env[k] !== undefined && N.env[k] !== hash(canon(loc))) return false; lista.splice(i, 1); delete N.env[k]; return true; } return false; }
    if (loc) {
      if (N.env[k] === undefined) { // código de visita repetido por dois aparelhos sem internet: o que chegou primeiro fica, o daqui ganha número novo
        if (col === 'visits' && loc.quando !== r.dados.quando) { S.visits.forEach(v => { S.seq = Math.max(S.seq, +String(v.code).replace(/\D/g, '') || 0); }); S.seq = Math.max(S.seq, +String(r.dados.code).replace(/\D/g, '') || 0); loc.code = 'FE-' + String(++S.seq).padStart(4, '0'); lista.unshift(r.dados); N.env[k] = hash(canon(r.dados)); return true; }
        return false;
      }
      if (N.env[k] !== hash(canon(loc))) return false; // ainda não enviado: não sobrescreve
      if (N.env[k] === hash(canon(r.dados))) return false;
      lista[i] = r.dados; N.env[k] = hash(canon(r.dados)); return true;
    }
    if (col === 'visits') S.seq = Math.max(S.seq, +String(r.dados.code).replace(/\D/g, '') || 0);
    if (NOVO_NA_FRENTE.includes(col)) lista.unshift(r.dados); else lista.push(r.dados);
    N.env[k] = hash(canon(r.dados)); return true;
  }

  /* ---------- enviar para a nuvem ---------- */
  async function push() {
    const { up, del } = diff(); if (!up.length && !del.length) return 0;
    const linhas = [...up.map(u => ({ colecao: u.col, id: u.id, dados: u.dados, removido: false, _h: u.h, _k: u.k })), ...del.map(k => ({ colecao: k.split('|')[0], id: k.slice(k.indexOf('|') + 1), dados: {}, removido: true, _h: null, _k: k }))];
    let recusados = 0;
    for (let i = 0; i < linhas.length; i += 100) {
      const lote = linhas.slice(i, i + 100), nomal = lote.filter(l => !['audit', 'acessos'].includes(l.colecao)), soIns = lote.filter(l => ['audit', 'acessos'].includes(l.colecao));
      const limpa = l => ({ colecao: l.colecao, id: l.id, dados: l.dados, removido: l.removido });
      const grava = async (ls, ign) => {
        if (!ls.length) return;
        const { error } = await N.sb.from('registros').upsert(ls.map(limpa), { onConflict: 'colecao,id', ignoreDuplicates: ign });
        if (error) {
          if (ehRede(error)) throw error;
          if (error.status === 401 || /jwt/i.test(error.message)) { const e = new Error('sessao'); e.sessao = true; throw e; }
          for (const l of ls) { // o lote foi recusado: tenta um a um para só travar o que o banco não aceita
            const r = await N.sb.from('registros').upsert([limpa(l)], { onConflict: 'colecao,id', ignoreDuplicates: ign });
            if (r.error) { if (ehRede(r.error)) throw r.error; recusados++; console.warn('Registro recusado pelo banco', l.colecao, l.id, r.error.message); }
            marca(l);
          }
          return;
        }
        ls.forEach(marca);
      };
      const marca = l => { if (l.removido) delete N.env[l._k]; else N.env[l._k] = l._h; };
      await grava(nomal, false); await grava(soIns, true);
      await salvaEstado();
    }
    if (recusados) N.aviso = recusados + ' registro(s) não foram aceitos pelo servidor (sem permissão). Avise o administrador.';
    return linhas.length;
  }

  /* ---------- rodada de sincronização ---------- */
  async function renovaSessao() {
    const { data } = await N.sb.auth.getSession(); if (data.session) return true;
    if (N._senha && S.userId) { const m = eu(); const r = await N.sb.auth.signInWithPassword({ email: N.emailDe(m.email), password: N._senha }); return !r.error; }
    return false;
  }
  N.sincroniza = async manual => {
    if (!S.pronto || !S.userId || N.ocupado) return;
    if (!navigator.onLine && !manual) { atualizaPend(); return; }
    N.ocupado = true; let mudou = false;
    try {
      if (!(await renovaSessao())) { N.aviso = 'Entre de novo (com internet) para enviar os registros.'; return; }
      const p = await buscaPerfis(), meu = p.find(x => x.numero === S.userId);
      const assinatura = () => JSON.stringify(eu().perms) + eu().perfil + eu().setor + eu().soSetor;
      if (!meu || !meu.ativo) { toast('Seu acesso foi desativado.'); sair('desativado'); return; }
      const antes = assinatura(); // buscaPerfis já trocou os dados; compara com o que a tela mostra
      if (N._assin !== undefined && N._assin !== antes) mudou = true; N._assin = antes;
      if (await pull()) mudou = true;
      await push();
      await salvaEstado();
      N.aviso = N.aviso && /recusados|aceitos/.test(N.aviso) ? N.aviso : ''; N.ultimaSync = new Date();
      if (!S.online) { S.online = true; mudou = true; }
    } catch (e) {
      if (e && e.sessao) N.aviso = 'Entre de novo (com internet) para enviar os registros.';
      else if (ehRede(e)) { if (S.online) { S.online = false; mudou = true; } }
      else { N.aviso = 'Não foi possível sincronizar agora. Vamos tentar de novo.'; console.warn('sync', e); }
    } finally {
      N.ocupado = false;
      const pend = N.contaPend(); if (pend !== S.pend) { S.pend = pend; mudou = true; }
      if (mudou) { try { salvaTudo(); } catch (e) {} reRender(); }
    }
  };
  const emEdicao = () => { const a = document.activeElement; return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || ($('#layer') && $('#layer').innerHTML.trim()); };
  function reRender() { if (!S.userId) return; if (emEdicao()) { setTimeout(reRender, 4000); return; } render(); fillWho(); }
  function atualizaPend() { const p = N.contaPend(); if (p !== S.pend) { S.pend = p; if (!emEdicao()) render(); } }
  N.agenda = () => { clearTimeout(N._t); N._t = setTimeout(() => { if (navigator.onLine && S.online) N.sincroniza(); else atualizaPend(); }, 1200); };

  let _timer = false;
  function iniciaTimer() {
    if (_timer) return; _timer = true;
    setInterval(() => { if (S.userId && navigator.onLine) N.sincroniza(); }, 15000);
    window.addEventListener('online', () => { S.online = true; if (S.userId) { toast('Internet voltou. Enviando os registros…'); N.sincroniza(true); } });
    window.addEventListener('offline', () => { S.online = false; if (S.userId) { toast('Sem internet. Os registros ficam salvos neste aparelho.'); render(); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.userId) N.sincroniza(); });
  }
  N.iniciaRede = () => { S.online = navigator.onLine; };

  /* ---------- equipe: criar e alterar contas (pela função segura no servidor) ---------- */
  async function chamaUsuarios(corpo) {
    const { data, error } = await N.sb.functions.invoke('usuarios', { body: corpo });
    if (error) { let msg = 'Não foi possível concluir agora.'; try { const j = await error.context.json(); if (j && j.erro) msg = j.erro; } catch (e) {} throw new Error(msg); }
    if (data && data.erro) throw new Error(data.erro); return data;
  }
  N.salvaMembro = async () => {
    const M = S.mem, erros = [], novo = !M.id, senha = (M.senha || '').trim();
    if (!M.nome.trim()) erros.push('Informe o nome.');
    if (!(M.cargo || '').trim()) erros.push('Informe o cargo.');
    if (M.perfil === 'admin') { M.setor = 'Administração'; M.soSetor = false; }
    if (!/^\S+@\S+\.\S+$/.test(M.email) && !/^[a-z0-9._-]{3,}$/i.test(M.email)) erros.push('Informe um e-mail válido (ou um usuário com pelo menos 3 letras ou números).');
    if (S.team.some(x => x.id !== M.id && x.email.toLowerCase() === M.email.toLowerCase())) erros.push('Este e-mail já está cadastrado.');
    if (!navigator.onLine || !S.online) erros.push('Sem internet. Cadastrar ou alterar membros exige estar conectado.');
    if (novo && senha.length < 8) erros.push('Defina uma senha provisória com pelo menos 8 caracteres (use “Gerar senha”).');
    if (!novo && senha && senha.length < 8) erros.push('A nova senha precisa ter pelo menos 8 caracteres.');
    if (erros.length) { alert(erros.join('\n')); return; }
    const antes = M.id && S.team.find(x => x.id === M.id);
    if (!novo && antes && !antes.uid) { alert('Esta conta não está ligada à nuvem.'); return; }
    if (M.perfil === 'admin' && !(antes && antes.perfil === 'admin') && !confirm('Dar acesso de Administrador a ' + M.nome + '? Essa pessoa verá finanças e configurações.')) return;
    if (antes && antes.ativo && !M.ativo && !confirm('Desativar ' + M.nome + '? A pessoa perde o acesso agora.')) return;
    const corpo = { acao: novo ? 'criar' : 'atualizar', id: antes && antes.uid, email: N.emailDe(M.email), senha, trocar: M.trocar !== false, nome: M.nome.trim(), tel: M.tel, cargo: M.cargo.trim(), setor: M.setor, soSetor: M.soSetor, perfil: M.perfil, ativo: M.ativo, offline: M.offline, perms: M.perms };
    const bt = document.querySelector('#layer .modal-foot .primary'); if (bt) { bt.disabled = true; bt.textContent = 'Salvando…'; }
    try { await chamaUsuarios(corpo); } catch (e) { if (bt) { bt.disabled = false; bt.textContent = novo ? 'Cadastrar membro' : 'Salvar alterações'; } alert(e.message); return; }
    logAudit(meuNome() + (novo ? ' cadastrou o membro “' : senha ? ' redefiniu a senha e alterou os acessos de “' : ' alterou os acessos de “') + M.nome + '”'); markPending();
    try { await buscaPerfis(); } catch (e) {}
    toast(novo ? M.nome + ' cadastrado(a). Entregue a senha provisória à pessoa.' : senha ? 'Alterações salvas. Entregue a senha nova à pessoa.' : 'Alterações salvas.');
    fechar(); fillWho(); render();
  };
  return N;
})();
