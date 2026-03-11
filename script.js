const cartItemsElement = document.getElementById('cart-items');
const cartTotalElement = document.getElementById('cart-total');
const cartMessageElement = document.getElementById('cart-message');
const licenseMessageElement = document.getElementById('license-message');
const authMessageElement = document.getElementById('auth-message');
const sessionStateElement = document.getElementById('session-state');
const addButtons = document.querySelectorAll('.add-to-cart');

const cart = [];

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

function renderCart() {
  cartItemsElement.innerHTML = '';

  if (cart.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Votre panier est vide.';
    cartItemsElement.appendChild(empty);
    cartTotalElement.textContent = '0';
    return;
  }

  const grouped = cart.reduce((acc, item) => {
    if (!acc[item.id]) {
      acc[item.id] = { name: item.name, qty: 0, price: item.price };
    }
    acc[item.id].qty += 1;
    return acc;
  }, {});

  let total = 0;
  Object.values(grouped).forEach((details) => {
    const li = document.createElement('li');
    const subtotal = details.qty * details.price;
    total += subtotal;
    li.textContent = `${details.name} x${details.qty} - ${subtotal} €`;
    cartItemsElement.appendChild(li);
  });

  cartTotalElement.textContent = String(total);
}

async function refreshSession() {
  const data = await api('/api/me');
  sessionStateElement.textContent = data.loggedIn
    ? `Connecté : ${data.user.email}`
    : 'Non connecté';
}

addButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    const product = event.target.closest('.product');
    const id = product.dataset.id;
    const name = product.dataset.name;
    const price = Number(product.dataset.price);

    cart.push({ id, name, price });
    renderCart();
    cartMessageElement.textContent = `${name} a été ajouté au panier.`;
  });
});

document.getElementById('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const mode = event.submitter?.dataset.mode || 'login';
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const result = await api(`/api/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    authMessageElement.textContent = result.message || 'Succès.';
    await refreshSession();
  } catch (error) {
    authMessageElement.textContent = error.message;
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
    authMessageElement.textContent = 'Déconnecté.';
    await refreshSession();
  } catch (error) {
    authMessageElement.textContent = error.message;
  }
});

document.getElementById('checkout').addEventListener('click', async () => {
  if (cart.length === 0) {
    cartMessageElement.textContent = 'Ajoutez au moins un article avant de payer.';
    return;
  }

  try {
    const payload = { items: cart.map((item) => item.id) };
    const result = await api('/api/checkout/boutique', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    window.location.href = result.url;
  } catch (error) {
    cartMessageElement.textContent = error.message;
  }
});

document.getElementById('pay-license').addEventListener('click', async () => {
  try {
    const result = await api('/api/checkout/licence', {
      method: 'POST',
      body: '{}'
    });
    window.location.href = result.url;
  } catch (error) {
    licenseMessageElement.textContent = error.message;
  }
});

renderCart();
refreshSession();
