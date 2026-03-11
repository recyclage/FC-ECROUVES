const cartItemsElement = document.getElementById('cart-items');
const cartTotalElement = document.getElementById('cart-total');
const cartMessageElement = document.getElementById('cart-message');
const licenseMessageElement = document.getElementById('license-message');
const loginMessageElement = document.getElementById('login-message');
const addButtons = document.querySelectorAll('.add-to-cart');

const cart = [];

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
    if (!acc[item.name]) {
      acc[item.name] = { qty: 0, price: item.price };
    }
    acc[item.name].qty += 1;
    return acc;
  }, {});

  let total = 0;
  Object.entries(grouped).forEach(([name, details]) => {
    const li = document.createElement('li');
    const subtotal = details.qty * details.price;
    total += subtotal;
    li.textContent = `${name} x${details.qty} - ${subtotal} €`;
    cartItemsElement.appendChild(li);
  });

  cartTotalElement.textContent = String(total);
}

addButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    const product = event.target.closest('.product');
    const name = product.dataset.name;
    const price = Number(product.dataset.price);

    cart.push({ name, price });
    renderCart();
    cartMessageElement.textContent = `${name} a été ajouté au panier.`;
  });
});

document.getElementById('checkout').addEventListener('click', () => {
  if (cart.length === 0) {
    cartMessageElement.textContent = 'Ajoutez au moins un article avant de valider.';
    return;
  }

  cartMessageElement.textContent = 'Panier validé ! Un responsable du club vous contactera pour le paiement.';
  cart.length = 0;
  renderCart();
});

document.getElementById('pay-license').addEventListener('click', () => {
  licenseMessageElement.textContent = 'Paiement licence enregistré (simulation).';
});

document.getElementById('login-form').addEventListener('submit', (event) => {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  if (!email) {
    loginMessageElement.textContent = 'Veuillez renseigner votre adresse email.';
    return;
  }

  loginMessageElement.textContent = `Bienvenue ${email} ! Connexion réussie.`;
});

renderCart();
