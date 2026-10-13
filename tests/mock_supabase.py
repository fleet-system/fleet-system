#!/usr/bin/env python3
"""
Local stand-in for Supabase, used ONLY for testing the web UI in this sandbox.
Implements the subset of Supabase Auth + PostgREST that the app uses, running
every query against the real local PostgreSQL with RLS (role authenticated +
request.jwt.claim.sub), exactly like Supabase does. Also serves the web/ folder.

Usage: python3 -I mock_supabase.py --db fleet_ui --port 8787 --web ../web
Test password for every user: test1234
"""
import argparse, base64, json, os, re, subprocess, time, urllib.parse, uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ap = argparse.ArgumentParser()
ap.add_argument('--db', default='fleet_ui')
ap.add_argument('--port', type=int, default=8787)
ap.add_argument('--web', default=os.path.join(os.path.dirname(__file__), '..', 'web'))
ap.add_argument('--max-rows', type=int, default=1000)
A = ap.parse_args()
MAX_ROWS = A.max_rows
PG = ['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', A.db, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
FILES, TOKENS = {}, {}
IDENT = re.compile(r'^[a-z_][a-z0-9_]*$')


def lit(v):
    if v is None:
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"


def ident(x):
    if not IDENT.match(x):
        raise ValueError('bad identifier: ' + x)
    return '"' + x + '"'


def run_sql(sql, sub=None, owner=False):
    pre = ''
    if owner:
        pre = 'begin;\n'
    elif sub:
        pre = f"begin;\nset local role authenticated;\nset local request.jwt.claim.sub = {lit(sub)};\n"
    else:
        pre = "begin;\nset local role anon;\n"
    p = subprocess.run(PG, input=pre + sql + ";\ncommit;\n", capture_output=True, text=True)
    if p.returncode != 0:
        m = re.search(r'ERROR:\s+(.*)', p.stderr)
        raise RuntimeError(m.group(1) if m else p.stderr.strip())
    return p.stdout.strip()


def make_token(sub, email):
    payload = {'sub': sub, 'email': email, 'exp': int(time.time()) + 3600, 'role': 'authenticated'}
    b = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')
    return 'h.' + b + '.s'


def read_token(h):
    if not h or not h.startswith('Bearer '):
        return None
    try:
        part = h[7:].split('.')[1]
        part += '=' * (-len(part) % 4)
        p = json.loads(base64.urlsafe_b64decode(part))
        return p if p['exp'] > time.time() else None
    except Exception:
        return None


OPS = {'eq': '=', 'neq': '<>', 'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<=', 'like': 'like', 'ilike': 'ilike'}


def cond(col, expr):
    neg = False
    if expr.startswith('not.'):
        neg, expr = True, expr[4:]
    op, _, val = expr.partition('.')
    c = ident(col)
    if op == 'is':
        s = f"{c} is {'null' if val == 'null' else 'true' if val == 'true' else 'false'}"
    elif op == 'in':
        items = [x.strip().strip('"') for x in val.strip('()').split(',') if x.strip()]
        s = f"{c}::text in ({','.join(lit(i) for i in items)})"
    elif op in OPS:
        if op in ('like', 'ilike'):
            val = val.replace('*', '%')
        s = f"{c}::text {OPS[op]} {lit(val)}" if op in ('like', 'ilike') else f"{c} {OPS[op]} {lit(val)}"
    else:
        raise ValueError('bad operator ' + op)
    return f"not ({s})" if neg else s


def or_group(val, joiner=' or '):
    # or=(col.op.val,col2.op.val)
    parts, depth, cur = [], 0, ''
    for ch in val.strip()[1:-1]:
        if ch == ',' and depth == 0:
            parts.append(cur); cur = ''
        else:
            depth += ch == '('; depth -= ch == ')'; cur += ch
    parts.append(cur)
    out = []
    for p in parts:
        col, _, rest = p.partition('.')
        out.append(cond(col, rest))
    return '(' + joiner.join(out) + ')'


def where_clause(q):
    w = []
    for k, vals in q.items():
        if k in ('select', 'order', 'limit', 'offset', 'on_conflict', 'columns'):
            continue
        for v in vals:
            w.append(or_group(v) if k == 'or' else or_group(v, ' and ') if k == 'and' else cond(k, v))
    return (' where ' + ' and '.join(w)) if w else ''


def select_list(q):
    s = q.get('select', ['*'])[0]
    if s == '*':
        return '*'
    return ', '.join(ident(c.strip()) for c in s.split(','))


def order_clause(q):
    if 'order' not in q:
        return ''
    out = []
    for part in q['order'][0].split(','):
        bits = part.split('.')
        o = ident(bits[0])
        if 'desc' in bits: o += ' desc'
        if 'nullslast' in bits: o += ' nulls last'
        if 'nullsfirst' in bits: o += ' nulls first'
        out.append(o)
    return ' order by ' + ', '.join(out)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Expose-Headers', 'Content-Range')

    def send(self, code, body, headers=None, ctype='application/json'):
        data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', ctype)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send(204, b'')

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'null') if n else None

    def route(self, method):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query, keep_blank_values=True)
        path = u.path
        try:
            if path.startswith('/auth/v1/'):
                return self.auth(method, path, q)
            if path.startswith('/storage/v1/'):
                return self.storage(method, path[len('/storage/v1/'):], q)
            if path.startswith('/rest/v1/'):
                tok = read_token(self.headers.get('Authorization'))
                sub = tok['sub'] if tok else None
                if self.headers.get('Authorization') and not tok:
                    return self.send(401, {'message': 'JWT expired', 'code': 'PGRST301'})
                return self.rest(method, path[9:], q, sub)
            return self.static(path)
        except RuntimeError as e:
            msg = str(e)
            code = 403 if ('row-level security' in msg or 'permission denied' in msg) else 400
            return self.send(code, {'message': msg, 'code': 'P0001'})
        except ValueError as e:
            return self.send(400, {'message': str(e), 'code': 'PGRST100'})

    def auth(self, method, path, q):
        if path == '/auth/v1/token' and method == 'POST':
            b = self.body() or {}
            gt = q.get('grant_type', [''])[0]
            if gt == 'password':
                if b.get('password') != 'test1234':
                    return self.send(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials'})
                row = run_sql(f"select id from auth.users where lower(email) = lower({lit(b.get('email'))})", owner=True)
                if not row:
                    return self.send(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials'})
                sub, email = row, b['email']
            elif gt == 'refresh_token':
                sub, _, email = (b.get('refresh_token') or '').partition('|')
                if not sub:
                    return self.send(400, {'error': 'invalid_grant'})
            else:
                return self.send(400, {'error': 'unsupported_grant_type'})
            return self.send(200, {'access_token': make_token(sub, email), 'token_type': 'bearer', 'expires_in': 3600,
                                   'expires_at': int(time.time()) + 3600, 'refresh_token': sub + '|' + email,
                                   'user': {'id': sub, 'email': email}})
        if path == '/auth/v1/user':
            tok = read_token(self.headers.get('Authorization'))
            if not tok:
                return self.send(401, {'message': 'invalid JWT'})
            return self.send(200, {'id': tok['sub'], 'email': tok['email']})
        if path == '/auth/v1/logout':
            return self.send(204, b'')
        return self.send(404, {'message': 'not found'})

    def rest(self, method, rel, q, sub):
        prefer = self.headers.get('Prefer', '')
        if rel.startswith('rpc/'):
            fn = ident(rel[4:])
            args = self.body() or {}
            a = ', '.join(f"{ident(k)} => {lit(v if not isinstance(v, (dict, list)) else json.dumps(v))}" for k, v in args.items())
            out = run_sql(f"select coalesce(to_json({fn}({a})), 'null'::json)", sub)
            return self.send(200, (out or 'null').encode())  # JSON text as PostgREST returns it (scalars stay quoted)
        t = ident(rel)
        if method == 'GET':
            # مثل Supabase: حد أقصى 1000 صف في الطلب الواحد (max_rows)
            lim = f" limit {min(int(q['limit'][0]), MAX_ROWS) if 'limit' in q else MAX_ROWS}"
            off = f" offset {int(q['offset'][0])}" if 'offset' in q else ''
            w = where_clause(q)
            out = run_sql(f"select coalesce(json_agg(x), '[]'::json) from (select {select_list(q)} from {t}{w}{order_clause(q)}{lim}{off}) x", sub)
            rows = json.loads(out)
            hdr = {}
            if 'count=exact' in prefer:
                total = run_sql(f"select count(*) from {t}{w}", sub)
                hdr['Content-Range'] = f"0-{max(len(rows) - 1, 0)}/{total}"
            return self.send(200, rows, hdr)
        if method == 'POST':
            b = self.body()
            rows = b if isinstance(b, list) else [b]
            out = []
            for r in rows:
                cols = ', '.join(ident(k) for k in r)
                vals = ', '.join(lit(v if not isinstance(v, (dict, list)) else json.dumps(v)) for v in r.values())
                res = run_sql(f"with i as (insert into {t} ({cols}) values ({vals}) returning *) select coalesce(json_agg(i), '[]'::json) from i", sub)
                out += json.loads(res)
            return self.send(201, out if 'return=representation' in prefer else b'')
        if method == 'PATCH':
            b = self.body() or {}
            sets = ', '.join(f"{ident(k)} = {lit(v if not isinstance(v, (dict, list)) else json.dumps(v))}" for k, v in b.items())
            res = run_sql(f"with u as (update {t} set {sets}{where_clause(q)} returning *) select coalesce(json_agg(u), '[]'::json) from u", sub)
            return self.send(200, json.loads(res) if 'return=representation' in prefer else b'')
        if method == 'DELETE':
            res = run_sql(f"with d as (delete from {t}{where_clause(q)} returning *) select coalesce(json_agg(d), '[]'::json) from d", sub)
            return self.send(200, json.loads(res) if 'return=representation' in prefer else b'')
        return self.send(405, {'message': 'method not allowed'})

    def storage(self, method, rel, q):
        # Minimal Supabase Storage: upload, sign, download. RLS on storage.objects is enforced via the DB.
        if rel.startswith('object/sign/'):
            rest = rel[len('object/sign/'):]
            bucket, _, key = rest.partition('/')
            if method == 'GET':
                tok = q.get('token', [''])[0]
                if TOKENS.get(tok) != key or key not in FILES:
                    return self.send(400, {'message': 'invalid signature'})
                ctype, data = FILES[key]
                return self.send(200, data, ctype=ctype)
            tok = read_token(self.headers.get('Authorization'))
            if not tok:
                return self.send(401, {'message': 'unauthorized'})
            n = run_sql(f"select count(*) from storage.objects where bucket_id = {lit(bucket)} and name = {lit(key)}", tok['sub'])
            if n != '1':
                return self.send(400, {'statusCode': '404', 'error': 'not_found', 'message': 'Object not found'})
            t = uuid.uuid4().hex
            TOKENS[t] = key
            return self.send(200, {'signedURL': f'/object/sign/{bucket}/{key}?token={t}'})
        if rel.startswith('object/') and method == 'POST':
            bucket, _, key = rel[len('object/'):].partition('/')
            tok = read_token(self.headers.get('Authorization'))
            if not tok:
                return self.send(401, {'message': 'unauthorized'})
            nbytes = int(self.headers.get('Content-Length') or 0)
            data = self.rfile.read(nbytes)
            if nbytes > 20 * 1024 * 1024:
                return self.send(413, {'message': 'Payload too large'})
            try:
                run_sql(f"insert into storage.objects(bucket_id, name) values ({lit(bucket)}, {lit(key)})", tok['sub'])
            except RuntimeError as e:
                return self.send(403, {'statusCode': '403', 'error': 'Unauthorized', 'message': str(e)})
            FILES[key] = (self.headers.get('content-type') or 'application/octet-stream', data)
            return self.send(200, {'Key': f'{bucket}/{key}'})
        return self.send(404, {'message': 'not found'})

    def static(self, path):
        if path == '/':
            path = '/index.html'
        if path == '/js/config.js':
            return self.send(200, f"export const SUPABASE_URL = 'http://localhost:{A.port}';\nexport const SUPABASE_KEY = 'sb_publishable_local_test';\n", ctype='text/javascript')
        f = os.path.normpath(os.path.join(A.web, path.lstrip('/')))
        if not f.startswith(os.path.normpath(A.web)) or not os.path.isfile(f):
            return self.send(404, b'not found', ctype='text/plain')
        ext = os.path.splitext(f)[1]
        ct = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
              '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json'}.get(ext, 'application/octet-stream')
        return self.send(200, open(f, 'rb').read(), ctype=ct)

    def do_GET(self): self.route('GET')
    def do_POST(self): self.route('POST')
    def do_PATCH(self): self.route('PATCH')
    def do_DELETE(self): self.route('DELETE')


if __name__ == '__main__':
    print(f'mock supabase on http://localhost:{A.port} (db {A.db})', flush=True)
    ThreadingHTTPServer(('127.0.0.1', A.port), H).serve_forever()
