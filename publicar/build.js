// Monta a pasta publicar/dist pronta para a Vercel.
// Uso:  node publicar/build.js        (lê SUPABASE_URL e SUPABASE_ANON_KEY de publicar/.env ou do ambiente)
// Sem as duas variáveis, o site sai em MODO DEMONSTRAÇÃO (tudo só no navegador, admin/admin).
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..', 'prototipo'), dist = path.join(__dirname, 'dist');

const env = { ...process.env };
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !l.trim().startsWith('#') && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}
const url = (env.SUPABASE_URL || '').trim(), anon = (env.SUPABASE_ANON_KEY || '').trim();
if (anon && /service_role/i.test(Buffer.from(anon.split('.')[1] || '', 'base64').toString())) { console.error('ERRO: essa é a chave "service_role" (secreta). Use a chave "anon / public".'); process.exit(1); }
if ((url && !anon) || (!url && anon)) { console.error('ERRO: preencha SUPABASE_URL e SUPABASE_ANON_KEY juntas (ou deixe as duas vazias para o modo demonstração).'); process.exit(1); }

fs.rmSync(dist, { recursive: true, force: true });
const copia = (de, para) => { fs.mkdirSync(path.dirname(para), { recursive: true }); fs.copyFileSync(de, para); };
const lista = [];
(function anda(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), rel = path.relative(raiz, p); if (fs.statSync(p).isDirectory()) anda(p); else if (!/^(LEIA-ME\.md|config\.js)$/.test(n) && !n.startsWith('.')) { copia(p, path.join(dist, rel)); lista.push(rel); } } })(raiz);

fs.writeFileSync(path.join(dist, 'config.js'), `window.FE_CONFIG = ${JSON.stringify({ url, anon })};\n`); lista.push('config.js');
copia(path.join(__dirname, 'vercel.json'), path.join(dist, 'vercel.json'));

// service worker: guarda o próprio sistema no aparelho para abrir mesmo sem internet
const versao = Date.now().toString(36);
fs.writeFileSync(path.join(dist, 'sw.js'), fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8').replace('__VERSAO__', versao).replace('__ARQUIVOS__', JSON.stringify(['./', ...lista])));
console.log(`OK: ${lista.length} arquivos em publicar/dist · ${url ? 'NUVEM ligada em ' + url : 'MODO DEMONSTRAÇÃO (sem Supabase)'}`);
