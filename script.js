const CART_KEY = 'fc_ecrouves_cart';

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

function renderCartPage() {
  const cartItemsElement = document.getElementById('cart-items');
  const cartTotalElement = document.getElementById('cart-total');
  if (!cartItemsElement || !cartTotalElement) return;

  const cart = getCart();
  cartItemsElement.innerHTML = '';

  if (cart.length === 0) {
    cartItemsElement.innerHTML = '<li>Votre panier est vide.</li>';
    cartTotalElement.textContent = '0';
    return;
  }

  const grouped = cart.reduce((acc, item) => {
    if (!acc[item.id]) acc[item.id] = { name: item.name, qty: 0, price: item.price };
    acc[item.id].qty += 1;
    return acc;
  }, {});

  let total = 0;
  Object.values(grouped).forEach((item) => {
    const subtotal = item.qty * item.price;
    total += subtotal;
    const li = document.createElement('li');
    li.textContent = `${item.name} x${item.qty} - ${subtotal} €`;
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
      const cart = getCart();
      const item = {
        id: product.dataset.id,
        name: product.dataset.name,
        price: Number(product.dataset.price)
      };
      cart.push(item);
      saveCart(cart);
      updateCartBadges();
      if (cartMessageElement) {
        cartMessageElement.textContent = `${item.name} ajouté au panier.`;
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
    const data = await api('/api/me');
    sessionStateElement.textContent = data.loggedIn ? `Connecté : ${data.user.email}` : 'Non connecté';
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const mode = event.submitter?.dataset.mode || 'login';
      const email = document.getElementById('email')?.value?.trim();
      const password = document.getElementById('password')?.value;
      try {
        const result = await api(`/api/${mode}`, {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        if (authMessageElement) authMessageElement.textContent = result.message || 'Succès.';
        await refreshSession();
      } catch (error) {
        if (authMessageElement) authMessageElement.textContent = error.message;
      }
    });

    refreshSession();
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await api('/api/logout', { method: 'POST', body: '{}' });
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
