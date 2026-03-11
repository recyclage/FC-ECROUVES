mport hashlib
import json
import os
import secrets
import sqlite3
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('PORT', '3000'))
BASE_URL = os.environ.get('BASE_URL', f'http://localhost:{PORT}')
STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
DB_PATH = os.path.join(os.path.dirname(__file__), 'club.db')

PRODUCTS = {
    'maillot-domicile': {'name': 'Maillot domicile', 'price_cents': 3500},
    'short-entrainement': {'name': 'Short entraînement', 'price_cents': 2200},
    'veste-club': {'name': 'Veste club', 'price_cents': 4900},
    'pack-chaussettes': {'name': 'Pack chaussettes', 'price_cents': 1200},
}


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        '''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount_cents INTEGER NOT NULL,
            stripe_session_id TEXT,
            status TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS license_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount_cents INTEGER NOT NULL,
            stripe_session_id TEXT,
            status TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        '''
    )
    conn.commit()
    conn.close()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.sha256(f'{salt}:{password}'.encode()).hexdigest()
    return f'{salt}${digest}'


def verify_password(password: str, stored: str) -> bool:
    salt, digest = stored.split('$', 1)
    test = hashlib.sha256(f'{salt}:{password}'.encode()).hexdigest()
    return secrets.compare_digest(digest, test)


def create_stripe_checkout_session(line_items, success_path, cancel_path):
    if not STRIPE_SECRET_KEY:
        raise RuntimeError('Paiement indisponible : configurez STRIPE_SECRET_KEY.')

    payload = []
    for idx, item in enumerate(line_items):
        payload.extend([
            (f'line_items[{idx}][price_data][currency]', 'eur'),
            (f'line_items[{idx}][price_data][product_data][name]', item['name']),
            (f'line_items[{idx}][price_data][unit_amount]', str(item['unit_amount'])),
            (f'line_items[{idx}][quantity]', str(item['quantity'])),
        ])

    payload.extend([
        ('mode', 'payment'),
        ('success_url', f'{BASE_URL}{success_path}'),
        ('cancel_url', f'{BASE_URL}{cancel_path}'),
    ])

    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(
        'https://api.stripe.com/v1/checkout/sessions',
        data=data,
        method='POST',
        headers={'Authorization': f'Bearer {STRIPE_SECRET_KEY}'},
    )

    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode('utf-8')
        return json.loads(body)


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def json_response(self, status, payload):
        content = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def parse_json_body(self):
        length = int(self.headers.get('Content-Length', '0'))
        raw = self.rfile.read(length) if length else b'{}'
        if not raw:
            return {}
        return json.loads(raw.decode('utf-8'))

    def get_session_user(self):
        cookie = SimpleCookie(self.headers.get('Cookie'))
        token = cookie.get('session_token')
        if not token:
            return None

        conn = get_db()
        user = conn.execute(
            '''SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?''',
            (token.value,),
        ).fetchone()
        conn.close()
        return dict(user) if user else None

    def create_session(self, user_id):
        token = secrets.token_urlsafe(32)
        conn = get_db()
        conn.execute('INSERT INTO sessions (token, user_id) VALUES (?, ?)', (token, user_id))
        conn.commit()
        conn.close()
        self.send_header('Set-Cookie', f'session_token={token}; HttpOnly; Path=/; SameSite=Lax')

    def clear_session(self):
        cookie = SimpleCookie(self.headers.get('Cookie'))
        token = cookie.get('session_token')
        if token:
            conn = get_db()
            conn.execute('DELETE FROM sessions WHERE token = ?', (token.value,))
            conn.commit()
            conn.close()
        self.send_header('Set-Cookie', 'session_token=deleted; Max-Age=0; Path=/; SameSite=Lax')

    def do_GET(self):
        if self.path == '/api/me':
            user = self.get_session_user()
            if not user:
                return self.json_response(200, {'loggedIn': False})
            return self.json_response(200, {'loggedIn': True, 'user': user})

        return super().do_GET()

    def do_POST(self):
        if self.path == '/api/register':
            return self.handle_register()
        if self.path == '/api/login':
            return self.handle_login()
        if self.path == '/api/logout':
            return self.handle_logout()
        if self.path == '/api/checkout/boutique':
            return self.handle_shop_checkout()
        if self.path == '/api/checkout/licence':
            return self.handle_license_checkout()

        return self.json_response(404, {'error': 'Not found'})

    def handle_register(self):
        body = self.parse_json_body()
        email = (body.get('email') or '').strip().lower()
        password = body.get('password') or ''

        if not email or len(password) < 6:
            return self.json_response(400, {'error': 'Email et mot de passe (min 6 caractères) requis.'})

        conn = get_db()
        existing = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if existing:
            conn.close()
            return self.json_response(409, {'error': 'Cet email existe déjà.'})

        info = conn.execute(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            (email, hash_password(password)),
        )
        user_id = info.lastrowid
        conn.commit()
        conn.close()

        self.send_response(200)
        self.create_session(user_id)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        payload = json.dumps({'ok': True, 'message': 'Compte créé et connecté.'}).encode('utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_login(self):
        body = self.parse_json_body()
        email = (body.get('email') or '').strip().lower()
        password = body.get('password') or ''
        if not email or not password:
            return self.json_response(400, {'error': 'Email et mot de passe requis.'})

        conn = get_db()
        user = conn.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()

        if not user or not verify_password(password, user['password_hash']):
            return self.json_response(401, {'error': 'Identifiants invalides.'})

        self.send_response(200)
        self.create_session(user['id'])
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        payload = json.dumps({'ok': True, 'message': f'Bienvenue {user["email"]}'}).encode('utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_logout(self):
        self.send_response(200)
        self.clear_session()
        payload = json.dumps({'ok': True}).encode('utf-8')
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_shop_checkout(self):
        user = self.get_session_user()
        if not user:
            return self.json_response(401, {'error': 'Connexion requise.'})

        body = self.parse_json_body()
        item_ids = body.get('items') or []
        if not isinstance(item_ids, list) or not item_ids:
            return self.json_response(400, {'error': 'Panier vide.'})

        counts = {}
        for item_id in item_ids:
            if item_id in PRODUCTS:
                counts[item_id] = counts.get(item_id, 0) + 1

        if not counts:
            return self.json_response(400, {'error': 'Aucun article valide.'})

        line_items = []
        amount_cents = 0
        for item_id, qty in counts.items():
            p = PRODUCTS[item_id]
            line_items.append({'name': p['name'], 'unit_amount': p['price_cents'], 'quantity': qty})
            amount_cents += p['price_cents'] * qty

        try:
            checkout = create_stripe_checkout_session(line_items, '/?success=shop', '/?cancel=shop')
        except Exception as exc:
            return self.json_response(503, {'error': str(exc)})

        conn = get_db()
        conn.execute(
            'INSERT INTO orders (user_id, amount_cents, stripe_session_id, status) VALUES (?, ?, ?, ?)',
            (user['id'], amount_cents, checkout.get('id'), 'pending'),
        )
        conn.commit()
        conn.close()

        return self.json_response(200, {'url': checkout.get('url')})

    def handle_license_checkout(self):
        user = self.get_session_user()
        if not user:
            return self.json_response(401, {'error': 'Connexion requise.'})

        try:
            checkout = create_stripe_checkout_session(
                [{'name': 'Licence annuelle FC Ecrouves', 'unit_amount': 12000, 'quantity': 1}],
                '/?success=licence',
                '/?cancel=licence',
            )
        except Exception as exc:
            return self.json_response(503, {'error': str(exc)})

        conn = get_db()
        conn.execute(
            'INSERT INTO license_payments (user_id, amount_cents, stripe_session_id, status) VALUES (?, ?, ?, ?)',
            (user['id'], 12000, checkout.get('id'), 'pending'),
        )
        conn.commit()
        conn.close()

        return self.json_response(200, {'url': checkout.get('url')})


if __name__ == '__main__':
    init_db()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), AppHandler)
    print(f'Serveur démarré sur {BASE_URL}')
    server.serve_forever()
