const CART_KEY = 'fc_ecrouves_cart';
const LOCAL_USERS_KEY = 'fc_local_users';
const LOCAL_SESSION_KEY = 'fc_local_session';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function getLocalUsers() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLocalUsers(users) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

function getLocalSession() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function setLocalSession(session) {
  if (!session) {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    return;
  }
  localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function mapAuthErrorMessage(message, mode) {
  const m = (message || '').toLowerCase();
  if (m.includes('identifiants invalides')) return 'Email ou mot de passe incorrect.';
  if (m.includes('existe déjà')) return 'Cet email est déjà utilisé. Essayez de vous connecter.';
  if (m.includes('mot de passe') && m.includes('6')) return 'Mot de passe trop court (minimum 6 caractères).';
  if (m.includes('email') && m.includes('requis')) return 'Veuillez renseigner un email valide.';
  if (m.includes('requête invalide')) return 'Format invalide. Vérifiez les informations saisies.';
  if (m.includes('erreur serveur')) return 'Erreur serveur temporaire. Réessayez dans quelques instants.';
  return mode === 'register' ? 'Impossible de créer le compte pour le moment.' : 'Impossible de se connecter pour le moment.';
}

function isServerUnavailableError(error) {
  const m = (error?.message || '').toLowerCase();
  return m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed');
}

function updateCartBadges() {
  const badges = document.querySelectorAll('#cart-count');
  const totalCount = getCart().length;
  badges.forEach((badge) => {
    badge.textContent = String(totalCount);
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Erreur serveur');
  }
  return data;
}

async function authRequest(mode, email, password) {
  try {
    return await api(`/api/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  } catch (error) {
    if (!isServerUnavailableError(error)) throw error;

    const users = getLocalUsers();
    const existing = users.find((u) => u.email === email);

    if (mode === 'register') {
      if (existing) throw new Error('Cet email existe déjà.');
      users.push({ email, password });
      saveLocalUsers(users);
      setLocalSession({ email });
      return { ok: true, message: 'Compte créé (mode local hors ligne).' };
    }

    if (!existing || existing.password !== password) {
      throw new Error('Identifiants invalides.');
    }

    setLocalSession({ email });
    return { ok: true, message: `Bienvenue ${email} (mode local hors ligne).` };
  }
}

async function fetchSession() {
  try {
    return await api('/api/me');
  } catch (error) {
    if (!isServerUnavailableError(error)) throw error;
    const session = getLocalSession();
    return session ? { loggedIn: true, user: { email: session.email } } : { loggedIn: false };
  }
}

async function logoutRequest() {
  try {
    return await api('/api/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    if (!isServerUnavailableError(error)) throw error;
    setLocalSession(null);
    return { ok: true };
  }
}

function removeCartSelection(productId, productSize) {
  const current = getCart();
  const next = current.filter((item) => item.id !== productId || (item.size || '') !== (productSize || ''));
  saveCart(next);
  updateCartBadges();
  return next;
}

function renderCartPage() {
  const cartItemsElement = document.getElementById('cart-items');
  const cartTotalElement = document.getElementById('cart-total');
  const cartMessageElement = document.getElementById('cart-message');
  if (!cartItemsElement || !cartTotalElement) return;

  const cart = getCart();
  cartItemsElement.innerHTML = '';

  if (cart.length === 0) {
    cartItemsElement.innerHTML = '<li>Votre panier est vide.</li>';
    cartTotalElement.textContent = '0';
    return;
  }

  const grouped = cart.reduce((acc, item) => {
    const sizeKey = item.size || 'NA';
    const key = `${item.id}::${sizeKey}`;
    if (!acc[key]) {
      acc[key] = { id: item.id, name: item.name, size: item.size, qty: 0, price: item.price };
    }
    acc[key].qty += 1;
    return acc;
  }, {});

  let total = 0;
  Object.values(grouped).forEach((item) => {
    const subtotal = item.qty * item.price;
    total += subtotal;

    const li = document.createElement('li');
    li.className = 'cart-line';

    const sizeText = item.size ? ` (${item.size})` : '';
    const text = document.createElement('span');
    text.textContent = `${item.name}${sizeText} x${item.qty} - ${subtotal} €`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn muted remove-item';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Retirer';
    removeBtn.addEventListener('click', () => {
      removeCartSelection(item.id, item.size || '');
      if (cartMessageElement) cartMessageElement.textContent = `${item.name}${sizeText} retiré du panier.`;
      renderCartPage();
    });

    li.appendChild(text);
    li.appendChild(removeBtn);
    cartItemsElement.appendChild(li);
  });

  cartTotalElement.textContent = String(total);
}

function setupAddToCart() {
  const buttons = document.querySelectorAll('.add-to-cart');
  const cartMessageElement = document.getElementById('cart-message');
  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const product = event.target.closest('.product');
      const sizeSelect = product.querySelector('.size-select');
      const quantityInput = product.querySelector('.quantity-input');
      const selectedSize = sizeSelect ? sizeSelect.value : null;
      const selectedQuantity = Math.max(1, Number(quantityInput ? quantityInput.value : 1) || 1);

      const cart = getCart();
      const item = {
        id: product.dataset.id,
        name: product.dataset.name,
        price: Number(product.dataset.price),
        size: selectedSize
      };

      for (let i = 0; i < selectedQuantity; i += 1) cart.push(item);

      saveCart(cart);
      updateCartBadges();
      if (cartMessageElement) {
        const sizeMsg = selectedSize ? ` (${selectedSize})` : '';
        cartMessageElement.textContent = `${selectedQuantity} x ${item.name}${sizeMsg} ajouté(s) au panier.`;
      }
    });
  });
}

function setupCheckout() {
  const checkoutBtn = document.getElementById('checkout');
  const cartMessageElement = document.getElementById('cart-message');
  if (!checkoutBtn) return;

  checkoutBtn.addEventListener('click', async () => {
    const cart = getCart();
    if (cart.length === 0) {
      if (cartMessageElement) cartMessageElement.textContent = 'Ajoutez au moins un article.';
      return;
    }

    try {
      const result = await api('/api/checkout/boutique', {
        method: 'POST',
        body: JSON.stringify({ items: cart.map((item) => item.id) })
      });
      saveCart([]);
      updateCartBadges();
      window.location.href = result.url;
    } catch (error) {
      if (isServerUnavailableError(error)) {
        saveCart([]);
        updateCartBadges();
        if (cartMessageElement) cartMessageElement.textContent = 'Mode local sans serveur : panier validé (paiement simulé).';
        renderCartPage();
        return;
      }
      if (cartMessageElement) cartMessageElement.textContent = error.message;
    }
  });
}

function setupAuth() {
  const form = document.getElementById('auth-form');
  const authMessageElement = document.getElementById('auth-message');
  const sessionStateElement = document.getElementById('session-state');
  const logoutButton = document.getElementById('logout');
  const licenseButton = document.getElementById('pay-license');
  const licenseMessageElement = document.getElementById('license-message');

  async function refreshSession() {
    if (!sessionStateElement) return;
    try {
      const data = await fetchSession();
      sessionStateElement.textContent = data.loggedIn ? `Connecté : ${data.user.email}` : 'Non connecté';
      if (data.loggedIn && getLocalSession()) {
        sessionStateElement.textContent += ' (mode local sans serveur)';
      }
    } catch {
      sessionStateElement.textContent = 'Non connecté';
    }
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const mode = event.submitter?.dataset.mode || 'login';
      const email = document.getElementById('email')?.value?.trim() || '';
      const password = document.getElementById('password')?.value || '';

      if (!isValidEmail(email)) {
        if (authMessageElement) authMessageElement.textContent = 'Email invalide. Exemple : joueur@club.fr';
        return;
      }
      if (password.length < 6) {
        if (authMessageElement) authMessageElement.textContent = 'Mot de passe trop court (minimum 6 caractères).';
        return;
      }

      try {
        const result = await authRequest(mode, email, password);
        if (authMessageElement) authMessageElement.textContent = result.message || 'Succès.';
        await refreshSession();
      } catch (error) {
        if (authMessageElement) authMessageElement.textContent = mapAuthErrorMessage(error.message, mode);
      }
    });

    refreshSession();
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await logoutRequest();
        if (authMessageElement) authMessageElement.textContent = 'Déconnecté.';
        await refreshSession();
      } catch (error) {
        if (authMessageElement) authMessageElement.textContent = error.message;
      }
    });
  }

  if (licenseButton) {
    licenseButton.addEventListener('click', async () => {
      try {
        const result = await api('/api/checkout/licence', { method: 'POST', body: '{}' });
        window.location.href = result.url;
      } catch (error) {
        if (isServerUnavailableError(error)) {
          if (licenseMessageElement) {
            licenseMessageElement.textContent = 'Mode local sans serveur : paiement licence simulé.';
          }
          return;
        }
        if (licenseMessageElement) licenseMessageElement.textContent = error.message;
      }
    });
  }
}

updateCartBadges();
setupAddToCart();
renderCartPage();
setupCheckout();
setupAuth();
